export * as SubagentTool from "./subagent.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Cause, Effect, Exit, Option, Predicate, Schema } from "effect"
import { Agent } from "../../agent.js"
import { Config } from "../../config.js"
import { Job } from "../../job.js"
import { Model } from "../../model.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { SubagentCompletion } from "../../session/subagent-completion.js"
import { SubagentJob } from "../../session/subagent-job.js"
import { SubagentGroup } from "../../session/subagent-group.js"
import { Database } from "../../database/database.js"

export const name = "subagent"

const backgroundResult = (sessionID: SessionSchema.ID, notice?: SubagentGroup.Notice) => ({
  sessionID,
  status: "running" as const,
  output: [
    `The subagent is working in the background (sessionID: ${sessionID}). ${notice === "none" ? "No completion notice was requested." : typeof notice === "object" ? "You will be notified when every slot in the group finishes." : "You will be notified automatically when it finishes."}`,
    "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
    "To send it follow-ups or change its instructions while it runs, call subagent again with this sessionID.",
  ].join("\n"),
})

export const Input = Schema.Struct({
  agent: Schema.String.annotate({
    description:
      "The type of specialized agent to use for this task. If the user asks for a subagent by a name that is not one of the available subagents, they most likely mean a model: pick a suitable agent and pass the name through the model parameter instead.",
  }),
  description: Schema.String.annotate({ description: "A short 3-5 word label for the task, displayed to the user" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  model: Schema.optionalKey(Schema.String).annotate({
    description:
      'NEVER set this unless the user explicitly asks for a particular model or variant. It must be a chat model; image and decision models can\'t run subagents. The value is written as "providerID/modelID", or "providerID/modelID#variant" to include a variant. Do not guess the ID: look the model up with the models tool, filtering to your own provider first.',
  }),
  sessionID: Schema.optionalKey(SessionSchema.ID).annotate({
    description: "Send a follow-up to an existing subagent, running or finished. Omit to start a new one.",
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress.",
  }),
  fork: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Start a new child with the calling parent's settled current context. Cannot be combined with sessionID.",
  }),
  notice: Schema.optionalKey(SubagentGroup.Notice).annotate({
    description:
      "Completion notice: each (default), none, or a fixed group with a parent-scoped id, zero-based index, and total. Each slot may be invoked once; the parent receives one notice after all total slots settle.",
  }),
  foregroundHandoffMs: Schema.optionalKey(Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))).annotate({
    description:
      "Background a still-running foreground child after this many milliseconds without cancelling it. Zero or omitted waits normally.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  status: Schema.Literals(["completed", "running"]),
  output: Schema.String,
})
export const description = [
  "Spawns an agent in a child session to work on the specified task.",
  "The output includes a sessionID you can pass back later to continue that specific conversation with the subagent.",
  "New child sessions start with fresh context, so include all relevant context and instructions when you don't pass a sessionID.",
  "Foreground (default) runs the subagent to completion and returns its final response.",
  "Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.",
  "Use background only for independent work that can run while you continue elsewhere.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.subagent",
  effect: Effect.fn("SubagentTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const models = yield* Model.Service
    const subagents = yield* SubagentJob.Service
    const db = (yield* Database.Service).db

    const resolveModel = Effect.fn("SubagentTool.resolveModel")(function* (input: string) {
      const ref = yield* Effect.try({
        try: () => Model.Ref.parse(input),
        catch: () =>
          new ToolFailure({
            message: `Invalid model "${input}". Use "providerID/modelID" or "providerID/modelID#variant".`,
          }),
      })
      const model = (yield* models.available()).find(
        (model) => model.providerID === ref.providerID && model.id === ref.id,
      )
      if (model === undefined) {
        const other = (yield* models.available(["image", "decision"])).find(
          (model) => model.providerID === ref.providerID && model.id === ref.id,
        )
        return yield* new ToolFailure({
          message: other
            ? `Model "${ref.providerID}/${ref.id}" is ${other.type === "image" ? "an image" : "a decision"} model; subagents need a chat model. Use the models tool to find one.`
            : `Model "${ref.providerID}/${ref.id}" is not available. Use the models tool to see what is available.`,
        })
      }
      if (ref.variant !== undefined && !model.variants.some((variant) => variant.id === ref.variant))
        return yield* new ToolFailure({
          message:
            model.variants.length === 0
              ? `Model "${ref.providerID}/${ref.id}" has no variants. Omit the variant.`
              : `Variant "${ref.variant}" is not available for "${ref.providerID}/${ref.id}". Available: ${model.variants.map((variant) => variant.id).join(", ")}.`,
        })
      return ref
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const group =
                  typeof input.notice === "object"
                    ? yield* SubagentGroup.register(db, {
                        parentSessionID: context.sessionID,
                        group: input.notice.group,
                        description: input.description,
                        agent: input.agent,
                      }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
                    : undefined
                return yield* restore(
                  Effect.gen(function* () {
                    if (input.fork && input.sessionID !== undefined)
                      return yield* new ToolFailure({ message: "fork can only start a new subagent; omit sessionID" })
                    const parent = yield* sessions
                      .get(context.sessionID)
                      .pipe(
                        Effect.mapError(
                          (error) =>
                            new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                        ),
                      )
                    let current = parent
                    let depth = 0
                    while (current.parentID) {
                      depth++
                      current = yield* sessions
                        .get(current.parentID)
                        .pipe(
                          Effect.mapError(
                            (error) =>
                              new ToolFailure({ message: `Parent session not found: ${current.parentID}`, error }),
                          ),
                        )
                    }
                    const limit = Config.latest(yield* config.entries(), "experimental")?.subagent_depth ?? 1
                    if (depth >= limit)
                      return yield* new ToolFailure({
                        message: `Subagent depth limit reached (${limit}). Increase "experimental.subagent_depth" to allow nested subagents.`,
                      })
                    const agent = yield* agents.resolve(input.agent)
                    if (agent === undefined) return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` })
                    const existing =
                      input.sessionID === undefined
                        ? undefined
                        : yield* sessions
                            .get(input.sessionID)
                            .pipe(
                              Effect.mapError(
                                (error) =>
                                  new ToolFailure({ message: `Subagent session not found: ${input.sessionID}`, error }),
                              ),
                            )
                    if (existing !== undefined && existing.parentID !== context.sessionID)
                      return yield* new ToolFailure({
                        message: `Session ${existing.id} is not a child of the current session`,
                      })
                    const forked = input.fork === true || existing?.fork?.sessionID === context.sessionID
                    const parentAgent = yield* agents.select(parent.agent)
                    if (agent.mode === "primary" && !(forked && agent.id === parentAgent.id))
                      return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` })
                    yield* permission
                      .assert({
                        action: name,
                        resources: [agent.id],
                        save: [agent.id],
                        ...Permission.invocation(context),
                      })
                      .pipe(
                        Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })),
                      )

                    const running = existing ? (yield* jobs.get(existing.id))?.status === "running" : false
                    if (group && running)
                      return yield* new ToolFailure({ message: "A group slot cannot join an already running subagent" })
                    if (group && existing)
                      yield* SubagentGroup.claimChild(db, group, existing.id).pipe(
                        Effect.mapError((error) => new ToolFailure({ message: error.message })),
                      )
                    if (!group && existing && !running && (yield* SubagentGroup.owners(db, existing.id)).length > 0)
                      return yield* new ToolFailure({ message: "A group slot is preparing this subagent" })
                    const override = input.model === undefined ? undefined : yield* resolveModel(input.model)

                    const model = override ?? agent.model ?? parent.model
                    const child =
                      existing ??
                      (yield* (
                        input.fork
                          ? sessions.fork({
                              sessionID: context.sessionID,
                              child: { title: input.description, agent: agent.id, model },
                            })
                          : sessions.create({
                              parentID: context.sessionID,
                              title: input.description,
                              agent: agent.id,
                              model,
                            })
                      ).pipe(
                        Effect.mapError(
                          (error) =>
                            new ToolFailure({
                              message: input.fork ? error.message : `Parent session not found: ${context.sessionID}`,
                              error,
                            }),
                        ),
                      ))

                    const background = input.background === true
                    const launch = yield* subagents.admit(
                      child.id,
                      Effect.gen(function* () {
                        if (group && existing && (yield* jobs.get(child.id))?.status === "running")
                          return yield* new ToolFailure({
                            message: "A group slot cannot join an already running subagent",
                          })
                        if (!group && existing && !running && (yield* SubagentGroup.owners(db, child.id)).length > 0)
                          return yield* new ToolFailure({ message: "A group slot is preparing this subagent" })
                        // An explicit model wins over the switched agent's model, then the inherited model.
                        if (existing !== undefined) {
                          const switched = existing.agent !== agent.id
                          const model = override ?? (switched ? agent.model : undefined)
                          yield* Effect.all([
                            switched ? sessions.switchAgent({ sessionID: child.id, agent: agent.id }) : Effect.void,
                            model === undefined ? Effect.void : sessions.switchModel({ sessionID: child.id, model }),
                          ]).pipe(
                            Effect.mapError(
                              (error) =>
                                new ToolFailure({ message: `Failed to switch subagent session: ${child.id}`, error }),
                            ),
                          )
                        }
                        if (group && !existing)
                          yield* SubagentGroup.update(db, group, { status: "running", childSessionID: child.id })
                        yield* context.progress({ sessionID: child.id, status: "running" })

                        // Standard prompt admission outside the job: Job.start joining a running child skips
                        // its run effect, and the default wake starts an idle child or steers a running one.
                        const promptID = yield* sessions
                          .prompt({
                            sessionID: child.id,
                            text:
                              existing === undefined
                                ? ["You are a subagent spawned by another session.", input.prompt].join("\n")
                                : input.prompt,
                            ...((background && existing === undefined) || group ? { resume: false } : {}),
                          })
                          .pipe(
                            Effect.mapError(
                              (error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error }),
                            ),
                          )

                        const recovery = {
                          kind: "subagent" as const,
                          parentSessionID: context.sessionID,
                          childSessionID: child.id,
                          agent: agent.name,
                          description: input.description,
                          ...(input.notice ? { notice: input.notice } : {}),
                          ...(group ? { group } : {}),
                          ...(forked ? { after: promptID.id } : {}),
                        }
                        const started = yield* subagents.start(recovery)
                        if (group) yield* subagents.notify(recovery, started.started_at)
                        if (background) yield* subagents.background(recovery)
                        return { recovery, started }
                      }),
                    )
                    const recovery = launch.recovery
                    const started = launch.started

                    if (background) {
                      return backgroundResult(child.id, input.notice)
                    }

                    const result = yield* Effect.gen(function* () {
                      const wait = jobs.block({ id: child.id, sessionID: context.sessionID })
                      if (!input.foregroundHandoffMs) return yield* wait
                      const outcome = yield* wait.pipe(Effect.timeoutOption(input.foregroundHandoffMs))
                      if (Option.isSome(outcome)) return outcome.value
                      yield* subagents.background(recovery)
                      return { type: "backgrounded" as const, info: (yield* jobs.get(child.id)) ?? started }
                    }).pipe(
                      Effect.onInterrupt(() =>
                        Effect.all([sessions.interrupt(child.id), jobs.cancel(child.id)], {
                          discard: true,
                        }),
                      ),
                    )
                    if (result?.type === "backgrounded") {
                      yield* subagents.notify(recovery, result.info.started_at)
                      return backgroundResult(child.id, input.notice)
                    }
                    if (group && result)
                      yield* SubagentCompletion.deliver(sessions, jobs, { ...result.info, recovery, db }).pipe(
                        Effect.orDie,
                      )
                    // Failure surfaces keep the sessionID visible so the model can continue the child.
                    if (result?.info.status === "error")
                      return yield* new ToolFailure({
                        message: `Subagent failed (sessionID: ${child.id}): ${result.info.error ?? "unknown error"}`,
                      })
                    if (result?.info.status === "cancelled")
                      return yield* new ToolFailure({ message: `Subagent cancelled (sessionID: ${child.id})` })
                    return {
                      sessionID: child.id,
                      status: "completed" as const,
                      output: result?.info.output ?? SubagentCompletion.NO_TEXT,
                    }
                  }),
                ).pipe(
                  Effect.onExit((exit) => {
                    if (!group || Exit.isSuccess(exit)) return Effect.void
                    return SubagentGroup.update(db, group, {
                      status: Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "error",
                      error: Cause.pretty(exit.cause),
                    }).pipe(
                      Effect.andThen(
                        Effect.gen(function* () {
                          const state = yield* SubagentGroup.get(db, group.parentSessionID, group.id)
                          if (state) yield* SubagentCompletion.deliverGroup(sessions, { db, state }).pipe(Effect.orDie)
                        }),
                      ),
                    )
                  }),
                )
              }),
            ).pipe(
              Effect.map((output) => ({
                output,
                content:
                  output.status === "completed"
                    ? `<subagent sessionID="${output.sessionID}" state="completed">\n${output.output}\n</subagent>`
                    : output.output,
                metadata: { sessionID: output.sessionID, status: output.status },
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.sync(() => {
        if (event.tool !== name || !Predicate.isObject(event.input)) return
        if (event.input.model !== "" && event.input.sessionID !== "") return
        const input = { ...event.input }
        if (input.model === "") delete input.model
        if (input.sessionID === "") delete input.sessionID
        event.input = input
      }),
    )

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        const selected = yield* agents.resolve(event.agent)
        if (!selected) return
        const available = (yield* agents.list())
          .filter(
            (agent) =>
              agent.mode !== "primary" &&
              !agent.hidden &&
              Permission.evaluate(name, agent.id, selected.permissions).effect !== "deny",
          )
          .toSorted((a, b) => a.id.localeCompare(b.id))
        if (available.length === 0) return
        tool.description = [
          tool.description,
          "",
          "Available subagents:",
          ...available.map(
            (agent) =>
              `- ${agent.id}: ${agent.description ?? "This subagent should only be called when explicitly requested."}`,
          ),
        ].join("\n")
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
