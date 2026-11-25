import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Global } from "@opencode-ai/core/global"
import { appendFile, mkdir } from "node:fs/promises"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"
import { MeridianRouting } from "@/provider/meridian-routing"
import { AutoSwitch } from "./auto-switch"
import { AutoSwitchAdmission } from "./auto-switch-admission"
import { AutoSwitchSchema } from "./auto-switch-schema"
import { AutoSwitchTranscript } from "./auto-switch-transcript"

import { type Tool as AITool, tool, jsonSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { usable } from "./overflow"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import { MAX_STEPS_PROMPT } from "@opencode-ai/core/session/runner/max-steps"
import { ToolRegistry } from "@/tool/registry"
import { ToolJsonSchema } from "@/tool/json-schema"
import { McpCatalog } from "@/mcp/catalog"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { SessionPause } from "./pause"
import { SessionArchive } from "./archive"
import { Unarchive } from "@opencode-ai/schema/session-archive"
import { EffectBridge } from "@/effect/bridge"
import { LLM } from "./llm"
import { Shell } from "@opencode-ai/core/shell"
import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Deferred, Effect, Exit, Latch, Layer, Option, Scope, Semaphore, Context, Schema, Types } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { SessionAbort } from "./abort"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseTransaction } from "@opencode-ai/core/database/transaction"
import { LiveEvents } from "./live-events"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { and, eq } from "drizzle-orm"
import { MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionReminders } from "./reminders"
import { NotFoundError } from "@/storage/storage"
import { SessionTools } from "./tools"
import { LLMEvent } from "@opencode-ai/llm"
import { OwnerQuiescence } from "@/owner/quiescence"
import { Question } from "@/question"
import { isRecord } from "@/util/record"
import { errorMessage } from "@/util/error"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)
const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

function mcpResourceBase64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

function formatMcpResourceBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

const COMPACTION_DEBUG_LOG = path.join(Global.Path.log, "compaction-debug.log")
let compactionDebugDirectory: Promise<string | undefined> | undefined

function compactionDebug(input: {
  event: string
  sessionID: SessionID
  step: number
  payload?: Record<string, unknown>
}) {
  return Effect.tryPromise(async () => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event: input.event,
      sessionID: input.sessionID,
      step: input.step,
      ...(input.payload ?? {}),
    })
    compactionDebugDirectory ??= mkdir(path.dirname(COMPACTION_DEBUG_LOG), { recursive: true })
    await compactionDebugDirectory
    await appendFile(COMPACTION_DEBUG_LOG, line + "\n")
  }).pipe(Effect.ignore)
}

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  // They are not pending work and must not trigger an assistant-prefill request.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

/*
 * With `queued_prompts: "turn_end"`, a turn still in its tool chain reads no user input stored after its own prompt.
 * Those prompts and notes stay in history and the loop answers them once the turn ends. A compaction or subtask
 * request is the loop's own work rather than input, so it is never held.
 */
function holdForTurnEnd(msgs: SessionV1.WithParts[]) {
  const last = MessageV2.latest(msgs).assistant
  const step = last && msgs.findLast((msg) => msg.info.id === last.id)
  if (!last?.finish || last.error || !step) return msgs
  const toolCalls = step.parts.some(
    (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
  )
  if (!["tool-calls", "unknown"].includes(last.finish) && !toolCalls) return msgs
  const prompt = msgs.find((msg) => msg.info.id === last.parentID)?.info
  if (!prompt) return msgs
  return msgs.filter(
    (msg) =>
      msg.info.role !== "user" ||
      msg.info.time.created < prompt.time.created ||
      (msg.info.time.created === prompt.time.created && msg.info.id <= prompt.id) ||
      msg.parts.some((part) => part.type === "compaction" || part.type === "subtask"),
  )
}

/*
 * Once the held turn has ended, the prompts and notes it held are what the loop answers next, but they are stored
 * where they arrived, between that turn's tool steps. Sent in that order the request ends with the turn's own final
 * answer and the model finds no new input: on 2026-11-11 it answered a held note with "your latest message arrived
 * empty". Every user message stored after the prompt the ended turn answered, and placed before that turn's final
 * step, goes after that step instead, in its stored order. This changes only what the model is sent.
 */
function answerAfterTurn(msgs: SessionV1.WithParts[]) {
  const last = MessageV2.latest(msgs).assistant
  const index = last ? msgs.findLastIndex((msg) => msg.info.id === last.id) : -1
  if (!last?.finish || last.error || index === -1) return msgs
  const toolCalls = msgs[index].parts.some(
    (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
  )
  if (["tool-calls", "unknown"].includes(last.finish) || toolCalls) return msgs
  const prompt = msgs.find((msg) => msg.info.id === last.parentID)?.info
  if (!prompt) return msgs
  const held = (msg: SessionV1.WithParts, position: number) =>
    position < index &&
    msg.info.role === "user" &&
    (msg.info.time.created > prompt.time.created ||
      (msg.info.time.created === prompt.time.created && msg.info.id > prompt.id))
  const moved = msgs.filter(held)
  if (moved.length === 0) return msgs
  const kept = msgs.filter((msg, position) => !held(msg, position))
  const after = kept.findIndex((msg) => msg.info.id === last.id) + 1
  return [...kept.slice(0, after), ...moved, ...kept.slice(after)]
}

function turnAt(msgs: SessionV1.WithParts[]) {
  const latest = MessageV2.latest(msgs)
  const assistantMessage = msgs.findLast((msg) => msg.info.id === latest.assistant?.id)
  // A stop with tool calls still needs to send their results back to the model.
  const hasToolCalls =
    assistantMessage?.parts.some(
      (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
    ) ?? false
  const finished =
    !!latest.assistant?.finish &&
    !["tool-calls", "unknown"].includes(latest.assistant.finish) &&
    !hasToolCalls &&
    latest.assistant.parentID === latest.user?.id
  return { latest, assistantMessage, hasToolCalls, finished }
}

/*
 * Which prompts a paused session holds until unpause. Decided 2026-11-14: everything that does not ask to unpause,
 * which is all automated input (other sessions' prompts, schedules, OMO and bash notices); a person's send from the
 * TUI composer or Portal passes `unpause: true` and runs the deferred calls first, then itself.
 */
function heldWhilePaused(input: PromptInput) {
  return input.unpause !== true
}

type Route = { readonly providerID: string; readonly modelID: string }

function sameRoute(left: Route, right: Route) {
  return left.providerID === right.providerID && left.modelID === right.modelID
}

/*
 * A no-routable-account park refuses one route - a provider and model, which carries the pool, a CVP requirement
 * or a pinned account - not the session. A prompt that names another route is not held by it: the park lifts and
 * that prompt runs (ses_e13fbe595ffeLpn236oxJ7OIZe, 2026-11-19: a prompt pinned to an account with allowance
 * waited behind a park on the cybersec route until a person unpaused it).
 */
function liftedByRoute(pause: SessionPause.Info, prompt: SessionV1.User) {
  const refused = pause.error?.model
  return refused !== undefined && pause.root === undefined && !sameRoute(refused, prompt.model)
}

type DeferredToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStatePending }

function isDeferredToolPart(part: SessionV1.Part): part is DeferredToolPart {
  return part.type === "tool" && SessionPause.isDeferred(part)
}

function sourceOf(source: SessionPause.Source | undefined): SessionPause.Source {
  const value = source ?? { kind: "api" as const }
  // The TUI asks for its own session, so the machine it runs on is this one.
  if (value.kind !== "tui" || value.machine || !process.env.VIBETERM_MACHINE_NAME) return value
  return { ...value, machine: process.env.VIBETERM_MACHINE_NAME }
}

export interface Interface {
  readonly cancel: (sessionID: SessionID, options?: SessionAbort.CancelOptions) => Effect.Effect<void>
  readonly prompt: (
    input: PromptInput,
    admission?: Deferred.Deferred<void, AdmissionError>,
  ) => Effect.Effect<SessionV1.WithParts, Image.Error | SessionArchive.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError | SessionArchive.Error>
  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error | SessionArchive.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
  readonly unqueue: (input: {
    sessionID: SessionID
    messageID: MessageID
  }) => Effect.Effect<SessionV1.WithParts, NotQueuedError | NotFoundError>
  readonly sendNow: (sessionID: SessionID) => Effect.Effect<MessageID[], SendNowRefusedError>
  readonly pause: (input: PauseInput) => Effect.Effect<PauseResult>
  readonly unpause: (input: UnpauseInput) => Effect.Effect<UnpauseResult, SessionPause.ChangedError>
  readonly discard: (input: DiscardInput) => Effect.Effect<DiscardResult, Session.BusyError | SessionPause.ChangedError>
}

/**
 * Send now was refused. `busy`: a turn is running, and it reads the queued messages itself. `empty`: nothing waits
 * after the last assistant message. `paused`: the session is paused.
 */
export class SendNowRefusedError extends Schema.TaggedErrorClass<SendNowRefusedError>()("SessionSendNowRefusedError", {
  sessionID: SessionID,
  reason: Schema.Literals(["busy", "empty", "paused"]),
}) {}

/**
 * Unqueue was refused. `idle`: no turn is running that the prompt waits behind. `started`: the running turn has
 * already read it, so the model has it or is about to.
 */
export class NotQueuedError extends Schema.TaggedErrorClass<NotQueuedError>()("SessionPromptNotQueuedError", {
  sessionID: SessionID,
  messageID: MessageID,
  reason: Schema.Literals(["idle", "started"]),
}) {}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

export class AdmissionRejected extends Schema.TaggedErrorClass<AdmissionRejected>()("PromptAdmissionRejected", {
  message: Schema.String,
}) {}

export type AdmissionError = AdmissionRejected | SessionArchive.Error

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const pauses = yield* SessionPause.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const inspectSwitch = (sessionID: SessionID) => AutoSwitch.inspect(sessions, sessionID)
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service
    const live = yield* LiveEvents.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const { db } = database
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (
      sessionID: SessionID,
      options?: SessionAbort.CancelOptions,
    ) {
      yield* Effect.logInfo("cancel", { "session.id": sessionID })
      yield* state.cancel(sessionID, options)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionV1.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          meridianPurpose: "title",
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => Effect.logError("failed to generate title", { error: Cause.squash(cause) })))
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: SessionV1.Assistant = yield* sessions.createMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: SessionV1.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionV1.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            return Effect.logError("subtask execution failed", {
              error,
              agent: task.agent,
              description: task.description,
            })
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies SessionV1.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.createMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies SessionV1.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: SessionV1.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.createMessage(userMsg)
            const userPart: SessionV1.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.createMessage(msg)
            const started = Date.now()
            const part: SessionV1.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, messageID: part.messageID, callID: part.callID, source: "shell" },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: SessionV1.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            yield* Effect.logInfo("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<SessionV1.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if (!c || typeof c !== "object") continue
                if ("text" in c && typeof c.text === "string" && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && typeof c.blob === "string" && c.blob) {
                  const mime = "mimeType" in c && typeof c.mimeType === "string" ? c.mimeType : part.mime
                  const filename = "uri" in c && typeof c.uri === "string" ? c.uri : part.filename
                  const size = mcpResourceBase64Size(c.blob)
                  if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) is not a supported attachment type]`,
                    })
                    continue
                  }
                  if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) exceeds ${formatMcpResourceBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
                    })
                    continue
                  }
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary MCP resource attached: ${filename ?? uri} (${mime})]`,
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "file",
                    mime,
                    filename,
                    url: `data:${mime};base64,${c.blob}`,
                  })
                }
              }
            } else {
              const error = Cause.squash(exit.cause)
              yield* Effect.logError("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              yield* Effect.logInfo("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<SessionV1.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read file", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read directory", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )
      for (const part of resolvedParts) {
        if (part.type === "text" && "metadata" in part && part.metadata) {
          part.metadata = AutoSwitchAdmission.stripWireStamp(part.metadata)
        }
      }

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        yield* Effect.logError("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      for (const [index, part] of parts.entries()) {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) continue
        yield* Effect.logError("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      }

      return yield* live.guard(
        input.sessionID,
        DatabaseTransaction.batch(
          db,
          Effect.gen(function* () {
            const current = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            const message = { info, parts }
            const pauseNotice =
              input.noReply === true &&
              MessageV2.isNotice(message) &&
              parts.some((part) => part.type === "text" && part.metadata?.pause)
            if (
              !pauseNotice &&
              (current.agent !== info.agent ||
                current.model?.providerID !== info.model.providerID ||
                current.model?.id !== info.model.modelID ||
                (current.model?.variant === "default" ? undefined : current.model?.variant) !== info.model.variant)
            ) {
              yield* sessions.setAgentModel({
                sessionID: input.sessionID,
                agent: info.agent,
                model: {
                  id: info.model.modelID,
                  providerID: info.model.providerID,
                  variant: info.model.variant ?? "default",
                },
                time: info.time.created,
              })
            }
            yield* sessions.createMessage(info)
            for (const part of parts) yield* sessions.updatePart(part)
            const held = input.noReply !== true && heldWhilePaused(input) && (yield* hold(input.sessionID, message))
            return { message, held }
          }),
        ).pipe(Effect.orDie),
      )
    }, Effect.scoped)

    /*
     * A prompt that arrives again with a message ID the session already has is the same prompt, sent again by
     * a client that lost track of the first send. It must not start another run: `loop` only skips the model
     * when that message's last reply finished cleanly, so after a turn that failed or was aborted, a second
     * admission would run the model and its tools again. While the first admission is still in progress the
     * second one waits for it; afterwards a stored reply is returned as it is. A message stored without a
     * reply - an admission that failed before its run started - is admitted again, which completes it.
     */
    const admitting = new Map<string, { done: Latch.Latch; admission: Deferred.Deferred<void, AdmissionError> }>()

    // The running loop of each session, with the prompts it has read and the ones unqueued before it read them.
    // `pickUp` and `unqueue` each check and update these without yielding in between, so a prompt is either read
    // by the loop or withdrawn from it, never both.
    type ResumeSelection = NonNullable<UnpauseInput["selection"]>
    type PendingResume = {
      readonly selection: ResumeSelection
      readonly eligible: ReadonlySet<MessageID>
      readonly committed: Deferred.Deferred<boolean>
    }
    type Run = {
      readonly started: number
      readonly seen: Set<MessageID>
      readonly withdrawn: Set<MessageID>
      resume?: PendingResume
      drained?: boolean
    }
    const runs = new Map<SessionID, Run>()

    const tracked = (sessionID: SessionID, work: Effect.Effect<SessionV1.WithParts>) =>
      Effect.suspend(() => {
        const run: Run = { started: Date.now(), seen: new Set(), withdrawn: new Set() }
        runs.set(sessionID, run)
        return work.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (runs.get(sessionID) === run) runs.delete(sessionID)
            }),
          ),
        )
      })

    const pickUp = (sessionID: SessionID, msgs: SessionV1.WithParts[]) => {
      const run = runs.get(sessionID)
      if (!run) return msgs
      const kept = msgs.filter((msg) => !run.withdrawn.has(msg.info.id))
      for (const msg of kept) if (msg.info.role === "user") run.seen.add(msg.info.id)
      return kept
    }

    const unqueue = Effect.fn("SessionPrompt.unqueue")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      const message = yield* MessageV2.get(input).pipe(Effect.provideService(Database.Service, database))
      const run = runs.get(input.sessionID)
      if (!run || message.info.role !== "user" || message.info.time.created < run.started)
        return yield* new NotQueuedError({ ...input, reason: "idle" })
      if (run.seen.has(input.messageID)) return yield* new NotQueuedError({ ...input, reason: "started" })
      run.withdrawn.add(input.messageID)
      yield* sessions.removeMessage(input)
      return message
    })

    // Starts the turn a waking prompt would have started, over the messages already stored. Nothing is written
    // before the turn's own assistant message, so every queued note keeps its row and ID.
    const sendNow = Effect.fn("SessionPrompt.sendNow")(function* (sessionID: SessionID) {
      if (yield* pauses.get(sessionID)) return yield* new SendNowRefusedError({ sessionID, reason: "paused" })
      if (runs.has(sessionID) || (yield* status.get(sessionID)).type !== "idle")
        return yield* new SendNowRefusedError({ sessionID, reason: "busy" })
      const history = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      const queued = MessageV2.unread(history).map((msg) => msg.info.id)
      if (queued.length === 0) return yield* new SendNowRefusedError({ sessionID, reason: "empty" })
      yield* drive(sessionID, queued.at(-1)).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("send now failed", { sessionID, cause })
            yield* events.publish(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
        (work) => OwnerQuiescence.fork(work, scope, true),
      )
      return queued
    })

    // Prompts an unpause let through, announced when the loop that answers them reaches its next model call.
    const releasing = new Map<SessionID, SessionPause.Held[]>()
    // Subagent sessions holding their loop at a step boundary until the pause they inherited ends.
    const waiting = new Map<SessionID, Deferred.Deferred<void>>()

    const notice = Effect.fnUntraced(function* (
      sessionID: SessionID,
      text: string,
      pause: { action: SessionPause.Action; source: SessionPause.Source; at: number },
    ) {
      // Keep the notice visually associated with the last prompt without changing the session's selection.
      const latest = yield* sessions
        .findMessage(sessionID, (msg) => msg.info.role === "user" && !MessageV2.isNotice(msg))
        .pipe(Effect.orDie)
      const info = Option.isSome(latest) && latest.value.info.role === "user" ? latest.value.info : undefined
      yield* prompt({
        sessionID,
        noReply: true,
        ...(info && {
          agent: info.agent,
          model: { providerID: info.model.providerID, modelID: info.model.modelID },
          variant: info.model.variant,
        }),
        parts: [{ type: "text", text, ignored: true, metadata: { pause } }],
      }).pipe(
        Effect.orDie,
        Effect.asVoid,
        /* The notice only records an action already committed. A failure writing it (a plugin's chat.message hook
           hitting "database is locked" on desktop, 2026-11-17) must not fail that action: an unpause that died here
           had cleared the pause and never started the turn it was meant to resume. */
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("pause notice not written", {
                "session.id": sessionID,
                action: pause.action,
                cause: Cause.pretty(cause),
              }),
        ),
      )
    })

    const descendants = (sessionID: SessionID): Effect.Effect<Session.Info[]> =>
      Effect.gen(function* () {
        const children = yield* sessions.children(sessionID)
        const nested = yield* Effect.forEach(children, (child) => descendants(child.id))
        return [...children, ...nested.flat()]
      })

    const deferredParts = Effect.fnUntraced(function* (sessionID: SessionID) {
      const history = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
        Effect.provideService(Database.Service, database),
      )
      return history.flatMap((msg) => msg.parts.filter(isDeferredToolPart))
    })

    const pause = Effect.fn("SessionPrompt.pause")(function* (input: PauseInput, error?: SessionPause.Refusal, preserved?: boolean) {
      const existing = yield* pauses.get(input.sessionID)
      if (existing) return { sessionID: input.sessionID, pause: existing, changed: false }
      const at = Date.now()
      const source = sourceOf(input.source)
      const next: SessionPause.Info = {
        at,
        mode: "soft",
        state: runs.has(input.sessionID) ? "pending" : "paused",
        source,
        ...(input.reason !== undefined && { reason: input.reason }),
        ...(error && { error }),
      }
      yield* pauses.write(input.sessionID, next)
      for (const child of yield* descendants(input.sessionID)) {
        if (yield* pauses.get(child.id)) continue
        const { error: _, ...inherited } = next
        yield* pauses.write(child.id, {
          ...inherited,
          state: runs.has(child.id) ? "pending" : "paused",
          root: input.sessionID,
        })
      }
      yield* notice(
        input.sessionID,
        input.notice ??
          SessionPause.noticeText({ action: "pause", source, at, reason: input.reason, parked: error !== undefined, preserved }),
        { action: "pause", source, at },
      )
      return { sessionID: input.sessionID, pause: next, changed: true }
    })

    const applyResumeSelection = Effect.fnUntraced(function* (
      user: SessionV1.User,
      selection: ResumeSelection,
      updateSession: boolean,
    ) {
      if (
        user.agent !== selection.agent ||
        !sameRoute(user.model, selection.model) ||
        user.model.variant !== selection.model.variant
      )
        yield* sessions.updateMessage({ ...user, ...selection })
      if (!updateSession) return
      const session = yield* sessions.get(user.sessionID).pipe(Effect.orDie)
      const model = {
        id: selection.model.modelID,
        providerID: selection.model.providerID,
        variant: selection.model.variant ?? "default",
      }
      if (
        session.agent === selection.agent &&
        session.model?.id === model.id &&
        session.model.providerID === model.providerID &&
        session.model.variant === model.variant
      )
        return
      yield* sessions.setAgentModel({ sessionID: user.sessionID, agent: selection.agent, model, time: Date.now() })
    })

    // Clears the pause of a session and of every descendant paused through it, and wakes the subagents waiting.
    const release = Effect.fnUntraced(function* (input: UnpauseInput) {
      const selection = input.selection
      const committed = selection ? yield* Deferred.make<boolean>() : undefined
      const holding = selection && (yield* config.get()).queued_prompts === "turn_end"
      const change = pauses.mutate(input, (current) =>
        Effect.gen(function* () {
          if (!current) return []
          if (selection && committed) {
            const run = runs.get(input.sessionID)
            const history = (yield* MessageV2.filterCompactedEffect(input.sessionID).pipe(
              Effect.provideService(Database.Service, database),
            )).filter((msg) => !run?.withdrawn.has(msg.info.id))
            if (run && !run.drained && current.state === "pending") {
              // The streaming step may finish or require another step. Let its next history read decide, but
              // never retarget an input admitted after this transaction clears the pause.
              run.resume = {
                selection,
                committed,
                eligible: new Set(history.flatMap((msg) => (msg.info.role === "user" ? [msg.info.id] : []))),
              }
            } else if (
              current.stoppedAt !== undefined ||
              current.held?.length ||
              history.some((msg) => msg.parts.some(isDeferredToolPart))
            ) {
              const turn = turnAt(holding ? answerAfterTurn(holdForTurnEnd(history)) : history)
              if (!turn.finished && turn.latest.user) yield* applyResumeSelection(turn.latest.user, selection, true)
            }
          }
          const inherited = (yield* Effect.forEach(yield* descendants(input.sessionID), (child) =>
            pauses.get(child.id).pipe(Effect.map((pause) => ({ sessionID: child.id, pause }))),
          )).filter(
            (item): item is { sessionID: SessionID; pause: SessionPause.Info } => item.pause?.root === input.sessionID,
          )
          const cleared = [{ sessionID: input.sessionID, pause: current }, ...inherited]
          for (const item of cleared) yield* pauses.write(item.sessionID, undefined)
          return cleared
        }),
      )
      const cleared = yield* committed
        ? live.guard(
            input.sessionID,
            DatabaseTransaction.batch(db, change).pipe(
              Effect.catchTag("SqlError", Effect.die),
              Effect.onExit((exit) => Deferred.succeed(committed, Exit.isSuccess(exit))),
            ),
          )
        : change
      // Wake readers only after the transaction committed, outside its inherited connection context.
      for (const { sessionID, pause } of cleared) {
        if (pause.held?.length) releasing.set(sessionID, [...(releasing.get(sessionID) ?? []), ...pause.held])
        const signal = waiting.get(sessionID)
        if (signal) yield* Deferred.succeed(signal, undefined)
      }
      const current = cleared[0]?.pause
      if (!current) return
      const at = Date.now()
      const source = sourceOf(input.source)
      yield* notice(input.sessionID, input.notice ?? SessionPause.noticeText({ action: "unpause", source, at }), {
        action: "unpause",
        source,
        at,
      })
      return current
    })

    const unpause = Effect.fn("SessionPrompt.unpause")(function* (input: UnpauseInput) {
      const current = yield* release(input)
      if (!current) return { sessionID: input.sessionID, changed: false, deferred: 0 }
      const deferred = (yield* deferredParts(input.sessionID)).length
      // A pending pause is just cancelled: the loop still running carries on. Otherwise the loop goes again only
      // when the pause left work: deferred calls, held prompts, or a turn it cut at a step boundary. A loop that
      // stopped at the boundary is still finishing its step (its snapshots took 13s on m4max, 2026-11-16) and has
      // read history for the last time, so it is joined and told to go again as it ends rather than left to end.
      const work = deferred > 0 || (current.held?.length ?? 0) > 0 || current.stoppedAt !== undefined
      const run = runs.get(input.sessionID)
      if (work && (current.stoppedAt !== undefined || !run || (input.selection && run.drained)))
        yield* drive(input.sessionID, undefined, () => true).pipe(Effect.ignore, (run) =>
          OwnerQuiescence.fork(run, scope),
        )
      return { sessionID: input.sessionID, changed: true, deferred }
    })

    const discard = Effect.fn("SessionPrompt.discard")(function* (input: DiscardInput) {
      const { count, at } = yield* pauses.mutate(input, () =>
        Effect.gen(function* () {
          if (runs.has(input.sessionID)) return yield* new Session.BusyError({ sessionID: input.sessionID })
          const parts = yield* deferredParts(input.sessionID)
          const at = Date.now()
          for (const part of parts) {
            yield* sessions.updatePart({
              ...part,
              state: {
                status: "error",
                input: part.state.input,
                error: "not run: discarded by /discard",
                metadata: { ...part.state.metadata, discarded: true },
                time: { start: at, end: at },
              },
            } satisfies SessionV1.ToolPart)
          }
          return { count: parts.length, at }
        }),
      )
      const source = sourceOf(input.source)
      yield* notice(
        input.sessionID,
        input.notice ?? SessionPause.noticeText({ action: "discard", source, at, count }),
        { action: "discard", source, at },
      )
      return { sessionID: input.sessionID, discarded: count }
    })

    const hold = Effect.fnUntraced(function* (sessionID: SessionID, message: SessionV1.WithParts) {
      const current = yield* pauses.get(sessionID)
      if (!current) return false
      if (message.info.role === "user" && liftedByRoute(current, message.info)) return false
      const text = message.parts.find((part) => part.type === "text")
      const delivery = text?.type === "text" ? text.metadata?.vibeterm : undefined
      yield* pauses.write(sessionID, {
        ...current,
        held: [
          ...(current.held ?? []),
          { messageID: message.info.id, at: message.info.time.created, ...(delivery !== undefined && { delivery }) },
        ],
      })
      return true
    })

    /*
     * Records the pause the loop read as in force, but only while that same pause still holds: an unpause landing
     * between the loop's read and this write must not bring the pause back, which left a session paused with nobody
     * to unpause it. Answers whether it still held.
     */
    const markPaused = Effect.fnUntraced(function* (
      sessionID: SessionID,
      pause: SessionPause.Info,
      stoppedAt?: number,
    ) {
      return yield* pauses
        .mutate({ sessionID, expectedPauseAt: pause.at }, (current) =>
          current
            ? pauses
                .write(sessionID, { ...current, state: "paused", ...(stoppedAt !== undefined && { stoppedAt }) })
                .pipe(Effect.as(true))
            : Effect.succeed(false),
        )
        .pipe(Effect.catchTag("PauseChangedError", () => Effect.succeed(false)))
    })

    /*
     * Meridian refused the step: no Claude account can serve it. The step's message and its partial output are
     * dropped, so the history is again what the step was built from, and the session is paused with the refusal as
     * its reason. The loop then stops at this boundary, and unpause builds the same request again. A subagent waits
     * instead, as for an inherited pause, because its parent's task tool is still running it.
     */
    const park = Effect.fnUntraced(function* (input: {
      session: Session.Info
      messageID: MessageID
      refusal: SessionPause.Refusal
      route: Route
      preserveAttempt?: boolean
      blockedReason?: AutoSwitchTranscript.BlockReason
    }) {
      const sessionID = input.session.id
      yield* processor.settle(sessionID)
      if (!input.preserveAttempt) yield* sessions.removeMessage({ sessionID, messageID: input.messageID })
      yield* Effect.logWarning("step parked: no routable account", {
        "session.id": sessionID,
        messageID: input.messageID,
        incident: input.refusal.incident_id,
      })
      const result = yield* pause(
        {
          sessionID,
          source: { kind: "api", client: SessionPause.REFUSAL_CODE },
          reason: input.blockedReason ? `Automatic switch parked: ${input.blockedReason}` : input.refusal.message,
        },
        { ...input.refusal, model: { providerID: input.route.providerID, modelID: input.route.modelID } },
        input.preserveAttempt,
      )
      if (input.session.parentID) yield* waitForUnpause(sessionID, result.pause)
    })

    /*
     * The newest prompt of the session when it names another route than the refused step's: it was sent while that
     * step was in flight, and answering it is what the user asked for, so the refusal parks nothing.
     */
    const promptOnAnotherRoute = Effect.fnUntraced(function* (sessionID: SessionID, refused: SessionV1.User) {
      const history = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
        Effect.provideService(Database.Service, database),
      )
      const newest = MessageV2.latest(pickUp(sessionID, history)).user
      if (!newest || newest.id === refused.id || sameRoute(newest.model, refused.model)) return undefined
      return newest
    })

    const dropRefused = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      refusal: SessionPause.Refusal
      prompt: SessionV1.User
    }) {
      yield* processor.settle(input.sessionID)
      yield* sessions.removeMessage({ sessionID: input.sessionID, messageID: input.messageID })
      yield* Effect.logWarning("refused step dropped: a different route is available", {
        "session.id": input.sessionID,
        messageID: input.messageID,
        incident: input.refusal.incident_id,
        prompt: input.prompt.id,
        route: `${input.prompt.model.providerID}/${input.prompt.model.modelID}`,
      })
    })

    // The loop reached a step boundary while paused: the turn stops there instead of calling the model again.
    const stopForPause = Effect.fnUntraced(function* (sessionID: SessionID, pause: SessionPause.Info) {
      if (pause.state === "paused" && pause.stoppedAt !== undefined) return true
      return yield* markPaused(sessionID, pause, Date.now())
    })

    /*
     * A subagent paused through its parent waits here instead of ending its turn: the parent's task tool is still
     * running it, and an ended child turn would hand the parent a half-done answer as the task's result.
     */
    const waitForUnpause = Effect.fnUntraced(function* (sessionID: SessionID, pause: SessionPause.Info) {
      if (!(yield* stopForPause(sessionID, pause))) return
      const signal = yield* Deferred.make<void>()
      waiting.set(sessionID, signal)
      // An unpause served by another process cannot reach the signal; it shows in the database.
      const cleared = Effect.gen(function* () {
        while (yield* pauses.get(sessionID)) yield* Effect.sleep("2 seconds")
      })
      yield* Effect.raceFirst(Deferred.await(signal), cleared).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (waiting.get(sessionID) === signal) waiting.delete(sessionID)
          }),
        ),
      )
    })

    /*
     * Runs the tool calls a pause deferred, in the order the model asked for them, through the same tool wrappers a
     * streamed call uses (permission asks, timeouts, plugin hooks). Each is marked running before it starts, so a
     * crash leaves an ordinary interrupted call that is never run twice. An abort leaves the calls not yet started
     * deferred.
     */
    const runDeferred = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      session: Session.Info
      message: SessionV1.WithParts
      parts: DeferredToolPart[]
      msgs: SessionV1.WithParts[]
    }) {
      const assistant = input.message.info
      if (assistant.role !== "assistant") return "continue" as const
      // A tool streams metadata while it runs; reading and writing its part one at a time keeps a late update from
      // writing a stale running state over the result.
      const serial = (yield* Semaphore.make(1)).withPermit
      const findPart = Effect.fnUntraced(function* (callID: string) {
        const parts = yield* MessageV2.parts(assistant.id).pipe(Effect.provideService(Database.Service, database))
        return parts.find((part): part is SessionV1.ToolPart => part.type === "tool" && part.callID === callID)
      })
      const complete = (callID: string, output: ToolOutput) => serial(completeNow(callID, output))
      const completeNow = Effect.fnUntraced(function* (callID: string, output: ToolOutput) {
        const part = yield* findPart(callID)
        if (!part || part.state.status !== "running") return
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            output: output.output,
            title: output.title,
            metadata: { ...output.metadata, deferred: part.state.metadata?.deferred },
            time: { start: part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
      })
      const fail = (callID: string, error: string, extra?: Record<string, unknown>) =>
        serial(failNow(callID, error, extra))
      const failNow = Effect.fnUntraced(function* (callID: string, error: string, extra?: Record<string, unknown>) {
        const part = yield* findPart(callID)
        if (!part || (part.state.status !== "running" && part.state.status !== "pending")) return
        const end = Date.now()
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            input: part.state.input,
            error,
            metadata: { ...part.state.metadata, ...extra },
            time: { start: part.state.status === "running" ? part.state.time.start : end, end },
          },
        })
      })
      const episode = AutoSwitch.stored(input.session).episode
      const legacySwitched =
        episode &&
        assistant.time.created >= episode.at &&
        (episode.state !== "returned" || episode.turnID === assistant.parentID) &&
        AutoSwitch.same(episode.target, {
          agent: assistant.agent,
          providerID: assistant.providerID,
          modelID: assistant.modelID,
          variant: assistant.variant === "default" ? null : (assistant.variant ?? null),
        })
      if (
        legacySwitched ||
        input.parts.some((part) => {
          const deferred = SessionPause.deferredOf(part.state.metadata ?? {})
          return !deferred || deferred.switched === true
        })
      ) {
        for (const part of input.parts)
          yield* fail(part.callID, "not run: deferred tool permissions could not be re-established", {
            discarded: true,
            discardReason: "unsafe-deferred-route",
          } as const)
        return "stop" as const
      }
      const agent = yield* agents.get(assistant.agent)
      if (!agent) throw new NamedError.Unknown({ message: `Agent not found: "${assistant.agent}"` })
      const model = yield* getModel(assistant.providerID, assistant.modelID, input.sessionID)
      const tools = yield* SessionTools.resolve({
        agent,
        session: input.session,
        model,
        processor: {
          message: assistant,
          updateToolCall: (callID, update) =>
            serial(
              Effect.gen(function* () {
                const part = yield* findPart(callID)
                return part ? yield* sessions.updatePart(update(part)) : undefined
              }),
            ),
          completeToolCall: complete,
          waitForSnapshots: processor.settle(input.sessionID),
        },
        bypassAgentCheck: false,
        messages: input.msgs,
        promptOps: yield* ops(),
      }).pipe(
        Effect.provideService(Plugin.Service, plugin),
        Effect.provideService(Permission.Service, permission),
        Effect.provideService(ToolRegistry.Service, registry),
        Effect.provideService(MCP.Service, mcp),
        Effect.provideService(Truncate.Service, truncate),
        Effect.provideService(RuntimeFlags.Service, flags),
        Effect.provideService(Config.Service, config),
      )
      const stopOnDeny = (yield* config.get()).experimental?.continue_loop_on_deny !== true

      for (const [index, part] of input.parts.entries()) {
        const execute = tools[part.tool]?.execute
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "running",
            input: part.state.input,
            metadata: part.state.metadata,
            time: { start: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
        const exit = execute
          ? yield* Effect.tryPromise({
              try: (signal) =>
                Promise.resolve(
                  execute(part.state.input, { toolCallId: part.callID, messages: [], abortSignal: signal }),
                ),
              catch: (error) => error,
            }).pipe(
              Effect.onInterrupt(() => fail(part.callID, "Tool execution aborted", { interrupted: true })),
              Effect.exit,
            )
          : Exit.fail(new Error(`Tool "${part.tool}" is not available in this session`))
        if (Exit.isSuccess(exit)) {
          yield* complete(part.callID, toolOutput(part.tool, exit.value))
          continue
        }
        const error = Cause.squash(exit.cause)
        yield* fail(part.callID, errorMessage(error))
        const denied = error instanceof PermissionV1.RejectedError || error instanceof Question.RejectedError
        if (!denied || !stopOnDeny) continue
        for (const rest of input.parts.slice(index + 1))
          yield* fail(rest.callID, "not run: an earlier deferred tool call was rejected")
        return "stop" as const
      }
      return "continue" as const
    })

    const prompt: Interface["prompt"] = Effect.fn("SessionPrompt.prompt")(function* (
      input: PromptInput,
      admission?: Deferred.Deferred<void, AdmissionError>,
    ) {
      const messageID = input.messageID ?? MessageID.ascending()
      const key = `${input.sessionID}/${messageID}`
      const pending = admitting.get(key)
      if (pending) {
        if (admission) {
          const outcome = yield* Effect.exit(Deferred.await(pending.admission))
          yield* Deferred.done(admission, outcome)
          if (Exit.isFailure(outcome)) return yield* Effect.die(Cause.squash(outcome.cause))
        }
        yield* pending.done.await
        return yield* prompt(input, admission)
      }
      const done = Latch.makeUnsafe(false)
      const accepted = admission ?? (yield* Deferred.make<void, AdmissionError>())
      admitting.set(key, { done, admission: accepted })
      return yield* Effect.gen(function* () {
        const replied = input.messageID ? yield* reply(input.sessionID, messageID) : Option.none<SessionV1.WithParts>()
        if (Option.isSome(replied)) {
          yield* Deferred.succeed(accepted, undefined)
          return replied.value
        }
        return yield* admit({ ...input, messageID }, accepted)
      }).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (yield* Deferred.isDone(accepted)) return
            if (Exit.isSuccess(exit)) {
              yield* Deferred.succeed(accepted, undefined)
              return
            }
            // Event projection can commit before publication/readback fails. Only a confirmed absence is rejection.
            const stored = yield* db
              .select({ data: MessageTable.data })
              .from(MessageTable)
              .where(and(eq(MessageTable.id, messageID), eq(MessageTable.session_id, input.sessionID)))
              .get()
              .pipe(Effect.exit)
            if (Exit.isFailure(stored)) {
              yield* Deferred.failCause(accepted, Cause.die(Cause.squash(stored.cause)))
              return
            }
            if (stored.value?.data.role === "user") {
              yield* Deferred.succeed(accepted, undefined)
              return
            }
            const error = Cause.squash(exit.cause)
            if (error instanceof SessionArchive.Error) {
              yield* Deferred.fail(accepted, error)
              return
            }
            yield* Deferred.fail(
              accepted,
              new AdmissionRejected({ message: error instanceof Error ? error.message : Cause.pretty(exit.cause) }),
            )
          }),
        ),
        Effect.ensuring(
          Effect.suspend(() => {
            admitting.delete(key)
            return done.open
          }),
        ),
      )
    })

    const reply = Effect.fnUntraced(function* (sessionID: SessionID, messageID: MessageID) {
      const stored = yield* MessageV2.get({ sessionID, messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.option,
      )
      if (Option.isNone(stored)) return Option.none<SessionV1.WithParts>()
      return yield* sessions
        .findMessage(sessionID, (msg) => msg.info.role === "assistant" && msg.info.parentID === messageID)
        .pipe(Effect.orDie)
    })

    const admit = Effect.fnUntraced(function* (input: PromptInput, admission: Deferred.Deferred<void, AdmissionError>) {
      const session = yield* SessionArchive.admit(sessions, input)
      yield* revert.cleanup(session)
      const paused = input.noReply === true ? undefined : yield* pauses.get(input.sessionID)
      // The loop this prompt drives runs the deferred calls before it answers the prompt.
      if (paused && !heldWhilePaused(input))
        yield* release({ sessionID: input.sessionID, source: { kind: "api", client: "prompt" } }).pipe(Effect.orDie)
      const { message, held } = yield* createUserMessage(input)
      if (paused && !held && message.info.role === "user" && liftedByRoute(paused, message.info))
        yield* release({
          sessionID: input.sessionID,
          expectedPauseAt: paused.at,
          source: { kind: "api", client: "prompt" },
        }).pipe(Effect.catchTag("PauseChangedError", () => Effect.void))
      yield* Deferred.succeed(admission, undefined)
      yield* sessions.touch(input.sessionID)

      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (input.noReply === true || held) return message
      return yield* drive(input.sessionID, message.info.id)
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoop: (sessionID: SessionID) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        const ctx = yield* InstanceState.context
        let structured: unknown
        let step = 0
        let answerNewest = false
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
        const run = runs.get(sessionID)
        const previousIdle = AutoSwitch.begin(sessionID)
        let declinedReturn = false

        turnLoop: while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* Effect.logInfo("loop", { "session.id": sessionID, step })

          const resume = run?.resume
          const history = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )
          const holding = !answerNewest && (yield* config.get()).queued_prompts === "turn_end"
          if (resume !== run?.resume) continue
          let msgs = pickUp(sessionID, holding ? answerAfterTurn(holdForTurnEnd(history)) : history)

          const turn = turnAt(msgs)
          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = turn.latest
          const { assistantMessage: lastAssistantMsg, hasToolCalls } = turn

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          if (turn.finished) {
            const orphan = lastAssistantMsg?.parts.find(
              (part): part is SessionV1.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
            )
            if (orphan) {
              yield* Effect.logWarning("loop exit with orphaned interrupted tool", {
                "session.id": sessionID,
                messageID: orphan.messageID,
                tool: orphan.tool,
                callID: orphan.callID,
              })
            }
            yield* Effect.logInfo("exiting loop", { "session.id": sessionID })
            break
          }

          const paused = yield* pauses.get(sessionID)
          if (resume !== run?.resume) continue
          if (paused) {
            answerNewest = false
            if (!paused.root || !session.parentID) {
              if (!(yield* stopForPause(sessionID, paused))) continue
              yield* Effect.logInfo("loop paused at step boundary", { "session.id": sessionID })
              break
            }
            yield* waitForUnpause(sessionID, paused)
            continue
          }

          if (run && resume) {
            const committed = yield* Deferred.await(resume.committed)
            if (run.resume !== resume) continue
            run.resume = undefined
            if (committed && resume.eligible.has(lastUser.id)) {
              yield* live
                .guard(
                  sessionID,
                  DatabaseTransaction.batch(
                    db,
                    Effect.gen(function* () {
                      const target = yield* MessageV2.get({ sessionID, messageID: lastUser.id }).pipe(
                        Effect.provideService(Database.Service, database),
                        Effect.option,
                      )
                      if (Option.isNone(target) || target.value.info.role !== "user") return
                      const newest = yield* sessions
                        .findMessage(sessionID, (msg) => msg.info.role === "user" && !MessageV2.isNotice(msg))
                        .pipe(Effect.orDie)
                      yield* applyResumeSelection(
                        target.value.info,
                        resume.selection,
                        Option.isSome(newest) && resume.eligible.has(newest.value.info.id),
                      )
                    }),
                  ),
                )
                .pipe(Effect.orDie)
              continue
            }
          }
          answerNewest = false

          const deferred = lastAssistantMsg?.parts.filter(isDeferredToolPart) ?? []
          if (lastAssistantMsg && deferred.length > 0) {
            const outcome = yield* runDeferred({ sessionID, session, message: lastAssistantMsg, parts: deferred, msgs })
            if (outcome === "stop") break
            continue
          }

          step++
          if (step === 1)
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, (work) => OwnerQuiescence.fork(work, scope))

          const preferredRoute = { ...lastUser.model, agent: lastUser.agent, variant: lastUser.model.variant ?? null }
          let switchState = yield* inspectSwitch(sessionID)
          let episode = switchState?.episode
          const plannedAlternate = !!switchState?.policy?.enabled && AutoSwitch.same(switchState.source, preferredRoute) &&
            switchState.policy.alternates.some((route) => AutoSwitch.eligiblePair(preferredRoute, route))
          const settledAlternate = episode?.state === "active" || episode?.state === "failed" ? episode : undefined
          let sticky =
            switchState?.policy?.enabled &&
            settledAlternate &&
            !settledAlternate.returnPending &&
            AutoSwitch.same(settledAlternate.source, preferredRoute) &&
            AutoSwitch.same(switchState.source, preferredRoute) &&
            switchState.policy.alternates.some((route) => AutoSwitch.sameCandidate(route, settledAlternate.target))
              ? settledAlternate
              : undefined
          if (
            switchState &&
            settledAlternate &&
            !sticky &&
            !(yield* AutoSwitch.save(sessions, switchState, {
              episode: { ...settledAlternate, state: "returned", returnPending: false },
            }))
          )
            continue
          const admitted = previousIdle !== undefined ? msgs.find((msg) => msg.info.id === lastUser.id) : undefined
          const acceptedAt = admitted ? AutoSwitchAdmission.acceptedAt(admitted) : undefined
          const newSubmission = previousIdle !== undefined && acceptedAt !== undefined && acceptedAt > previousIdle
          const returnRoute = sticky && !sticky.returnCooldown && switchState && !declinedReturn && step === 1 && newSubmission &&
            lastAssistant?.parentID !== lastUser.id && tasks.length === 0 &&
            AutoSwitch.returnEnabled(switchState) ? sticky : undefined
          const returnModel = returnRoute ? yield* provider.getModel(lastUser.model.providerID, lastUser.model.modelID).pipe(Effect.option) : undefined
          const preferredProvider = MeridianRouting.routeProvider(preferredRoute.providerID)
          const returnFreshUntil = returnModel?._tag === "Some" && returnModel.value.api.id === preferredRoute.modelID &&
            preferredProvider
            ? yield* MeridianRouting.probe({ provider: preferredProvider, model: returnModel.value, variant: preferredRoute.variant })
            : undefined
          const returning = returnFreshUntil !== undefined && returnRoute && switchState ?
            { episode: returnRoute, revision: switchState.revision, policyRevision: switchState.policy?.policyRevision,
              validUntil: returnFreshUntil } : undefined
          const effectiveRoute = (returning ? preferredRoute : sticky?.target) ?? preferredRoute
          if (sticky && !returning && effectiveRoute.agent !== preferredRoute.agent && lastUser.system) {
            if (switchState) AutoSwitch.noteBlocked(sessionID, switchState.revision, "unsafe-step")
            yield* pause({ sessionID, source: { kind: "api", client: "auto-switch" }, reason: "The alternate cannot preserve the original system instructions." })
            break
          }
          if (episode?.state === "claimed" && episode.turnID === lastUser.id) {
            yield* pause({
              sessionID,
              source: { kind: "api", client: "auto-switch" },
              reason: "An interrupted auto-switch attempt may have run; submit a new prompt to continue.",
            })
            break
          }
          const model = yield* getModel(
            ProviderV2.ID.make(effectiveRoute.providerID),
            ModelV2.ID.make(effectiveRoute.modelID),
            sessionID,
          )
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          if (task?.type === "compaction") {
            if (episode && AutoSwitch.same(episode.source, preferredRoute)) {
              yield* pause({
                sessionID,
                source: { kind: "api", client: "auto-switch" },
                reason: "Compaction of switched history is not qualified.",
              })
              break
            }
            // Past the first step this loop was already running a turn, which the compaction cut into between
            // two of its steps; that turn resumes afterwards unless its last step had ended it.
            const inflight = step > 1
            const resume =
              inflight &&
              !(lastAssistant?.finish && !["tool-calls", "unknown"].includes(lastAssistant.finish) && !hasToolCalls)
            yield* compactionDebug({
              event: "compaction_task_start",
              sessionID,
              step,
              payload: {
                auto: task.auto,
                overflowTask: task.overflow === true,
                compactionMessageID: task.messageID,
                lastUserID: lastUser.id,
                messagesVisible: msgs.length,
                lastAssistantID: lastAssistant?.id,
                lastFinishedID: lastFinished?.id,
                inflight,
                resume,
              },
            })
            const result = yield* compaction.process({
              // Held prompts go to the compaction too, which keeps them verbatim behind the summary.
              messages: holding ? pickUp(sessionID, history) : msgs,
              parentID: task.messageID,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
              deferQueued: inflight,
              resume,
            })
            yield* compactionDebug({
              event: "compaction_task_end",
              sessionID,
              step,
              payload: {
                result,
              },
            })
            if (result === "stop") break
            continue
          }

          let overflowDecision = false
          if (lastFinished && lastFinished.summary !== true) {
            const cfg = yield* config.get()
            const usableBudget = usable({
              cfg,
              model,
              outputTokenMax: flags.outputTokenMax,
            })
            const tokenCount =
              lastFinished.tokens.total ||
              lastFinished.tokens.input +
                lastFinished.tokens.output +
                lastFinished.tokens.cache.read +
                lastFinished.tokens.cache.write
            overflowDecision = yield* compaction.isOverflow({ tokens: lastFinished.tokens, model })
            yield* compactionDebug({
              event: "overflow_check",
              sessionID,
              step,
              payload: {
                lastFinishedID: lastFinished.id,
                lastFinishedSummary: false,
                lastFinishedHasError: !!lastFinished.error,
                modelID: model.id,
                providerID: model.providerID,
                modelContextLimit: model.limit.context,
                modelInputLimit: model.limit.input ?? null,
                modelOutputLimit: model.limit.output,
                outputTokenMax: flags.outputTokenMax ?? null,
                compactionReserved: cfg.compaction?.reserved ?? null,
                compactionAuto: cfg.compaction?.auto ?? null,
                usableBudget,
                tokenCount,
                tokenInput: lastFinished.tokens.input,
                tokenOutput: lastFinished.tokens.output,
                tokenReasoning: lastFinished.tokens.reasoning,
                tokenCacheRead: lastFinished.tokens.cache.read,
                tokenCacheWrite: lastFinished.tokens.cache.write,
                overflowDecision,
              },
            })
          }

          if (lastFinished && lastFinished.summary !== true && overflowDecision) {
            yield* compactionDebug({
              event: "compaction_create_auto",
              sessionID,
              step,
              payload: {
                reason: "overflow",
                parentUserID: lastUser.id,
                agent: lastUser.agent,
                modelID: lastUser.model.modelID,
                providerID: lastUser.model.providerID,
              },
            })
            if (episode && AutoSwitch.same(episode.source, preferredRoute)) {
              yield* pause({
                sessionID,
                source: { kind: "api", client: "auto-switch" },
                reason: "Switched history will not fit without unqualified compaction.",
              })
              break
            }
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }

          const selectedAgent = yield* agents.get(effectiveRoute.agent)
          if (!selectedAgent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const switchingAgent = effectiveRoute.agent !== preferredRoute.agent
          const originalAgent = switchingAgent ? yield* agents.get(preferredRoute.agent) : selectedAgent
          const stepMessages = msgs

          const runAttempt = Effect.fnUntraced(function* (input: {
            readonly model: Provider.Model
            readonly agent: typeof selectedAgent
            readonly route: AutoSwitchSchema.Route
            readonly projectHistory: boolean
            readonly beforeDispatch?: () => Effect.Effect<boolean>
            readonly replacement?: boolean
            readonly preferredReturn?: boolean
          }) {
            const model = input.model
            const sourceAgent = originalAgent ?? selectedAgent
            const agent = input.agent
            const isLastStep = step >= Math.min(agent.steps ?? Infinity, sourceAgent.steps ?? Infinity)
            const msgs = yield* SessionReminders.apply({
              messages:
                input.projectHistory || plannedAlternate ? structuredClone(stepMessages) : stepMessages,
              agent,
              session,
            }).pipe(
              Effect.provideService(RuntimeFlags.Service, flags),
              Effect.provideService(FSUtil.Service, fsys),
              Effect.provideService(Session.Service, sessions),
            )
            const user = input.projectHistory
              ? {
                  ...structuredClone(lastUser),
                  agent: agent.name,
                  model: {
                    providerID: model.providerID,
                    modelID: model.id,
                    variant: input.route.variant ?? undefined,
                  },
                }
              : lastUser
            const switched = !AutoSwitch.same(input.route, preferredRoute)
            const routeContext = switched
              ? { version: 1 as const, preferred: preferredRoute, effective: input.route }
              : undefined
            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              parentID: lastUser.id,
              role: "assistant",
              mode: agent.name,
              agent: agent.name,
              variant: user.model.variant,
              path: { cwd: ctx.directory, root: ctx.worktree },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.id,
              providerID: model.providerID,
              time: { created: Date.now() },
              sessionID,
            }
            yield* sessions.createMessage(msg)

            const finalizeInterruptedAssistant = Effect.gen(function* () {
              if (msg.time.completed) return
              msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
                providerID: msg.providerID,
                aborted: true,
                abort: yield* SessionAbort.metadata,
              })
              msg.time.completed = Date.now()
              yield* sessions.updateMessage(msg)
            })

            const handle = yield* processor
              .create({
                assistantMessage: msg,
                sessionID,
                model,
              })
              .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

            let sourceRequestChanged = false
            let projectionReason: AutoSwitchTranscript.BlockReason | undefined
            const outcome = yield* Effect.gen(function* () {
              const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
              const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
              const promptOps = yield* ops()

              const tools = yield* SessionTools.resolve({
                agent,
                session,
                model,
                processor: handle,
                bypassAgentCheck,
                messages: msgs,
                promptOps,
                autoSwitch: routeContext,
                sourcePermission: agent.name !== sourceAgent.name ? sourceAgent.permission : undefined,
              }).pipe(
                Effect.provideService(Plugin.Service, plugin),
                Effect.provideService(Permission.Service, permission),
                Effect.provideService(ToolRegistry.Service, registry),
                Effect.provideService(MCP.Service, mcp),
                Effect.provideService(Truncate.Service, truncate),
                Effect.provideService(RuntimeFlags.Service, flags),
                Effect.provideService(Config.Service, config),
              )

              // A call the model asks for once the session is paused is recorded with its input and not started.
              const bridge = yield* EffectBridge.make()
              for (const item of Object.values(tools)) {
                const execute = item.execute
                if (!execute) continue
                item.execute = (args, options) =>
                  bridge
                    .promise(pauses.get(sessionID))
                    .then((paused) => (paused ? SessionPause.deferredResult(Date.now(), !!routeContext) : execute(args, options)))
              }

              if (lastUser.format?.type === "json_schema") {
                tools["StructuredOutput"] = createStructuredOutputTool({
                  schema: lastUser.format.schema,
                  onSuccess(output) {
                    structured = output
                  },
                })
              }

              if (step === 1 && !input.replacement)
                yield* summary
                  .summarize({ sessionID, messageID: lastUser.id })
                  .pipe(Effect.ignore, (work) => OwnerQuiescence.fork(work, scope))

              const attemptMessages = input.projectHistory ? structuredClone(msgs) : msgs
              const beforeTransform =
                !switched && plannedAlternate ? JSON.stringify(attemptMessages) : undefined
              yield* plugin.trigger(
                "experimental.chat.messages.transform",
                routeContext ? { autoSwitch: routeContext } : {},
                { messages: attemptMessages },
              )
              sourceRequestChanged =
                beforeTransform !== undefined && beforeTransform !== JSON.stringify(attemptMessages)

              // An interrupted/aborted assistant turn (no finish reason, or an
              // error) can survive as the trailing history message and get
              // re-dispatched with no new user turn. That makes the request end
              // on an assistant message, which claude-opus-4.x and gpt-5.x-codex
              // reject as an unsupported prefill (HTTP 400). Drop that tail so
              // the request ends on the preceding user/tool content.
              const lastMsg = attemptMessages[attemptMessages.length - 1]
              const promptMsgs =
                lastMsg && lastMsg.info.role === "assistant" && (!lastMsg.info.finish || lastMsg.info.error)
                  ? attemptMessages.slice(0, -1)
                  : attemptMessages

              const projected = input.projectHistory
                ? AutoSwitchTranscript.project({ messages: attemptMessages, model })
                : undefined
              if (projected?.kind === "blocked") {
                projectionReason = projected.reason
                yield* Effect.logInfo("auto-switch history blocked", { sessionID, reason: projected.reason })
                return "blocked" as const
              }

              const [skills, env, instructions, mcpInstructions, modelMsgs] = yield* Effect.all([
                sys.skills(agent),
                sys.environment(model),
                instruction.system().pipe(Effect.orDie),
                sys.mcp(agent, session.permission),
                projected ? Effect.succeed(projected.messages) : MessageV2.toModelMessagesEffect(promptMsgs, model),
              ])
              const system = [
                ...env,
                ...instructions,
                ...(mcpInstructions ? [mcpInstructions] : []),
                ...(skills ? [skills] : []),
              ]
              const format = lastUser.format ?? { type: "text" as const }
              if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
              const released = releasing.get(sessionID)
              if (released) {
                releasing.delete(sessionID)
                yield* events.publish(SessionPause.Event.Released, { sessionID, held: released })
              }
              const result = yield* handle.process({
                user,
                agent,
                permission: session.permission,
                sessionID,
                parentSessionID: session.parentID,
                meridianPurpose: session.parentID ? "subagent" : "chat",
                system,
                messages: [
                  ...modelMsgs,
                  ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS_PROMPT }] : []),
                ],
                tools,
                model,
                toolChoice: format.type === "json_schema" ? "required" : undefined,
                beforeDispatch: input.beforeDispatch,
                autoSwitch: routeContext,
                preferredReturn: input.preferredReturn ? true : undefined,
                retries: input.replacement || input.preferredReturn ? 0 : undefined,
                validateRequest: input.projectHistory
                  ? (request) =>
                      Effect.gen(function* () {
                        const assessed = yield* Effect.promise(() => AutoSwitchTranscript.checkBudget(request))
                        if (assessed.kind === "fits") return true
                        projectionReason = assessed.reason
                        yield* Effect.logInfo("auto-switch request blocked", { sessionID, reason: assessed.reason })
                        return false
                      })
                  : undefined,
              })
              if (handle.dispatchBlocked) return "blocked" as const
              if (handle.refusal) return "park" as const

              if (structured !== undefined) {
                handle.message.structured = structured
                handle.message.finish = handle.message.finish ?? "stop"
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }

              const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
              if (finished && !handle.message.error) {
                // Surface any content-filter finish (e.g. Anthropic stop_reason:
                // refusal) as an error. These turns may have produced no visible
                // output at all — previously the session went idle silently — or
                // partial text that was cut off by the provider's filter.
                if (handle.message.finish === "content-filter") {
                  handle.message.error = new SessionV1.ContentFilterError({
                    message: "The response was blocked by the provider's content filter",
                  }).toObject()
                  yield* sessions.updateMessage(handle.message)
                  if (!input.replacement)
                    yield* events.publish(Session.Event.Error, { sessionID, error: handle.message.error })
                  return "break" as const
                }
                if (format.type === "json_schema") {
                  handle.message.error = new SessionV1.StructuredOutputError({
                    message: "Model did not produce structured output",
                    retries: 0,
                  }).toObject()
                  yield* sessions.updateMessage(handle.message)
                  return "break" as const
                }
              }

              if (result === "stop") return "break" as const
              if (result === "compact") {
                if (input.projectHistory) return "break" as const
                yield* compactionDebug({
                  event: "assistant_result_compact",
                  sessionID,
                  step,
                  payload: {
                    messageID: handle.message.id,
                    finish: handle.message.finish ?? null,
                    hasError: !!handle.message.error,
                    inferredOverflow: !handle.message.finish,
                  },
                })
                yield* compaction.create({
                  sessionID,
                  agent: lastUser.agent,
                  model: user.model,
                  auto: true,
                  overflow: !handle.message.finish,
                })
              }
              return "continue" as const
            }).pipe(
              Effect.ensuring(instruction.clear(handle.message.id)),
              Effect.onInterrupt(() => finalizeInterruptedAssistant),
            )
            return { outcome, handle, sourceRequestChanged, projectionReason }
          })

          const latestInputIsCurrent = Effect.fnUntraced(function* () {
            if (runs.get(sessionID) !== run || run?.resume || (yield* pauses.get(sessionID))) return false
            if ((yield* permission.list()).some((request) => request.sessionID === sessionID)) return false
            const newest = yield* sessions
              .findMessage(sessionID, (message) => message.info.role === "user" && !MessageV2.isNotice(message))
              .pipe(Effect.orDie)
            return newest._tag === "Some" && newest.value.info.id === lastUser.id && !run?.resume
          })
          if (switchState) AutoSwitch.clearBlocked(sessionID)
          const stickyAtDispatch = sticky
          const { outcome, handle, sourceRequestChanged, projectionReason } = yield* runAttempt({
            agent: selectedAgent,
            model,
            route: effectiveRoute,
            projectHistory: !!episode && AutoSwitch.same(episode.source, preferredRoute),
            preferredReturn: !!returning,
            beforeDispatch: returning ? () => Effect.gen(function* () {
              if (!(yield* latestInputIsCurrent())) return false
              const fresh = yield* inspectSwitch(sessionID)
              if (!fresh?.policy?.enabled || !AutoSwitch.returnEnabled(fresh) ||
                fresh.revision !== returning.revision || fresh.policy.policyRevision !== returning.policyRevision ||
                !AutoSwitch.same(fresh.source, preferredRoute)) return false
              return yield* AutoSwitch.save(sessions, fresh, {
                episode: { ...returning.episode, state: "returned", returnPending: false, autoReturnedTurnID: lastUser.id },
                valid: () => latestInputIsCurrent().pipe(Effect.map((valid) => valid && Date.now() <= returning.validUntil)),
              })
            }) : stickyAtDispatch
              ? () =>
                  Effect.gen(function* () {
                    if (!(yield* latestInputIsCurrent())) return false
                    if (
                      !originalAgent ||
                      !(yield* AutoSwitch.authorizeAgent({
                        sessionID,
                        source: preferredRoute,
                          target: stickyAtDispatch.target,
                        sourceAgent: originalAgent,
                        targetAgent: selectedAgent,
                        plugin,
                      }))
                    )
                      return false
                    const fresh = yield* inspectSwitch(sessionID)
                    if (
                      fresh?.revision !== switchState?.revision ||
                      fresh?.policy?.policyRevision !== switchState?.policy?.policyRevision
                    )
                      return false
                    AutoSwitch.markServing(stickyAtDispatch)
                    return true
                  })
              : undefined,
          }).pipe(Effect.ensuring(Effect.sync(() => AutoSwitch.stopServing(sessionID))))
          if (returning && outcome === "blocked") {
            yield* sessions.removeMessage({ sessionID, messageID: handle.message.id })
            declinedReturn = true
            step--
            continue
          }
          if (returning) {
            switchState = yield* inspectSwitch(sessionID)
            episode = switchState?.episode
            sticky = undefined
          }
          if (sticky) yield* AutoSwitch.finishBoundary(sessions, sticky)
          if (outcome === "blocked") {
            if (switchState) AutoSwitch.noteBlocked(sessionID, switchState.revision, "route-ineligible")
            yield* sessions.removeMessage({ sessionID, messageID: handle.message.id })
            if (sticky && (yield* latestInputIsCurrent())) {
              const current = yield* inspectSwitch(sessionID)
              if (
                current?.revision !== switchState?.revision ||
                current?.policy?.policyRevision !== switchState?.policy?.policyRevision
              )
                continue
            }
            if (!(yield* pauses.get(sessionID)) && !run?.resume) {
              yield* pause({
                sessionID,
                source: { kind: "api", client: "auto-switch" },
                reason: projectionReason
                  ? `Automatic switch parked: ${projectionReason}`
                  : "The selected route could not safely preserve the current step.",
              })
            }
            break
          }
          if (outcome === "break") break
          if (outcome === "park" && handle.refusal) {
            const newer = yield* promptOnAnotherRoute(sessionID, lastUser)
            if (newer) {
              yield* dropRefused({ sessionID, messageID: handle.message.id, refusal: handle.refusal, prompt: newer })
              // The refused turn ends here; holding prompts for its end would hide the one to answer.
              answerNewest = true
              continue
            }
            const resume = run?.resume
            if (
              resume?.eligible.has(lastUser.id) &&
              !sameRoute(resume.selection.model, lastUser.model) &&
              (yield* Deferred.await(resume.committed)) &&
              run?.resume === resume
            ) {
              yield* dropRefused({
                sessionID,
                messageID: handle.message.id,
                refusal: handle.refusal,
                prompt: { ...lastUser, ...resume.selection },
              })
              continue
            }
            let blockedReason: AutoSwitch.BlockedReason = handle.hasEffects || sourceRequestChanged
              ? "unsafe-step"
              : !handle.routeRefusal ? "stale-evidence" : episode?.turnID === lastUser.id || sticky ? "attempted" : "route-ineligible"
            let alternateProjectionReason: AutoSwitchTranscript.BlockReason | undefined
            const sourceEffort = preferredProvider && MeridianRouting.wireEffort({ provider: preferredProvider, model, variant: preferredRoute.variant })
            const exactSource = !!handle.routeRefusal && handle.routeRefusal.type === preferredProvider &&
              handle.routeRefusal.wireModel === model.api.id && model.id === model.api.id &&
              sourceEffort !== undefined && handle.routeRefusal.variant === sourceEffort
            let gate = !exactSource ? "source-wire" : !plannedAlternate ? "policy-candidate" : "source-admission"
            if (
              !sticky &&
              !sourceRequestChanged &&
              exactSource &&
              switchState?.policy?.enabled &&
              AutoSwitch.same(switchState.source, preferredRoute) &&
              (!episode || episode.turnID < lastUser.id) &&
              (yield* latestInputIsCurrent())
            ) {
              gate = "target-catalog-or-agent"
              for (const candidate of switchState.policy.alternates) {
              if (!AutoSwitch.eligiblePair(preferredRoute, candidate)) continue
              const targetProvider = MeridianRouting.routeProvider(candidate.providerID)
              const target =
                candidate &&
                (yield* provider
                  .getModel(ProviderV2.ID.make(candidate.providerID), ModelV2.ID.make(candidate.modelID))
                  .pipe(Effect.option))
              const candidates = candidate.agent === selectedAgent.name ? [selectedAgent] :
                (yield* agents.list()).filter((item) => !item.hidden && item.mode === "primary" &&
                  AutoSwitch.sameCandidate(candidate, { ...candidate, agent: item.name }))
              const targetAgent = candidates.length === 1 ? candidates[0] : undefined
              const route = candidate && targetAgent ? { ...candidate, agent: targetAgent.name } : undefined
              if (
                route &&
                targetAgent &&
                target &&
                target._tag === "Some" &&
                targetProvider &&
                target.value.api.id === route.modelID &&
                MeridianRouting.supports({ provider: targetProvider, model: target.value, variant: route.variant }) &&
                (route.agent === preferredRoute.agent || !lastUser.system) &&
                (yield* AutoSwitch.authorizeAgent({
                  sessionID,
                  source: preferredRoute,
                  target: route,
                  sourceAgent: selectedAgent,
                  targetAgent,
                  plugin,
                }))
              ) {
                gate = "target-availability"
                const freshUntil = yield* MeridianRouting.probe({
                  provider: targetProvider,
                  model: target.value,
                  variant: route.variant,
                })
                if (freshUntil === undefined) blockedReason = "stale-evidence"
                if (freshUntil !== undefined) {
                  gate = "target-request-fence"
                  const claim: AutoSwitchSchema.Episode = {
                    sessionId: sessionID,
                    source: preferredRoute,
                    target: route,
                    turnID: lastUser.id,
                    step,
                    state: "claimed",
                    returnPending: false,
                    at: Date.now(),
                    returnCooldown: episode?.autoReturnedTurnID === lastUser.id,
                  }
                  let claimed = false
                  const attempt = yield* runAttempt({
                    agent: targetAgent,
                    model: target.value,
                    route,
                    projectHistory: true,
                    replacement: true,
                    beforeDispatch: () =>
                      Effect.gen(function* () {
                        if (!(yield* latestInputIsCurrent())) return false
                        if (
                          !(yield* AutoSwitch.authorizeAgent({
                            sessionID,
                            source: preferredRoute,
                            target: route,
                            sourceAgent: selectedAgent,
                            targetAgent,
                            plugin,
                          }))
                        )
                          return false
                        const current = yield* inspectSwitch(sessionID)
                        if (
                          !current ||
                          current.revision !== switchState.revision ||
                          current.policy?.policyRevision !== switchState.policy?.policyRevision ||
                          !current.policy?.enabled ||
                          !current.policy.alternates.some((item) => AutoSwitch.sameCandidate(item, route)) ||
                          !(yield* latestInputIsCurrent())
                        )
                          return false
                        const saved = yield* AutoSwitch.save(sessions, current, {
                          episode: claim,
                          valid: () =>
                            latestInputIsCurrent().pipe(Effect.map((valid) => valid && Date.now() <= freshUntil)),
                        })
                        if (saved) {
                          claimed = true
                          AutoSwitch.markServing(claim)
                        }
                        return saved
                      }),
                  }).pipe(Effect.ensuring(Effect.sync(() => AutoSwitch.stopServing(sessionID))))
                  if (!claimed || attempt.outcome === "blocked") {
                    alternateProjectionReason = attempt.projectionReason
                    blockedReason = Date.now() > freshUntil ? "stale-evidence" : "route-ineligible"
                    yield* sessions.removeMessage({ sessionID, messageID: attempt.handle.message.id })
                    break
                  } else {
                    yield* sessions.removeMessage({ sessionID, messageID: handle.message.id })
                    yield* AutoSwitch.settle(
                      sessions,
                      claim,
                      !!attempt.handle.refusal || !!attempt.handle.message.error,
                    )
                    if (attempt.handle.refusal) {
                      yield* park({
                        session,
                        messageID: attempt.handle.message.id,
                        refusal: attempt.handle.refusal,
                        route: { providerID: target.value.providerID, modelID: target.value.id },
                        preserveAttempt: attempt.handle.hasEffects,
                      })
                    }
                    if (attempt.outcome === "break") break turnLoop
                    continue turnLoop
                  }
                }
              }
              }
            }
            const newerBeforePark = switchState?.policy?.enabled ? yield* promptOnAnotherRoute(sessionID, lastUser) : undefined
            if (newerBeforePark && !handle.hasEffects) {
              yield* dropRefused({
                sessionID,
                messageID: handle.message.id,
                refusal: handle.refusal,
                prompt: newerBeforePark,
              })
              answerNewest = true
              continue
            }
            if (switchState?.policy?.enabled && (yield* pauses.get(sessionID)) && !handle.hasEffects) {
              yield* sessions.removeMessage({ sessionID, messageID: handle.message.id })
              continue
            }
            if (switchState?.policy?.enabled && (plannedAlternate || handle.routeRefusal)) {
              AutoSwitch.noteBlocked(sessionID, switchState.revision, blockedReason)
              yield* Effect.logInfo("auto-switch stopped before alternate", { sessionID, step, gate, reason: blockedReason })
            }
            yield* park({
              session,
              messageID: handle.message.id,
              refusal: handle.refusal,
              route: { providerID: model.providerID, modelID: model.id },
              preserveAttempt: !!switchState?.policy?.enabled && handle.hasEffects,
              blockedReason: alternateProjectionReason,
            })
          }
          continue
        }

        if (run) run.drained = true
        // A turn that ended on its own while a pause was pending leaves the session paused, with nothing cut.
        const pending = yield* pauses.get(sessionID)
        if (pending?.state === "pending") yield* markPaused(sessionID, pending)
        yield* processor.settle(sessionID)
        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, (work) => OwnerQuiescence.fork(work, scope))
    const result = yield* lastAssistant(sessionID)
        if (!pending && result.info.role === "assistant" && result.info.finish === "stop" && !result.info.error) {
          const finished = yield* inspectSwitch(sessionID)
          if (finished?.episode?.state === "active") {
            if (finished.episode.returnCooldown && finished.episode.turnID !== result.info.parentID &&
              finished.episode.target.providerID === result.info.providerID && finished.episode.target.modelID === result.info.modelID) {
              yield* AutoSwitch.save(sessions, finished, { episode: { ...finished.episode, returnCooldown: false } })
            }
            AutoSwitch.noteCleanEnd(sessionID)
          }
        }
        return result
      },
    )

    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      // A caller that stored its own input first, like a compaction request, needs it answered like a prompt.
      const newest = yield* sessions.findMessage(input.sessionID, (msg) => msg.info.role === "user").pipe(Effect.orDie)
      return yield* drive(input.sessionID, Option.isSome(newest) ? newest.value.info.id : undefined)
    })

    /*
     * Runs the session's loop for a prompt stored as `messageID`, or joins the run already going. A joined run may
     * already have read history for the last time: its turn ended, and it is only finishing its snapshots. Unless
     * one of its reads picked the prompt up (or the prompt was unqueued), the run goes again as it ends and
     * answers it. `again` replaces that check, for a caller that knows the joined run has to go again.
     */
    const drive = Effect.fnUntraced(function* (sessionID: SessionID, messageID?: MessageID, again?: () => boolean) {
      // The session stays busy until its background snapshots are recorded, including after an abort or a
      // failure, so revert and the next turn never see a finished step without its snapshot hashes.
      return yield* state.ensureRunning(
        sessionID,
        lastAssistant(sessionID),
        tracked(sessionID, runLoop(sessionID).pipe(
          Effect.provideService(AutoSwitch.Providers, provider), Effect.ensuring(processor.settle(sessionID)),
        )),
        again ?? (messageID ? unread(sessionID, messageID) : undefined),
      )
    })

    // Asked when the joined run ends. A run between being started and its first read has no entry yet; it would
    // read the prompt, but going again costs one history read, so that rare case is not told apart.
    const unread = (sessionID: SessionID, messageID: MessageID) => {
      const joined = runs.get(sessionID)
      return () => !joined || (!joined.seen.has(messageID) && !joined.withdrawn.has(messageID))
    }

    const shell: Interface["shell"] = Effect.fn("SessionPrompt.shell")(function* (input: ShellInput) {
      yield* SessionArchive.admit(sessions, input)
      const ready = yield* Latch.make()
      return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* SessionArchive.admit(sessions, input)
      yield* Effect.logInfo("command", {
        "session.id": input.sessionID,
        command: input.command,
        agent: input.agent,
      })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* OwnerQuiescence.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* OwnerQuiescence.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      /**
       * A command that names a TOOL runs it and stops.
       *
       * `registry.all()` rather than `registry.tools(...)`: the filtered list
       * drops tools by model, agent and permission, every one of which gates
       * what the MODEL may reach for. A person who typed the command has
       * already made that decision, and a tool missing from their own menu
       * would be the confusing failure.
       *
       * MCP tools are not in that registry at all - they are merged into the
       * model's tool map later, inside `SessionTools.resolve` - so they are
       * looked up separately from the same `mcp.tools()` that merge reads.
       * Their `execute` calls the server over RPC rather than being a
       * `Tool.Def`, which is why this cannot be a single lookup.
       */
      if (cmd.tool) {
        const toolID = cmd.tool
        const messageID = input.messageID ?? MessageID.ascending()

        /* The tool is resolved BEFORE its arguments are parsed, because the
           parameter names and types are what let a person type `key=value`, or
           a bare value, instead of JSON - and they come from the tool's own
           schema. */
        const def = (yield* registry.all()).find((item) => item.id === toolID)
        const mcpEntry = def ? undefined : (yield* mcp.tools())[toolID]
        let params: Command.ToolParam[] = []
        try {
          params = Command.toolParamsFromJsonSchema(
            def ? ToolJsonSchema.fromTool(def) : (mcpEntry?.def as { inputSchema?: unknown } | undefined)?.inputSchema,
          )
        } catch {
          /* A schema that will not convert costs the friendly forms, not the
             command: `params` stays empty and JSON still works. */
        }

        const parsed = Command.parseToolCommandArguments(input.arguments ?? "", params)
        const args = parsed.ok ? parsed.args : {}
        const output = yield* Effect.gen(function* () {
          if (!parsed.ok) return `error: ${parsed.error}\n\n${Command.toolCommandUsage(input.command, params)}`
          if (def)
            return (yield* def.execute(args, {
              sessionID: input.sessionID,
              messageID,
              callID: PartID.ascending(),
              agent: agent.name,
              abort: new AbortController().signal,
              messages: [],
              metadata: () => Effect.void,
              /* The person typed this. Permission gates what the MODEL may
                   reach for, and there is no model on this path - nor any
                   tool-call part for a dialog to attach to. */
              ask: () => Effect.void,
            })).output
          if (!mcpEntry) return `error: no tool named "${toolID}" is available in this session`
          /* `mcp.tools()` hands back `{ def, client, timeout }`, not something
             callable - the same conversion the merge point does is what makes
             it executable. */
          const exec = McpCatalog.convertTool(mcpEntry.def, mcpEntry.client, mcpEntry.timeout).execute
          if (!exec) return `error: MCP tool "${toolID}" declares no executable form`
          const result = yield* OwnerQuiescence.promise(async () =>
            exec(args, {
              toolCallId: PartID.ascending(),
              messages: [],
              abortSignal: new AbortController().signal,
            }),
          )
          /* An MCP tool answers with a content array rather than a string. */
          const text: string[] = []
          for (const item of result.content) {
            if (item.type === "text") text.push(item.text)
            else if (item.type === "resource" && item.resource.text) text.push(item.resource.text)
            else text.push(`[${item.type} content omitted]`)
          }
          return text.join("\n\n")
        }).pipe(
          /* Every outcome becomes text in the session. A failure that escaped
             here would reach the client as an opaque 500 with the reason
             replaced, which is exactly the shape that made an earlier
             throw-to-skip-the-turn route unshippable. */
          Effect.matchCauseEffect({
            onSuccess: (text: string) => Effect.succeed(text),
            onFailure: (cause) => Effect.succeed(`error: ${Cause.pretty(cause)}`),
          }),
        )

        const result = yield* prompt({
          sessionID: input.sessionID,
          messageID,
          model: taskModel,
          agent: agent.name,
          parts: [
            {
              type: "text" as const,
              text: Command.formatToolCommandResult({ tool: toolID, args, output }),
              ...(parsed.ok && parsed.hidden ? { ignored: true } : {}),
            },
          ],
          variant: input.variant,
          noReply: true,
        })
        yield* events.publish(Command.Event.Executed, {
          name: input.command,
          sessionID: input.sessionID,
          arguments: input.arguments,
          messageID: result.info.id,
        })
        return result
      }

      const templateParts = yield* resolvePromptParts(template)
      const inputFiles = new Set(
        input.parts?.filter((part) => new URL(part.url).protocol === "file:").map((part) => fileURLToPath(part.url)),
      )
      const uniqueTemplateParts = templateParts.filter(
        (part) => part.type !== "file" || !inputFiles.has(fileURLToPath(part.url)),
      )
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      if (cmd.native && isSubtask) {
        const reason =
          cmd.subtask === true ? "subtask: true" : `agent "${agent.name}" is a subagent, which implies subtask`
        const error = new NamedError.Unknown({
          message: `Command "${input.command}" sets native: true but ${reason}. A native command never reaches the model, so the subtask it describes would never run. Set subtask: false or drop native.`,
        })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...uniqueTemplateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
        // A native command is done once its parts are persisted, which is
        // exactly where prompt() stops when noReply is set.
        noReply: cmd.native,
        unpause: input.unpause,
        unarchive: input.unarchive,
      })
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt: (input, admission) => OwnerQuiescence.activity(prompt(input, admission)),
      loop: (input) => OwnerQuiescence.activity(loop(input)),
      shell: (input) => OwnerQuiescence.activity(shell(input)),
      command: (input) => OwnerQuiescence.activity(command(input)),
      resolvePromptParts,
      unqueue,
      sendNow: (sessionID) => OwnerQuiescence.activity(sendNow(sessionID)),
      pause: (input) => OwnerQuiescence.activity(pause(input)),
      unpause: (input) => OwnerQuiescence.activity(unpause(input)),
      discard: (input) => OwnerQuiescence.activity(discard(input)),
    })
  }),
)

const ModelRef = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  unarchive: Unarchive,
  unpause: Schema.optional(Schema.Boolean).annotate({
    description:
      "Unpause a paused session before this prompt: its deferred tool calls run first, then the prompt. Without it a prompt to a paused session is stored and held until unpause.",
  }),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export const PauseInput = Schema.Struct({
  sessionID: SessionID,
  source: Schema.optional(SessionPause.Source),
  reason: Schema.optional(Schema.String),
  notice: Schema.optional(
    Schema.String.annotate({
      description: "Text of the user-only notice, used as given. opencode writes one when omitted.",
    }),
  ),
})
export type PauseInput = Schema.Schema.Type<typeof PauseInput>

export const DiscardInput = Schema.Struct({
  sessionID: SessionID,
  ...SessionPause.Expected.fields,
  source: Schema.optional(SessionPause.Source),
  notice: Schema.optional(
    Schema.String.annotate({
      description: "Text of the user-only notice, used as given. opencode writes one when omitted.",
    }),
  ),
})
export type DiscardInput = Schema.Schema.Type<typeof DiscardInput>

export const UnpauseInput = Schema.Struct({
  ...DiscardInput.fields,
  selection: Schema.optional(
    Schema.Struct({ agent: SessionV1.User.fields.agent, model: SessionV1.User.fields.model }).annotate({
      description: "Apply this selection to the existing resuming prompt. An omitted variant selects the default.",
    }),
  ),
})
export type UnpauseInput = Schema.Schema.Type<typeof UnpauseInput>

export const PauseResult = Schema.Struct({
  sessionID: SessionID,
  pause: SessionPause.Info,
  changed: Schema.Boolean,
}).annotate({ identifier: "SessionPauseResult" })
export type PauseResult = Schema.Schema.Type<typeof PauseResult>

export const UnpauseResult = Schema.Struct({
  sessionID: SessionID,
  changed: Schema.Boolean,
  deferred: Schema.Number,
}).annotate({ identifier: "SessionUnpauseResult" })
export type UnpauseResult = Schema.Schema.Type<typeof UnpauseResult>

export const DiscardResult = Schema.Struct({
  sessionID: SessionID,
  discarded: Schema.Number,
}).annotate({ identifier: "SessionDiscardResult" })
export type DiscardResult = Schema.Schema.Type<typeof DiscardResult>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
  unarchive: Unarchive,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  unarchive: Unarchive,
  unpause: Schema.optional(Schema.Boolean).annotate({
    description: "Unpause a paused session before the command's prompt, as a prompt's unpause does.",
  }),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
type ToolOutput = {
  title: string
  metadata: Record<string, any>
  output: string
  attachments?: SessionV1.FilePart[]
}

// The stored result of a deferred call, read the way the processor reads a streamed tool result.
function toolOutput(tool: string, value: unknown): ToolOutput {
  if (isRecord(value) && typeof value.output === "string")
    return {
      title: typeof value.title === "string" ? value.title : tool,
      metadata: isRecord(value.metadata) ? value.metadata : {},
      output: value.output,
      attachments: Array.isArray(value.attachments)
        ? value.attachments.filter((item): item is SessionV1.FilePart => Schema.is(SessionV1.FilePart)(item))
        : undefined,
    }
  return { title: tool, metadata: {}, output: typeof value === "string" ? value : (JSON.stringify(value) ?? "") }
}

const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    SessionStatus.node,
    SessionPause.node,
    Session.node,
    Agent.node,
    Provider.node,
    SessionProcessor.node,
    SessionCompaction.node,
    Plugin.node,
    Command.node,
    Config.node,
    Permission.node,
    FSUtil.node,
    MCP.node,
    LSP.node,
    ToolRegistry.node,
    Truncate.node,
    Image.node,
    CrossSpawnSpawner.node,
    Instruction.node,
    SessionRunState.node,
    SessionRevert.node,
    SessionSummary.node,
    SystemPrompt.node,
    LLM.node,
    EventV2Bridge.node,
    LiveEvents.node,
    RuntimeFlags.node,
    Database.node,
  ],
})

export * as SessionPrompt from "./prompt"
