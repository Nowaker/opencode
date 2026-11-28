import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { KeyedMutex } from "@opencode-ai/core/effect/keyed-mutex"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Image } from "@/image/image"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Deferred, Effect, Exit, Fiber, Latch, Layer, Context, Scope, Schema, Semaphore } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionPause } from "./pause"
import { SessionAbort } from "./abort"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { MeridianRouting } from "@/provider/meridian-routing"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { TransactionDiagnostic } from "@opencode-ai/core/database/transaction-diagnostic"
import { Usage, type LLMEvent } from "@opencode-ai/llm"
import { textStop } from "./text-stop"
import { LiveEvents } from "./live-events"

const DOOM_LOOP_THRESHOLD = 3
const SNAPSHOT_FAILURE_THRESHOLD = 3
const MAX_SNAPSHOT_FAILURE_SESSIONS = 1024
export type Result = "compact" | "stop" | "continue"

export type ToolEnginePhase =
  | { readonly phase: "waiting-for-snapshot"; readonly snapshotWaitStartedAt: number }
  | {
      readonly phase: "running"
      readonly snapshotWaitMs: number
      readonly executionStartedAt: number
      readonly snapshot?: "skipped"
    }

class SnapshotPreflightFailed extends Error {
  override readonly name = "SnapshotPreflightFailed"

  constructor() {
    super("Snapshot preflight failed; the tool was not started")
  }
}

type SnapshotWaitEffect = Effect.Effect<void | "skipped", SnapshotPreflightFailed>
type SnapshotWait = {
  readonly wait: SnapshotWaitEffect
  readonly failed: () => boolean
  readonly confirm: Effect.Effect<"skipped" | "retry" | void>
}

type SnapshotSkip = {
  readonly failed: () => boolean
  readonly retryIfRecovered: boolean
  readonly unmark: Effect.Effect<void>
}

export interface Handle {
  readonly message: SessionV1.Assistant
  /**
   * Meridian's no-routable-account refusal that ended the step, which `process` answers with `stop`. The step is
   * not failed: the caller drops it and pauses the session, so unpause runs it again.
   */
  readonly refusal: SessionPause.Refusal | undefined
  readonly routeRefusal: MeridianRouting.Refusal | undefined
  readonly hasEffects: boolean
  readonly dispatchBlocked: boolean
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
    tool?: string,
  ) => Effect.Effect<SessionV1.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: SessionV1.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
  /**
   * Waits for every file snapshot this session has started so far. Tools that may modify the worktree call
   * this before executing, so their changes always land after the step's "before" snapshot and after the
   * previous step's "after" snapshot.
   */
  readonly waitForSnapshots: SnapshotWaitEffect | ((signal: AbortSignal) => SnapshotWait)
  readonly skipSnapshot?: (
    signal: AbortSignal,
    mark: Effect.Effect<boolean>,
    attempt: SnapshotSkip,
  ) => Effect.Effect<boolean | "retry", SnapshotPreflightFailed>
}

type Input = {
  assistantMessage: SessionV1.Assistant
  sessionID: SessionID
  model: Provider.Model
  stopSequences?: readonly string[]
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
  /** Waits for the session's background snapshot work, including the step-start, step-finish and patch parts it writes. */
  readonly settle: (sessionID: SessionID) => Effect.Effect<void>
}

type ToolCall = {
  partID: SessionV1.ToolPart["id"]
  messageID: SessionV1.ToolPart["messageID"]
  sessionID: SessionV1.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
  raw: string
  pending?: SessionV1.ToolPart
}

type ToolOutput = Parameters<Handle["completeToolCall"]>[1]
type EarlyToolResult =
  | { readonly type: "completed"; readonly output: ToolOutput }
  | { readonly type: "error"; readonly error: unknown }

type SnapshotPublication = { allowed: boolean; readonly revoked: Latch.Latch }
type SnapshotWork<A> = { readonly publication: SnapshotPublication; readonly fiber: Fiber.Fiber<A> }

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: SnapshotWork<string | undefined> | undefined
  blocked: boolean
  needsCompaction: boolean
  currentText: SessionV1.TextPart | undefined
  reasoningMap: Record<string, SessionV1.ReasoningPart>
  refusal: SessionPause.Refusal | undefined
}

type StreamEvent = LLMEvent
type ToolDeferral = NonNullable<ReturnType<typeof SessionPause.deferredOf>>

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const image = yield* Image.Service
    const events = yield* EventV2Bridge.Service
    const database = yield* Database.Service
    const live = yield* LiveEvents.Service

    // Snapshots run in the background so they never delay the model request. Track each one until it
    // finishes publishing or the tool preflight revokes its right to publish.
    const pending = new Map<SessionID, Set<SnapshotWork<unknown>>>()
    const replacements = new WeakMap<SnapshotWork<unknown>, SnapshotWork<unknown>>()
    const publications = KeyedMutex.makeUnsafe<SessionID>()
    const snapshotFailures = new Map<SessionID, number>()

    const background = <A>(
      sessionID: SessionID,
      options: { readonly enabled: () => boolean; readonly replaces?: SnapshotWork<unknown> },
      work: (publication: SnapshotPublication) => Effect.Effect<A>,
    ) =>
      publications.withLock(sessionID)(
        Effect.gen(function* () {
          if (!options.enabled()) return undefined
          const publication: SnapshotPublication = { allowed: true, revoked: Latch.makeUnsafe() }
          const fiber = yield* work(publication).pipe(
            Effect.tapCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.logError("snapshot failed", { "session.id": sessionID, cause: Cause.pretty(cause) }),
            ),
            Effect.forkIn(scope),
          )
          const entry = { publication, fiber }
          if (options.replaces) replacements.set(options.replaces, entry)
          const entries = pending.get(sessionID) ?? new Set<SnapshotWork<unknown>>()
          pending.set(sessionID, entries)
          entries.add(entry)
          fiber.addObserver(() => {
            entries.delete(entry)
            if (entries.size === 0 && pending.get(sessionID) === entries) pending.delete(sessionID)
          })
          return entry
        }),
      )

    const awaitSnapshot = <A>(entry: SnapshotWork<A>) =>
      Effect.raceFirst(entry.publication.revoked.await.pipe(Effect.as(undefined)), Fiber.await(entry.fiber))

    const settle = Effect.fn("SessionProcessor.settle")(function* (sessionID: SessionID) {
      const entries = pending.get(sessionID)
      if (entries?.size) yield* Effect.forEach([...entries], awaitSnapshot, { concurrency: "unbounded", discard: true })
    })

    const hashOf = (entry: SnapshotWork<string | undefined>) =>
      awaitSnapshot(entry).pipe(Effect.map((exit) => (exit && Exit.isSuccess(exit) ? exit.value : undefined)))

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      const stopSequences = input.stopSequences?.length ? input.stopSequences : undefined
      let boundary = stopSequences && textStop(stopSequences)
      let stopped: number | undefined
      let acceptedNarrative = false
      let completingText = false
      let hasEffects = false
      let dispatchBlocked = false
      let routeRefusal: MeridianRouting.Refusal | undefined
      let attempts = 0
      const observeTool = <Args extends unknown[], A>(callback: (...args: Args) => A) =>
        function (this: unknown, ...args: Args): A {
          hasEffects = true
          return callback.apply(this, args)
        }
      // Start the snapshot before the LLM stream starts. The AI SDK may execute tools internally before
      // emitting start-step events, so starting it inside the event handler can be too late. Tools that may
      // write wait for it through waitForSnapshots; the model request and read-only tools do not.
      let snapshotSkipped = false
      const snapshotAllowed = () => !snapshotSkipped
      const publish = { enabled: snapshotAllowed }
      const snapshotLock = publications.withLock(input.sessionID)
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: yield* background(input.sessionID, publish, () => snapshot.track(input.sessionID)),
        blocked: false,
        needsCompaction: false,
        currentText: undefined,
        reasoningMap: {},
        refusal: undefined,
      }
      let aborted = false
      let abort: SessionAbort.Metadata | undefined
      const abandoned = new Map<PartID, SessionV1.TextPart | SessionV1.ReasoningPart>()
      const mutate = <A, E, R>(work: Effect.Effect<A, E, R>) => live.guard(ctx.sessionID, work)
      const toolPermit = (yield* Semaphore.make(1)).withPermit
      const mutateTool = <A, E, R>(work: Effect.Effect<A, E, R>) => toolPermit(mutate(work))
      const promotedTools = new Set<string>()
      const settledTools = new Set<string>()
      const earlyResults = new Map<string, EarlyToolResult>()
      let acceptingToolCalls = true
      const snapshotWork = (watched: readonly SnapshotWork<unknown>[] = []) => {
        const entries = [...watched, ...(pending.get(ctx.sessionID) ?? [])]
        if (ctx.snapshot) entries.push(ctx.snapshot)
        return [...new Set(
          entries.map((entry) => {
            let current = entry
            while (true) {
              const next = replacements.get(current)
              if (!next) return current
              current = next
            }
          }),
        )]
      }
      const snapshotFailed = (exit: Exit.Exit<unknown> | undefined) =>
        exit !== undefined && (Exit.isFailure(exit) || exit.value === "")
      const failedWork = (entry: SnapshotWork<unknown>) =>
        entry.publication.allowed && snapshotFailed(entry.fiber.pollUnsafe())
      const waitForSnapshots = (signal: AbortSignal): SnapshotWait => {
        // Completed work leaves the pending set. Keep this call's entries so
        // the timeout path can still see a failure from the work it raced.
        let watched: SnapshotWork<unknown>[] = []
        return {
          wait: Effect.gen(function* () {
            if (snapshotSkipped) return "skipped" as const
            watched = snapshotWork(watched)
            yield* Effect.forEach(
              watched,
              (entry) => awaitSnapshot(entry).pipe(
                Effect.flatMap((exit) =>
                  !snapshotSkipped && !replacements.has(entry) && entry.publication.allowed && snapshotFailed(exit)
                    ? Effect.fail(new SnapshotPreflightFailed())
                    : Effect.void,
                ),
              ),
              { concurrency: "unbounded", discard: true },
            )
          }),
          failed: () => snapshotWork(watched).some(failedWork),
          confirm: snapshotLock(
            Effect.sync(() => {
              const work = snapshotWork(watched)
              if (snapshotSkipped || work.some(({ publication }) => !publication.allowed)) return "skipped" as const
              if (work.some((entry) => failedWork(entry) || !entry.fiber.pollUnsafe())) return "retry" as const
              if (!signal.aborted && acceptingToolCalls) snapshotFailures.delete(ctx.sessionID)
            }),
          ),
        }
      }
      const skipSnapshot: NonNullable<Handle["skipSnapshot"]> = (signal, mark, attempt) =>
        snapshotLock(
          Effect.uninterruptible(Effect.gen(function* () {
            if (signal.aborted || !acceptingToolCalls) return false
            const failure = !snapshotSkipped && attempt.failed()
            if (!failure && !snapshotSkipped && attempt.retryIfRecovered) return "retry" as const
            if (failure) {
              const count = Math.min(SNAPSHOT_FAILURE_THRESHOLD, (snapshotFailures.get(ctx.sessionID) ?? 0) + 1)
              snapshotFailures.delete(ctx.sessionID)
              snapshotFailures.set(ctx.sessionID, count)
              if (snapshotFailures.size > MAX_SNAPSHOT_FAILURE_SESSIONS) {
                const oldest = snapshotFailures.keys().next()
                if (!oldest.done) snapshotFailures.delete(oldest.value)
              }
              if (count < SNAPSHOT_FAILURE_THRESHOLD) return yield* Effect.fail(new SnapshotPreflightFailed())
            }
            if (!(yield* mark)) return false
            if (signal.aborted || !acceptingToolCalls) {
              yield* attempt.unmark
              return false
            }
            if (snapshotSkipped) return true
            snapshotSkipped = true
            const entries = [...(pending.get(ctx.sessionID) ?? [])]
            for (const { publication } of entries) {
              publication.allowed = false
              publication.revoked.openUnsafe()
            }
            pending.delete(ctx.sessionID)
            // Revocation is complete before requesting interruption; Git cleanup may still hold its store lock.
            for (const { fiber } of entries) fiber.interruptUnsafe()
            if (failure) {
              yield* session.updatePart({
                id: PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                type: "text",
                synthetic: true,
                metadata: { opencode: { snapshotWarning: true } },
                text: "Snapshot warning: file undo is unavailable for this step because snapshot capture failed.",
              })
            }
            return true
          })),
        )
      const publishSnapshot = (publication: SnapshotPublication, part: SessionV1.Part) =>
        snapshotLock(
          Effect.suspend(() => publication.allowed ? session.updatePart(part).pipe(Effect.asVoid) : Effect.void),
        )
      const summarizeSnapshots = summary
        .summarize({ sessionID: ctx.sessionID, messageID: ctx.assistantMessage.parentID })
        .pipe(Effect.ignore, Effect.forkIn(scope))
      const clearRaw = () => {
        for (const call of Object.values(ctx.toolcalls)) {
          call.raw = ""
          call.pending = undefined
        }
      }
      const unregister = yield* live.register(
        ctx.sessionID,
        () => structuredClone([
          ...abandoned.values(),
          ...(ctx.currentText ? [ctx.currentText] : []),
          ...Object.values(ctx.reasoningMap),
          ...Object.values(ctx.toolcalls).flatMap((call) =>
            call.pending?.state.status === "pending"
              ? [{ ...call.pending, state: { ...call.pending.state, raw: call.raw } }]
              : [],
          ),
        ]),
        (event) => {
          if (!abandoned.size || !isRecord(event.data)) return
          switch (event.type) {
            case "message.part.updated":
              if (isRecord(event.data.part) && typeof event.data.part.id === "string") {
                abandoned.delete(PartID.make(event.data.part.id))
              }
              return
            case "message.part.removed":
              if (typeof event.data.partID === "string") abandoned.delete(PartID.make(event.data.partID))
              return
            case "message.removed":
              for (const [id, part] of abandoned) {
                if (part.messageID === event.data.messageID) abandoned.delete(id)
              }
              return
            case "session.deleted":
              abandoned.clear()
              return
          }
        },
      )

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
          abort,
        })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        settledTools.add(toolCallID)
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return undefined
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          yield* settleToolCall(toolCallID)
          return undefined
        }
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
        tool?: string,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) {
          if (tool === undefined) return undefined
          return (yield* ensureToolCall({ id: toolCallID, name: tool }, update))?.part
        }
        const next = update(match.part)
        if (next === match.part) return match.part
        if (next.state.status !== "pending") {
          match.call.raw = ""
          match.call.pending = undefined
        }
        const part = yield* session.updatePart(next)
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
          raw: part.state.status === "pending" ? match.call.raw : "",
          pending: part.state.status === "pending" ? part : undefined,
        }
        return part
      }, mutateTool)

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: ToolOutput,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return
        const state = match.part.state
        if (
          (state.status === "pending" || state.status === "running") &&
          state.metadata?.engine !== undefined &&
          !promotedTools.has(toolCallID)
        ) {
          earlyResults.set(toolCallID, { type: "completed", output })
          return
        }
        if (state.status !== "running") return
        const engine = state.metadata?.engine
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: state.input,
            output: output.output,
            metadata: engine === undefined ? output.metadata : { ...output.metadata, engine },
            title: output.title,
            time: { start: state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        yield* settleToolCall(toolCallID)
      }, mutateTool)

      /*
       * A call the paused session did not start keeps its full input as pending work. Settling it here keeps the
       * abort cleanup from marking it interrupted, so it survives an abort or a restart until unpause or discard.
       * The AI SDK merges tool results from their own stream, so an instant deferral can arrive before its call's
       * `tool-call` event; that event then finishes the deferral with the full input.
       */
      const early = new Map<string, ToolDeferral>()
      const deferToolCall = Effect.fn("SessionProcessor.deferToolCall")(function* (
        toolCallID: string,
        deferred: ToolDeferral,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (match?.part.state.status !== "running") {
          early.set(toolCallID, deferred)
          return
        }
        yield* session.updatePart({
          ...match.part,
          state: { status: "pending", input: match.part.state.input, raw: "", metadata: { deferred } },
        })
        yield* settleToolCall(toolCallID)
      }, mutateTool)

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return false
        const state = match.part.state
        if (
          (state.status === "pending" || state.status === "running") &&
          state.metadata?.engine !== undefined &&
          !promotedTools.has(toolCallID)
        ) {
          earlyResults.set(toolCallID, { type: "error", error })
          return false
        }
        match.call.raw = ""
        match.call.pending = undefined
        if (state.status !== "running") return false
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: state.input,
            error: errorMessage(error),
            // Keep metadata streamed while running so failures retain progress detail (e.g. execute's child calls).
            metadata: state.metadata,
            time: { start: state.time.start, end: Date.now() },
          },
        })
        if (error instanceof PermissionV1.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      }, mutateTool)

      const finishReasoning = Effect.fn("SessionProcessor.finishReasoning")(function* (reasoningID: string) {
        if (!(reasoningID in ctx.reasoningMap)) return
        // oxlint-disable-next-line no-self-assign -- reactivity trigger
        ctx.reasoningMap[reasoningID].text = ctx.reasoningMap[reasoningID].text
        ctx.reasoningMap[reasoningID].time = { ...ctx.reasoningMap[reasoningID].time, end: Date.now() }
        yield* session.updatePart(ctx.reasoningMap[reasoningID])
        delete ctx.reasoningMap[reasoningID]
      }, mutate)

      const ensureToolCall = Effect.fn("SessionProcessor.ensureToolCall")(function* (
        input: { id: string; name: string; providerExecuted?: boolean },
        initialize?: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
      ) {
        if (settledTools.has(input.id)) return undefined
        const existing = yield* readToolCall(input.id)
        if (existing) {
          if (!input.providerExecuted || existing.part.metadata?.providerExecuted) return existing
          const part = yield* session.updatePart({
            ...existing.part,
            metadata: { ...existing.part.metadata, providerExecuted: true },
          })
          return { call: existing.call, part }
        }
        if (!acceptingToolCalls) return undefined
        const initial: SessionV1.ToolPart = {
          id: PartID.ascending(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "tool",
          tool: input.name,
          callID: input.id,
          state: { status: "pending", input: {}, raw: "" },
          metadata: input.providerExecuted ? { providerExecuted: true } : undefined,
        }
        const next = initialize ? initialize(initial) : initial
        if (initialize && next === initial) return undefined
        const part = yield* session.updatePart(next)
        ctx.toolcalls[input.id] = {
          done: yield* Deferred.make<void>(),
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
          raw: "",
          pending: part.state.status === "pending" ? part : undefined,
        }
        return { call: ctx.toolcalls[input.id], part }
      })

      // The patch part ID is allocated when the step ends so the part keeps its place in the message even
      // though the patch itself is computed later.
      const recordPatch = (start: SnapshotWork<string | undefined>) => {
        const id = PartID.ascending()
        return (publication: SnapshotPublication) =>
          Effect.gen(function* () {
            const from = yield* hashOf(start)
            if (!from || !publication.allowed) return
            const patch = yield* snapshot.patch(from, ctx.sessionID)
            if (!patch.files.length) return
            yield* publishSnapshot(publication, {
              id,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          })
      }

      const isFilePart = (value: unknown): value is SessionV1.FilePart => Schema.is(SessionV1.FilePart)(value)

      const publishText = Effect.fnUntraced(function* (text: string, metadata?: SessionV1.TextPart["metadata"]) {
        if (!ctx.currentText) return
        ctx.currentText.text += text
        if (text.trim()) acceptedNarrative = true
        if (metadata) ctx.currentText.metadata = metadata
        if (boundary && !text) return
        yield* session.updatePartDelta({
          sessionID: ctx.currentText.sessionID,
          messageID: ctx.currentText.messageID,
          partID: ctx.currentText.id,
          field: "text",
          delta: text,
        })
      }, mutate)

      const finishText = Effect.fn("SessionProcessor.finishText")(function* (metadata?: SessionV1.TextPart["metadata"]) {
        if (!ctx.currentText) return
        if (boundary) {
          const suffix = boundary.finish()
          if (suffix) yield* publishText(suffix)
          if (ctx.assistantMessage.summary && !acceptedNarrative) {
            throw new Error("Compaction produced no accepted narrative")
          }
        }
        completingText = true
        const text = (
          yield* plugin.trigger(
            "experimental.text.complete",
            {
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              partID: ctx.currentText.id,
            },
            { text: ctx.currentText.text },
          )
        ).text
        completingText = false
        yield* mutate(
          Effect.gen(function* () {
            if (!ctx.currentText) return
            ctx.currentText.text = text
            const end = Date.now()
            ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            if (metadata) ctx.currentText.metadata = metadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
          }),
        )
      })

      const finishStoppedText = Effect.fn("SessionProcessor.finishStoppedText")(function* (sequenceIndex: number) {
        const localStop = { reason: "stop-sequence", sequenceIndex, finalUsage: "unavailable" }
        yield* mutate(
          Effect.sync(() => {
            if (ctx.currentText) ctx.currentText.metadata = { ...ctx.currentText.metadata, localStop }
          }),
        )
        yield* Effect.logInfo("local stream stop", {
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          ...localStop,
        })
        yield* finishText()
        ctx.assistantMessage.finish = "stop"
      })

      const toolResultOutput = (
        value: Extract<StreamEvent, { type: "tool-result" }>,
      ): { title: string; metadata: Record<string, any>; output: string; attachments?: SessionV1.FilePart[] } => {
        if (isRecord(value.result.value) && typeof value.result.value.output === "string") {
          return {
            title: typeof value.result.value.title === "string" ? value.result.value.title : value.name,
            metadata: isRecord(value.result.value.metadata) ? value.result.value.metadata : {},
            output: value.result.value.output,
            attachments: Array.isArray(value.result.value.attachments)
              ? value.result.value.attachments.filter(isFilePart)
              : undefined,
          }
        }
        return {
          title: value.name,
          metadata: value.result.type === "json" && isRecord(value.result.value) ? value.result.value : {},
          output:
            typeof value.result.value === "string" ? value.result.value : (JSON.stringify(value.result.value) ?? ""),
        }
      }

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        if (value.type !== "step-start" && value.type !== "provider-error") hasEffects = true
        switch (value.type) {
          case "reasoning-start":
            yield* mutate(
              Effect.gen(function* () {
                if (value.id in ctx.reasoningMap) return
                ctx.reasoningMap[value.id] = {
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.assistantMessage.sessionID,
                  type: "reasoning",
                  text: "",
                  time: { start: Date.now() },
                  metadata: value.providerMetadata,
                }
                yield* session.updatePart(ctx.reasoningMap[value.id])
              }),
            )
            return

          case "reasoning-delta":
            yield* mutate(
              Effect.gen(function* () {
                // Match dev: silently drop orphan deltas (no preceding reasoning-start).
                if (!(value.id in ctx.reasoningMap)) return
                ctx.reasoningMap[value.id].text += value.text
                if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
                yield* session.updatePartDelta({
                  sessionID: ctx.reasoningMap[value.id].sessionID,
                  messageID: ctx.reasoningMap[value.id].messageID,
                  partID: ctx.reasoningMap[value.id].id,
                  field: "text",
                  delta: value.text,
                })
              }),
            )
            return

          case "reasoning-end":
            yield* mutate(
              Effect.gen(function* () {
                if (value.providerMetadata && value.id in ctx.reasoningMap) {
                  ctx.reasoningMap[value.id].metadata = value.providerMetadata
                }
                yield* finishReasoning(value.id)
              }),
            )
            return

          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* mutateTool(ensureToolCall(value))
            return

          case "tool-input-delta":
            yield* mutateTool(
              Effect.gen(function* () {
                const match = yield* ensureToolCall(value)
                if (match?.part.state.status !== "pending") return
                match.call.raw += value.text
                live.raw(match.part, value.text)
              }),
            )
            return

          case "tool-input-end": {
            yield* mutateTool(ensureToolCall(value))
            return
          }

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            if (promotedTools.has(value.id)) return
            if (value.providerExecuted) yield* mutateTool(ensureToolCall(value))
            const input = isRecord(value.input) ? value.input : { value: value.input }
            const call = yield* updateToolCall(
              value.id,
              (match) => {
                if (match.state.status !== "pending" && match.state.status !== "running") return match
                promotedTools.add(value.id)
                return {
                  ...match,
                  tool: value.name,
                  state:
                    match.state.status === "running"
                      ? { ...match.state, input }
                      : { status: "running", input, metadata: match.state.metadata, time: { start: Date.now() } },
                  metadata:
                    value.providerExecuted || match.metadata?.providerExecuted
                      ? { ...match.metadata, ...value.providerMetadata, providerExecuted: true }
                      : value.providerMetadata ?? match.metadata,
                }
              },
              value.name,
            )
            // The provider has already run its own tools (e.g. OpenAI's hosted tool_search) by the time we
            // see the call, so a doom_loop ask can neither stop nor change them; it would only block the turn.
            if (!call || call.metadata?.providerExecuted) return
            const result = earlyResults.get(value.id)
            switch (result?.type) {
              case "completed":
                earlyResults.delete(value.id)
                yield* completeToolCall(value.id, result.output)
                return
              case "error":
                earlyResults.delete(value.id)
                yield* failToolCall(value.id, result.error)
                return
              case undefined:
                break
            }
            const deferred = early.get(value.id)
            if (deferred) {
              early.delete(value.id)
              yield* deferToolCall(value.id, deferred)
              return
            }

            const parts = yield* MessageV2.parts(ctx.assistantMessage.id).pipe(
              Effect.provideService(Database.Service, database),
            )
            const recentParts = parts
              .filter(
                (part) => !(part.type === "text" && part.synthetic && part.metadata?.opencode?.snapshotWarning === true),
              )
              .slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.type === "tool" &&
                  part.tool === value.name &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === JSON.stringify(input),
              )
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            // This ask runs inside the stream, so any failure escaping it ends the turn. A deferral instead
            // fails only the repeated call, and the model reads the feedback as that call's error.
            yield* permission
              .ask({
                permission: "doom_loop",
                patterns: [value.name],
                sessionID: ctx.assistantMessage.sessionID,
                metadata: { tool: value.name, input },
                always: [value.name],
                ruleset: agent.permission,
              })
              .pipe(
                Effect.catchIf(
                  (error) => error instanceof PermissionV1.DeferredError,
                  (error) => failToolCall(value.id, error),
                ),
              )
            return
          }

          case "tool-result": {
            if (value.result.type === "error") {
              yield* failToolCall(value.id, value.result.value)
              return
            }
            const rawOutput = toolResultOutput(value)
            const deferred = SessionPause.deferredOf(rawOutput.metadata)
            if (deferred) {
              yield* deferToolCall(value.id, deferred)
              return
            }
            const normalized = yield* Effect.forEach(rawOutput.attachments ?? [], (attachment) =>
              attachment.mime.startsWith("image/")
                ? image.normalize(attachment).pipe(
                    Effect.catchIf(
                      (error) => error instanceof Image.ResizerUnavailableError,
                      () => Effect.succeed(attachment),
                    ),
                    Effect.exit,
                  )
                : Effect.succeed(Exit.succeed<SessionV1.FilePart>(attachment)),
            )
            const omitted = normalized.filter(Exit.isFailure).length
            const attachments = normalized.filter(Exit.isSuccess).map((item) => item.value)
            const output = {
              ...rawOutput,
              output:
                omitted === 0
                  ? rawOutput.output
                  : `${rawOutput.output}\n\n[${omitted} image${omitted === 1 ? "" : "s"} omitted: could not be resized below the image size limit.]`,
              attachments: attachments.length ? attachments : undefined,
            }
            yield* completeToolCall(value.id, output)
            return
          }

          case "tool-error": {
            yield* failToolCall(value.id, value.error ?? new Error(value.message))
            return
          }

          case "provider-error":
            throw new Error(value.message)

          case "step-start": {
            const prior = ctx.snapshot
            const part = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "step-start",
            } satisfies SessionV1.StepStartPart
            const ready = prior?.fiber.pollUnsafe()
            if (ready && Exit.isSuccess(ready) && ready.value) {
              const hash = ready.value
              yield* snapshotLock(
                Effect.suspend(() =>
                  session.updatePart(snapshotSkipped || !prior?.publication.allowed ? part : { ...part, snapshot: hash }),
                ),
              )
              return
            }
            // The snapshot is still running: write the part now and fill in its hash once the snapshot is
            // done. Without a usable hash, take a new snapshot as the synchronous handler did.
            yield* session.updatePart(part)
            ctx.snapshot = yield* background(
              ctx.sessionID,
              { ...publish, ...(prior && { replaces: prior }) },
              (publication) => Effect.gen(function* () {
                const previous = prior ? yield* hashOf(prior) : undefined
                if (!publication.allowed) return
                const hash = previous || (yield* snapshot.track(ctx.sessionID))
                if (hash) yield* publishSnapshot(publication, { ...part, snapshot: hash })
                return hash
              }),
            )
            return
          }

          case "step-finish": {
            yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
            // Anthropic reports thinking blocks it removed before the model saw the
            // prompt. Prefix mismatches mean opencode changed history behind a signed
            // block; log them so the churn can be tracked down.
            const dropped = isRecord(value.providerMetadata?.anthropic)
              ? value.providerMetadata.anthropic.inputTransformations
              : undefined
            if (Array.isArray(dropped) && dropped.length > 0) {
              yield* Effect.logWarning("thinking blocks dropped by provider", {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                model: ctx.model.id,
                transformations: JSON.stringify(dropped),
              })
            }
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage ?? new Usage({}),
              metadata: value.providerMetadata,
            })
            ctx.assistantMessage.finish = value.reason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            const finish = {
              id: PartID.ascending(),
              reason: value.reason,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            } satisfies SessionV1.StepFinishPart
            yield* session.updatePart(finish)
            yield* session.updateMessage(ctx.assistantMessage)
            const start = ctx.snapshot
            ctx.snapshot = undefined
            const patch = start ? recordPatch(start) : undefined
            // The "after" snapshot and the patch run off the critical path. The next step's write-capable
            // tools wait for them, and the summary is computed only once both hashes are recorded.
            yield* background(
              ctx.sessionID,
              publish,
              (publication) => Effect.gen(function* () {
                if (start) yield* awaitSnapshot(start)
                if (!publication.allowed) return
                const completed = yield* snapshot.track(ctx.sessionID)
                if (completed) yield* publishSnapshot(publication, { ...finish, snapshot: completed })
                if (!publication.allowed) return
                if (patch) yield* patch(publication)
                if (!publication.allowed) return
                yield* summarizeSnapshots
                return completed
              }),
            )
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            yield* mutate(
              Effect.gen(function* () {
                boundary = stopSequences && textStop(stopSequences)
                ctx.currentText = {
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.assistantMessage.sessionID,
                  type: "text",
                  text: "",
                  time: { start: Date.now() },
                  metadata: value.providerMetadata,
                }
                yield* session.updatePart(ctx.currentText)
              }),
            )
            return

          case "text-delta": {
            if (!ctx.currentText) return
            const delta = boundary?.push(value.text)
            yield* publishText(delta ? delta.text : value.text, value.providerMetadata)
            stopped = delta?.stop
            return
          }

          case "text-end":
            yield* finishText(value.providerMetadata)
            return

          case "finish":
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          yield* background(ctx.sessionID, publish, recordPatch(ctx.snapshot))
          ctx.snapshot = undefined
        }

        yield* mutateTool(
          Effect.gen(function* () {
            acceptingToolCalls = false
            clearRaw()
            if (ctx.currentText) {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
              yield* session.updatePart(ctx.currentText)
              ctx.currentText = undefined
            }

            for (const part of Object.values(ctx.reasoningMap)) {
              const end = Date.now()
              yield* session.updatePart({
                ...part,
                time: { start: part.time.start ?? end, end },
              })
            }
            ctx.reasoningMap = {}
          }),
        )

        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )

        yield* mutateTool(
          Effect.gen(function* () {
            for (const toolCallID of Object.keys(ctx.toolcalls)) {
              const match = yield* readToolCall(toolCallID)
              if (!match) continue
              const part = match.part
              if (part.state.status !== "pending" && part.state.status !== "running") continue
              const end = Date.now()
              const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
              yield* session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  metadata: { ...metadata, interrupted: true },
                  time: { start: "time" in part.state ? part.state.time.start : end, end },
                },
              })
            }
            ctx.toolcalls = {}
          }),
        )
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
        if (snapshotSkipped) yield* summarizeSnapshots
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown, replacement: boolean) {
        yield* mutateTool(Effect.sync(clearRaw))
        if (e instanceof MeridianRouting.DispatchBlocked) {
          dispatchBlocked = true
          return
        }
        const sqlite = TransactionDiagnostic.get(e)
        yield* Effect.logError("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
          error: errorMessage(e),
          stack: e instanceof Error ? e.stack : undefined,
          ...(sqlite ? { sqlite } : {}),
        })
        const error = parse(e)
        if (!replacement && SessionV1.ContextOverflowError.isInstance(error)) {
          if ((yield* config.get()).compaction?.auto === false && !ctx.assistantMessage.summary) {
            ctx.assistantMessage.error = error
            ctx.assistantMessage.finish = "error"
            yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            yield* status.set(ctx.sessionID, { type: "idle" })
            return
          }
          ctx.needsCompaction = true
          yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        // A compaction's summary is not a step to run again later, so its refusal fails it as before.
        const refusal = ctx.assistantMessage.summary ? undefined : SessionPause.refusal(error)
        if (refusal) {
          ctx.refusal = refusal
          if (attempts === 1) routeRefusal = MeridianRouting.refusalOf(e)
          return
        }
        ctx.assistantMessage.error = error
        if (!replacement) {
          yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
        }
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        yield* Effect.logInfo("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
        })
        ctx.needsCompaction = false
        ctx.refusal = undefined
        routeRefusal = undefined
        hasEffects = false
        dispatchBlocked = false
        attempts = 0
        const singleDispatch = !!streamInput.beforeDispatch && streamInput.retries === 0
        const replacement = singleDispatch && !streamInput.preferredReturn
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true
        const tools = Object.fromEntries(Object.entries(streamInput.tools).map(([name, tool]) => {
          const observed = { ...tool }
          if (tool.execute) observed.execute = observeTool(tool.execute)
          if (tool.onInputStart) observed.onInputStart = observeTool(tool.onInputStart)
          if (tool.onInputDelta) observed.onInputDelta = observeTool(tool.onInputDelta)
          if (tool.onInputAvailable) observed.onInputAvailable = observeTool(tool.onInputAvailable)
          return [name, observed]
        }))

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            attempts++
            yield* mutate(
              Effect.sync(() => {
                if (ctx.currentText && ctx.currentText.time?.end === undefined) {
                  abandoned.set(ctx.currentText.id, ctx.currentText)
                }
                for (const part of Object.values(ctx.reasoningMap)) {
                  if (part.time.end === undefined) abandoned.set(part.id, part)
                }
                ctx.currentText = undefined
                ctx.reasoningMap = {}
              }),
            )
            stopped = undefined
            acceptedNarrative = false
            yield* status.set(ctx.sessionID, { type: "busy" })
            const stream = llm.stream({ ...streamInput, tools })

            if (!stopSequences) {
              yield* stream.pipe(
                Stream.tap((event) => handleEvent(event)),
                Stream.takeUntil(() => ctx.needsCompaction),
                Stream.runDrain,
              )
              return
            }
            yield* stream.pipe(
              Stream.takeUntilEffect((event) =>
                handleEvent(event).pipe(Effect.map(() => stopped !== undefined || ctx.needsCompaction)),
              ),
              Stream.runDrain,
              Effect.scoped,
            )
          }).pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => completingText ? Effect.die(Cause.squash(cause)) : Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry({
              schedule: SessionRetry.policy({
                provider: input.model.providerID,
                parse,
                set: (info) => {
                  return status.set(ctx.sessionID, {
                    type: "retry",
                    attempt: info.attempt,
                    message: info.message,
                    action: info.action,
                    next: info.next,
                  })
                },
              }),
              // Meridian has already tried every account; retrying cannot help, and the step is parked instead.
              while: (error) =>
                !singleDispatch &&
                !(error instanceof MeridianRouting.DispatchBlocked) &&
                !SessionPause.refusal(parse(error)),
            }),
            Effect.andThen(() =>
              Effect.gen(function* () {
                if (!stopSequences) return
                if (stopped !== undefined) yield* finishStoppedText(stopped)
                if (ctx.assistantMessage.summary && !acceptedNarrative) {
                  throw new Error("Compaction produced no accepted narrative")
                }
              }),
            ),
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                abort = yield* SessionAbort.metadata
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"), replacement)
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.catch((error) => halt(error, replacement)),
            Effect.ensuring(cleanup()),
          )

          if (ctx.refusal || dispatchBlocked) return "stop"
          if (ctx.needsCompaction) return "compact"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      }, (work) => work.pipe(Effect.ensuring(Effect.sync(() => {
        abandoned.clear()
        unregister()
      }))))

      return {
        get message() {
          return ctx.assistantMessage
        },
        get refusal() {
          return ctx.refusal
        },
        get routeRefusal() {
          return hasEffects ? undefined : routeRefusal
        },
        get hasEffects() {
          return hasEffects
        },
        get dispatchBlocked() {
          return dispatchBlocked
        },
        updateToolCall,
        completeToolCall,
        process,
        waitForSnapshots,
        skipSnapshot,
      } satisfies Handle
    })

    return Service.of({ create, settle })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Session.node,
    Config.node,
    Snapshot.node,
    Agent.node,
    LLM.node,
    Permission.node,
    Plugin.node,
    SessionSummary.node,
    SessionStatus.node,
    Image.node,
    EventV2Bridge.node,
    Database.node,
    LiveEvents.node,
  ],
})

export * as SessionProcessor from "./processor"
