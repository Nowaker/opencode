export * as SessionRunnerLLM from "./llm.js"

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Cause, Clock, Effect, Exit, FiberMap, Layer } from "effect"
import type { RouteSwitch } from "@opencode/schema/route-switch"
import { Database } from "../../database/database.js"
import { Bus } from "../../bus.js"
import { LocationLifecycle } from "../../location-lifecycle.js"
import { InstructionState } from "../instruction-state.js"
import { SessionCompaction } from "../compaction.js"
import { SessionContext } from "../context.js"
import { SessionEvent } from "../event.js"
import { SessionInbox } from "../inbox.js"
import { SessionBackground } from "../background.js"
import { SubagentGroup } from "../subagent-group.js"
import { Job } from "../../job.js"
import { SessionHistory } from "../history.js"
import { SessionModelTransport } from "../model-transport.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { SessionMessageTable } from "../sql.js"
import { SessionTitle } from "../title.js"
import { toSessionError } from "../to-session-error.js"
import { DrainResult, Service, type Interface } from "./index.js"
import { Snapshot } from "../../snapshot.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { llmClient } from "../../effect/app-node-platform.js"
import { StepFailedError } from "../error.js"
import { SessionRunnerRetry } from "./retry.js"
import { SessionStep } from "./step.js"
import { ToolOutput } from "../../tool-output.js"
import { Plugin } from "../../plugin.js"
import { PluginHooks } from "../../plugin/hooks.js"
import { Model } from "../../model.js"
import { MeridianRouting } from "../../plugin/provider/meridian-routing.js"
import { SessionRouteSwitch } from "../route-switch.js"
import { exactRoute, sameRoute } from "../route-switch-policy.js"
import { make as makeRouteSwitch, returnDue } from "./route-switch.js"
import { prepare } from "./route-transcript.js"

const CONTINUE_AFTER_INCOMPLETE_STREAM =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

const CONTINUE_AFTER_OUTPUT_LIMIT =
  "Your last response hit the output token limit (stop reason: length). Do not apologize, recap, or repeat yourself. Break the remaining work into smaller pieces."

type DrainInput = Parameters<Interface["drain"]>[0]

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const lifecycle = yield* LocationLifecycle.Service
    const store = yield* SessionStore.Service
    const context = yield* SessionContext.Service
    const modelTransport = yield* SessionModelTransport.Service
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const plugins = yield* Plugin.Service
    const hooks = yield* PluginHooks.Service
    const jobs = yield* Job.Service
    const title = yield* SessionTitle.Service
    const steps = yield* SessionStep.make
    const routeSwitch = yield* makeRouteSwitch
    // Title generation starts once input is visible and must not delay model execution.
    const titles = yield* FiberMap.make<SessionSchema.ID, void, never>()

    // Each drain is one turn and starts its own trace, whatever fiber woke it.
    const drain = Effect.fn("SessionRunner.drain", { root: true })(function* (input: DrainInput) {
      const sessionID = input.sessionID
      let force = input.force
      let continuing = input.continuation !== undefined
      let step = input.continuation?.step ?? 1
      let entering = true
      let stepped = input.stepped ?? false
      const promotable = input.promotable ?? "input"
      if (!force && !continuing && !stepped) {
        const pending = yield* SessionInbox.nextPromotable(db, sessionID, "input")
        if (!pending) return DrainResult.Complete()
        const control = pending.type === "compaction" || pending.type === "move"
        if (promotable === "steer" && pending.delivery === "queue" && !control) return DrainResult.Complete()
      }
      yield* plugins.awaitActivation
      if (input.owner && process.env.VIBETERM_AUTO_SWITCH_POLICY_MODULE) {
        const session = yield* store.get(sessionID)
        if (session && !(yield* routeSwitch.recover(session, input.owner)))
          return yield* new StepFailedError({ error: unsafeRecovery })
      }
      yield* settleStaleCompactions(sessionID)
      yield* settleStaleToolCalls(sessionID)

      const advanceToStep = Effect.fn("SessionRunner.advanceToStep")(() =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            while (true) {
              if (lifecycle.isClosed()) {
                yield* restore(modelTransport.close(sessionID))
                return DrainResult.Reloaded({
                  force,
                  continuation: continuing ? { step } : undefined,
                  stepped: !continuing && stepped ? true : undefined,
                })
              }
              // Location entry and idle boundaries allow queued controls, not necessarily queued prompts.
              const pending = yield* SessionInbox.serialized(
                sessionID,
                Effect.gen(function* () {
                  const next = yield* SessionInbox.nextPromotable(
                    db,
                    sessionID,
                    entering || !continuing ? "input" : "steer",
                  )
                  if (next?.type === "compaction")
                    yield* bus.publishAll([
                      [SessionEvent.InboxDelivered, { sessionID, inboxID: next.id }],
                      [SessionEvent.Compaction.Started, { sessionID, reason: "manual", inputID: next.id }],
                    ])
                  if (next?.type === "move")
                    yield* restore(
                      Effect.gen(function* () {
                        yield* modelTransport.close(sessionID)
                        yield* bus.publishAll([
                          [SessionEvent.InboxDelivered, { sessionID, inboxID: next.id }],
                          [SessionEvent.Moved, { sessionID, ...next.payload }],
                        ])
                      }),
                    )
                  return next
                }),
              )
              if (!continuing && pending?.delivery !== "steer") {
                entering = true
                step = 1
              }
              if (pending?.type === "move")
                return DrainResult.Moved({
                  continuation: continuing ? { step } : undefined,
                  stepped: !continuing && stepped ? true : undefined,
                })
              if (pending?.type === "compaction") {
                const compacted = yield* restore(
                  Effect.gen(function* () {
                    yield* plugins.awaitActivation
                    const selected = yield* context.select(sessionID)
                    const model = yield* context.resolveModel(selected.session, {
                      kind: "compaction",
                      agent: selected.agent.id,
                    })
                    // Preview updates without admitting them after the already-delivered compaction marker.
                    const history = yield* SessionHistory.preview(db, sessionID, selected.instructions, model.ref)
                    return yield* compaction.compact({
                      reason: "manual",
                      inputID: pending.id,
                      context: {
                        session: selected.session,
                        agent: selected.agent,
                        tools: selected.tools,
                        model,
                        initial: history.initial,
                        messages: history.messages,
                      },
                    })
                  }).pipe(
                    Effect.catch((error) =>
                      bus.publish(SessionEvent.Compaction.Failed, {
                        sessionID,
                        reason: "manual",
                        inputID: pending.id,
                        error: toSessionError(error),
                      }),
                    ),
                  ),
                ).pipe(Effect.exit)
                if (Exit.isFailure(compacted)) {
                  const unsettled = yield* db
                    .select({ id: SessionMessageTable.id })
                    .from(SessionMessageTable)
                    .where(
                      and(
                        eq(SessionMessageTable.session_id, sessionID),
                        eq(SessionMessageTable.id, pending.id),
                        sql`json_extract(${SessionMessageTable.data}, '$.status') = 'running'`,
                      ),
                    )
                    .get()
                    .pipe(Effect.orDie)
                  if (unsettled)
                    yield* bus.publish(SessionEvent.Compaction.Failed, {
                      sessionID,
                      reason: "manual",
                      error: Cause.hasInterruptsOnly(compacted.cause)
                        ? { type: "aborted", message: "Compaction cancelled" }
                        : { type: "compaction.failed", message: Cause.pretty(compacted.cause) },
                      inputID: pending.id,
                    })
                  return yield* Effect.failCause(compacted.cause)
                }
                force = false
                continue
              }
              if (!force && !continuing && (!pending || (pending.delivery === "queue" && promotable === "steer"))) {
                // Control-only drains such as a manual compaction never ran the model, so they skip the hook.
                if (pending || !stepped) return DrainResult.Complete()
                // The Session would go idle; a plugin may admit input to keep this execution working.
                yield* restore(
                  SessionBackground.outstanding({ ...jobs, groups: SubagentGroup.pending(db) }, store, sessionID).pipe(
                    Effect.flatMap((background) =>
                      hooks.trigger("session", "experimental.idle", { sessionID, background }),
                    ),
                  ),
                )
                if (!(yield* SessionInbox.has(db, sessionID, "input"))) return DrainResult.Complete()
                continue
              }
              const ready = yield* restore(
                Effect.gen(function* () {
                  const selected = yield* prepareContext(sessionID)
                  const promoted = yield* SessionInbox.promoteAdmissions(
                    db,
                    bus,
                    sessionID,
                    entering && !continuing ? promotable : "steer",
                  )
                  // A control admitted during context preparation owns this boundary.
                  if (promoted === undefined) return undefined
                  if (
                    input.owner &&
                    process.env.VIBETERM_AUTO_SWITCH_POLICY_MODULE &&
                    !(yield* routeSwitch.begin(selected.session, input.owner, promoted))
                  )
                    return yield* new StepFailedError({ error: unsafeRecovery })
                  if (promoted.length > 0 && !selected.session.parentID && SessionTitle.isUntitled(selected.session))
                    yield* FiberMap.run(
                      titles,
                      sessionID,
                      // A closed engine starts no new title request; the title stays until the next one.
                      title.generate(sessionID).pipe(Effect.catchTag("EngineStop.RefusedError", () => Effect.void)),
                      { onlyIfMissing: true },
                    )
                  if (promoted.length > 0) step = 1
                  return { _tag: "Ready" as const, context: yield* context.load(selected) }
                }),
              )
              if (ready) return ready
            }
          }),
        ),
      )

      while (true) {
        const next = yield* advanceToStep()
        if (next._tag !== "Ready") return next
        const owner = process.env.VIBETERM_AUTO_SWITCH_POLICY_MODULE ? input.owner : undefined
        const settled = yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const result = yield* restore(runStep(next.context, step, { owner, force })).pipe(Effect.exit)
            if (owner && (Exit.isFailure(result) || !result.value.continuing))
              yield* routeSwitch.settle(next.context.session, owner, Exit.isSuccess(result))
            if (owner && Exit.isSuccess(result) && result.value.continuing)
              yield* routeSwitch.closeReturnWindow(next.context.session, owner)
            if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause)
            return result.value
          }),
        )
        continuing = settled.continuing
        stepped = true
        step = settled.step + 1
        force = false
        entering = false
      }
    })

    const prepareContext = Effect.fn("SessionRunner.prepareContext")(function* (sessionID: SessionSchema.ID) {
      // Plugins can reload mid-turn; each step and retry must read the settled agents, models and skills.
      yield* plugins.awaitActivation
      const selected = yield* context.select(sessionID)
      // A blocked initial instruction baseline must leave admitted input pending.
      yield* InstructionState.prepare(db, bus, selected.instructions, sessionID)
      return selected
    })

    /** Owns logical Step policy; each attempt owns its streaming, tools, and durable settlement. */
    const runStep = Effect.fn("SessionRunner.runStep")(function* (
      first: SessionContext.Loaded,
      initialStep: number,
      execution: { owner: DrainInput["owner"]; force: boolean },
    ) {
      const sessionID = first.session.id
      const owner = execution.owner
      let step = initialStep
      let assistantMessageID = SessionMessage.ID.create()
      const retry = yield* SessionRunnerRetry.make(bus, sessionID)
      let initial: SessionContext.Loaded | undefined = first
      let recoverOverflow = true
      let recoverContinuation = true
      let retryAttempt: number | undefined
      let dispatched = false
      while (true) {
        // Reuse boundary preparation once; retries refresh context without delivering more input.
        const preferred = initial ?? (yield* prepareContext(sessionID).pipe(Effect.flatMap(context.load)))
        initial = undefined
        let fence = owner ? yield* routeSwitch.observe(preferred, owner) : undefined
        const manual = fence?.state.manualRetry
        const manualStop =
          execution.force && owner?.retry && manual?.id === owner.retry && manual.state === "requested"
            ? fence?.state.quotaStop
            : undefined
        if (execution.force && owner?.retry && !manualStop) return yield* new StepFailedError({ error: unsafeRecovery })
        if (manualStop) step = manualStop.step
        const sticky = fence?.state.sticky
        let target = sticky?.effective
        let kind: "return" | "sticky" | undefined = target ? "sticky" : undefined
        if (fence && sticky) {
          const manual = fence.state.manualReturn && fence.turn?.afterSettlement && step === 1
          if (!fence.policy.enabled || manual) {
            if (!(yield* routeSwitch.resetSticky(fence))) return yield* new StepFailedError({ error: unsafeRecovery })
            yield* routeSwitch.updated(sessionID)
            target = undefined
            kind = undefined
            fence = yield* routeSwitch.observe(preferred, fence.owner)
          } else if (
            !dispatched &&
            step === 1 &&
            fence.policy.returnEnabled &&
            returnDue(fence.state, yield* Clock.currentTimeMillis)
          ) {
            target = sticky.preferred
            kind = "return"
          }
        }
        const attemptOn = (
          loaded: SessionContext.Loaded,
          prepared: NonNullable<Effect.Success<ReturnType<typeof prepare>>>,
          routing?: MeridianRouting.Binding,
          singleSend = false,
        ) =>
          steps.attempt({
            isLocationClosed: lifecycle.isClosed,
            sessionID,
            assistantMessageID,
            agent: loaded.agent.id,
            toolAgent: preferred.agent.id,
            model: loaded.model,
            prepared: {
              ...prepared,
              // A tool call can arrive during a reload; its permission check reads the session's agent.
              executeTool: (call) => plugins.awaitActivation.pipe(Effect.andThen(prepared.executeTool(call))),
            },
            retryAttempt,
            routing,
            singleSend,
            retry: (cause, error, proposed) =>
              retry.decide({
                cause,
                error,
                agent: loaded.agent.id,
                model: loaded.model.ref,
                hook: prepared.retry,
                retry: proposed,
              }),
            recoverContinuation,
            recoverOverflow: Effect.suspend(() =>
              recoverOverflow
                ? compaction
                    .compact({
                      reason: "overflow",
                      context: loaded,
                      estimate: SessionCompaction.estimatePrompt(loaded),
                    })
                    .pipe(Effect.map((result) => result.status === "completed"))
                : Effect.succeed(false),
            ),
          })
        const candidate = Effect.fnUntraced(
          function* (target: RouteSwitch.Route) {
            const selection = yield* context.select(sessionID)
            const loaded = yield* context.loadRoute(selection, target)
            if (!loaded) return
            const prepared = yield* prepare({ context, loaded, step, portable: true, http: true })
            if (!prepared) return
            return { loaded, prepared }
          },
          Effect.orElseSucceed(() => undefined),
        )
        let routed = target ? yield* candidate(target) : undefined
        const proof =
          routed && target && kind === "return"
            ? yield* MeridianRouting.probe({ ...routed.prepared, selection: target })
            : undefined
        if (!proof && kind === "return" && sticky) {
          target = sticky.effective
          kind = "sticky"
          routed = yield* candidate(target)
        }
        let loaded = routed?.loaded ?? preferred
        let effective = exactRoute(loaded.agent.id, loaded.model.ref)
        let outcome: SessionStep.Outcome
        const runClaimed = Effect.fnUntraced(function* (input: {
          readonly fence: NonNullable<typeof fence>
          readonly via: NonNullable<typeof routed>
          readonly proof: MeridianRouting.Availability
          readonly kind: "alternate" | "return"
          readonly source: RouteSwitch.Route
          readonly sourceAttemptID?: SessionMessage.ID
        }) {
          const id = assistantMessageID
          const binding = input.proof.bindDispatch({
            allow: routeSwitch
              .claim(input.fence, {
                kind: input.kind,
                step,
                source: input.source,
                target: exactRoute(input.via.loaded.agent.id, input.via.loaded.model.ref),
                sourceAttemptID: input.sourceAttemptID,
                targetAttemptID: id,
              })
              .pipe(
                Effect.tap((accepted) => (accepted ? Effect.forkChild(routeSwitch.updated(sessionID)) : Effect.void)),
              ),
          })
          return yield* attemptOn(input.via.loaded, input.via.prepared, binding, true).pipe(
            Effect.onExit((exit) =>
              routeSwitch.finish(
                input.fence,
                id,
                Exit.isSuccess(exit) ? (exit.value._tag === "Refused" ? "failed" : "succeeded") : "unknown",
              ),
            ),
          )
        })
        if (manualStop && fence) {
          const observed = fence
          const target = yield* candidate(manualStop.route)
          if (!target) {
            yield* routeSwitch.finishManual(observed, false)
            return yield* new StepFailedError({ error: unsafeRecovery })
          }
          const binding = yield* MeridianRouting.guard(
            { ...target.prepared, selection: manualStop.route },
            {
              allow: routeSwitch.claimManual(observed, manualStop.route),
            },
          )
          if (!binding) {
            yield* routeSwitch.finishManual(observed, false)
            return yield* new StepFailedError({ error: unsafeRecovery })
          }
          loaded = target.loaded
          effective = manualStop.route
          outcome = yield* attemptOn(loaded, target.prepared, binding, true).pipe(
            Effect.onExit((exit) => routeSwitch.finishManual(observed, Exit.isSuccess(exit))),
          )
        } else if (routed && fence && kind === "return" && sticky && proof) {
          outcome = yield* runClaimed({ fence, via: routed, kind, proof, source: sticky.effective })
          if (outcome._tag === "Refused") {
            const refreshed = yield* routeSwitch.observe(preferred, fence.owner)
            if (
              refreshed.state.revision !== fence.state.revision + 2 ||
              refreshed.policy.policyRevision !== fence.policy.policyRevision
            )
              fence = undefined
            else fence = { ...refreshed, revision: fence.revision }
          }
        } else if (routed && fence && kind === "sticky") {
          const binding = yield* MeridianRouting.guard(
            { ...routed.prepared, selection: effective },
            {
              allow: routeSwitch.validateSticky(fence, effective),
            },
          )
          if (!binding) return yield* new StepFailedError({ error: unsafeRecovery })
          outcome = yield* attemptOn(loaded, routed.prepared, binding, true)
        } else {
          if (kind)
            return yield* new StepFailedError({
              error: { type: "route.ineligible", message: "The alternate route cannot serve this step safely" },
            })
          const portable = fence?.state.lastAlternate?.outcome === "succeeded"
          if (!portable) {
            const estimate = SessionCompaction.estimatePrompt(loaded)
            const compacted = yield* compaction.compact({ reason: "auto", context: loaded, estimate })
            if (compacted.status === "failed") return yield* new StepFailedError({ error: compacted.error })
            if (compacted.status === "completed") {
              assistantMessageID = SessionMessage.ID.create()
              continue
            }
            yield* compaction.precompute(Effect.succeed(loaded), estimate)
          }
          if (portable) recoverOverflow = false
          const prepared = yield* prepare({
            context,
            loaded,
            step,
            portable,
            http: !!fence?.policy.enabled || portable,
          })
          if (!prepared) return yield* new StepFailedError({ error: unsafeRecovery })
          const binding =
            fence && !dispatched ? yield* MeridianRouting.bind({ ...prepared, selection: effective }) : undefined
          dispatched = true
          outcome = yield* attemptOn(loaded, prepared, binding)
        }
        if (outcome._tag === "Refused") {
          const reason = fence?.turn?.alternate
            ? "attempted"
            : !fence?.policy.enabled
              ? (fence?.policy.reason ?? "unsafe-step")
              : fence.policy.alternates.length === 0
                ? "no-approved-alternate"
                : "route-ineligible"
          if (
            !manualStop &&
            fence?.policy.enabled &&
            fence.turn &&
            !fence.turn.alternate &&
            sameRoute(fence.preferred, effective)
          ) {
            const attempted = assistantMessageID
            for (const alternative of fence.policy.alternates) {
              if (alternative.providerID === effective.providerID) continue
              const target = yield* candidate(alternative)
              if (!target) continue
              const proof = yield* MeridianRouting.probe({ ...target.prepared, selection: alternative })
              if (!proof) continue
              assistantMessageID = SessionMessage.ID.create()
              const source = effective
              loaded = target.loaded
              effective = alternative
              outcome = yield* runClaimed({
                fence,
                via: target,
                kind: "alternate",
                proof,
                source,
                sourceAttemptID: attempted,
              })
              break
            }
          }
          if (outcome._tag === "Refused") {
            if (fence)
              yield* routeSwitch.recordStop(
                fence,
                { route: effective, assistantID: assistantMessageID, step },
                outcome.refusal,
                reason,
              )
            return yield* new StepFailedError({ error: outcome.error })
          }
        }
        retryAttempt = undefined
        const completed = yield* SessionStep.Outcome.$match(outcome, {
          Completed: Effect.fnUntraced(function* (outcome) {
            if (fence?.state.quotaStop) yield* routeSwitch.clearStop(fence, effective)
            // The Session is about to go idle, which leaves the background summary time to finish.
            if (!outcome.needsContinuation && !routed && sameRoute(effective, fence?.preferred ?? effective))
              yield* compaction.precompute(
                store.context(sessionID).pipe(Effect.map((messages) => ({ ...loaded, messages }))),
              )
            return outcome.needsContinuation
          }),
          Retry: Effect.fnUntraced(function* (outcome) {
            retryAttempt = outcome.decision.attempt
            yield* retry.wait({
              decision: outcome.decision,
              error: outcome.error,
              assistantMessageID,
            })
          }),
          Continue: Effect.fnUntraced(function* (outcome) {
            retryAttempt = outcome.decision.attempt
            yield* retry.wait({
              decision: outcome.decision,
              error: outcome.error,
              assistantMessageID,
            })
            yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CONTINUE_AFTER_INCOMPLETE_STREAM })
            assistantMessageID = SessionMessage.ID.create()
          }),
          OutputLimit: Effect.fn("SessionRunner.continueOutputLimit")(function* (outcome) {
            // The current response is included. User input or any other finish breaks the streak.
            const recent = yield* db
              .select({
                type: SessionMessageTable.type,
                finish: sql<string | null>`json_extract(${SessionMessageTable.data}, '$.finish')`,
              })
              .from(SessionMessageTable)
              .where(
                and(
                  eq(SessionMessageTable.session_id, sessionID),
                  inArray(SessionMessageTable.type, ["user", "assistant"]),
                ),
              )
              .orderBy(desc(SessionMessageTable.seq))
              .limit(3)
              .all()
              .pipe(Effect.orDie)
            const exhausted =
              recent.length === 3 && recent.every((row) => row.type === "assistant" && row.finish === "length")
            if (exhausted)
              return yield* new StepFailedError({
                error: {
                  type: "output-limit",
                  message: "Response still truncated after two output token limit continuations",
                },
              })
            if (outcome.needsContinuation) return true
            yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CONTINUE_AFTER_OUTPUT_LIMIT })
            assistantMessageID = SessionMessage.ID.create()
          }),
          Compacted: Effect.fnUntraced(function* () {
            recoverOverflow = false
            assistantMessageID = SessionMessage.ID.create()
          }),
          RecoverFull: Effect.fnUntraced(function* () {
            recoverContinuation = false
          }),
          Refused: (outcome) => Effect.fail(new StepFailedError({ error: outcome.error })),
        })
        if (completed !== undefined) return { continuing: completed, step }
      }
    })

    const settleStaleCompactions = Effect.fn("SessionRunner.settleStaleCompactions")(function* (
      sessionID: SessionSchema.ID,
    ) {
      // A process death skips compaction finalizers. Include orphans behind a
      // completed checkpoint, and settle newest first to match event projection.
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(
          and(
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, "compaction"),
            sql`json_extract(${SessionMessageTable.data}, '$.status') = 'running'`,
          ),
        )
        .orderBy(desc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      for (const row of rows) {
        const message = yield* SessionHistory.decodeMessageRow(row)
        if (message.type !== "compaction") continue
        yield* bus.publish(SessionEvent.Compaction.Failed, {
          sessionID,
          reason: message.reason,
          inputID: message.id,
          error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
        })
      }
    })

    const settleStaleToolCalls = Effect.fn("SessionRunner.settleStaleToolCalls")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* SessionHistory.incompleteAssistants(db, sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "streaming" && tool.state.status !== "running")) continue
          const metadata = tool.state.status === "running" ? tool.state.metadata : undefined
          const childID =
            tool.name === "subagent" && typeof metadata?.sessionID === "string" ? metadata.sessionID : undefined
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID: message.id,
            id: tool.id,
            error: {
              type: "aborted",
              message: `Tool execution interrupted: ${tool.name}${childID ? ` (sessionID: ${childID})` : ""}`,
            },
            ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
            executed: tool.executed === true,
          })
        }
      }
    })

    return Service.of({
      drain: (input) => drain(input).pipe(Effect.annotateSpans("session.id", input.sessionID)),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Bus.node,
    LocationLifecycle.node,
    llmClient,
    SessionContext.node,
    SessionModelTransport.node,
    SessionStore.node,
    SessionCompaction.node,
    Plugin.node,
    PluginHooks.node,
    Job.node,
    SessionTitle.node,
    Snapshot.node,
    ToolOutput.node,
    Database.node,
    Model.node,
    SessionRouteSwitch.node,
  ],
})

const unsafeRecovery = {
  type: "route.unsafe-step",
  message: "Route attempt cannot be safely continued; submit new work to resume",
}
