import { Effect, Fiber, Stream, type Scope } from "effect"
import { absurd } from "effect/Function"
import { Bus } from "@opencode/core/bus"
import { Form } from "@opencode/core/form"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { QuestionTool } from "@opencode/core/tool/plugin/question"
import { executeTool, toolIdentity } from "../lib/tool"

type Host = Effect.Success<ReturnType<typeof PluginHost.make>>
type PromiseContext = Parameters<Parameters<typeof PluginPromise.fromPromise>[0]["setup"]>[0]
type Api = "Effect" | "Promise"

export function exercise(
  api: Api,
  host: Host,
  body: {
    readonly effect: (ctx: Host) => Effect.Effect<void, unknown>
    readonly promise: (ctx: PromiseContext) => Promise<void>
  },
): Effect.Effect<void, unknown, Scope.Scope> {
  switch (api) {
    case "Effect":
      return body.effect(host)
    case "Promise":
      return PluginPromise.fromPromise({ id: "form-test.promise", setup: body.promise }).effect(host)
    default:
      return absurd(api)
  }
}

export const setup = Effect.gen(function* () {
  const plugins = yield* Plugin.Service
  const host = yield* PluginHost.make(plugins, "form-test")
  const owner = yield* host.session.create({ title: "Form owner" })
  const forms = yield* Form.Service
  return { host, owner, forms }
})

export const question = Effect.fnUntraced(function* (host: Host, sessionID: Session.ID) {
  const bus = yield* Bus.Service
  const tools = yield* Tool.Service
  yield* QuestionTool.Plugin.effect(host)
  const created = yield* bus
    .subscribe(Form.Event.Created)
    .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
  const running = yield* executeTool(tools, {
    sessionID,
    ...toolIdentity,
    call: {
      type: "tool-call",
      id: "call-native-form",
      name: "question",
      input: {
        questions: [
          { question: "Continue?", header: "Action", options: [{ label: "Yes", description: "Continue" }] },
          {
            question: "Which targets?",
            header: "Targets",
            multiple: true,
            options: [
              { label: "Alpha", description: "First" },
              { label: "Beta", description: "Second" },
            ],
          },
        ],
      },
    },
  }).pipe(Effect.forkChild({ startImmediately: true }))
  const event = (yield* Fiber.join(created))[0]
  if (!event) return yield* Effect.die(new Error("Native question did not create a form"))
  return { form: event.data.form, running }
})
