import { expect } from "bun:test"
import { OpenAI } from "@opencode/ai/providers"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Tool } from "@opencode/core/tool"
import { SessionMessage } from "@opencode/core/session/message"
import { Agent } from "@opencode/schema/agent"
import { Money } from "@opencode/schema/money"
import { Session } from "@opencode/schema/session"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { DateTime, Effect, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)
const session = Session.Info.make({
  id: Session.ID.make("ses_hook_tools"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const transport = SessionModelTransport.Service.of({
  bind: () => ({ execute: () => Effect.die("unused WebSocket execution") }),
  close: () => Effect.void,
  closeAll: Effect.void,
})

const runtimes = [
  {
    name: "Effect",
    register: (edit: (event: SessionContext) => void) =>
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        yield* hooks.register("session", "context", (event) =>
          Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => edit(event)))),
        )
      }),
  },
  {
    name: "Promise",
    register: (edit: (event: SessionContext) => void) =>
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* PluginPromise.fromPromise({
          id: "request-tool-deferral",
          async setup(context) {
            await context.session.hook("context", async (event) => {
              await Promise.resolve()
              edit(event)
            })
          },
        }).effect(yield* PluginHost.make(plugins, "test"))
      }),
  },
]

for (const runtime of runtimes) {
  it.effect(`${runtime.name} awaits request-local deferral and renaming while retaining only captured executors`, () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      let first = true
      let executions = 0
      yield* registry.transform((editor) => {
        for (const name of ["lookup", "gone", "denied", "browser", "functions", "python"])
          editor.add({
            name,
            description: name,
            options: { codemode: false },
            input: Schema.Struct({ value: Schema.Int }),
            output: Schema.Int,
            execute: ({ value }) =>
              Effect.sync(() => {
                executions++
                return { output: value * 7 }
              }),
          })
        editor.add({
          name: "catalog_only",
          description: "Code Mode only",
          input: Schema.Struct({}),
          output: Schema.Int,
          execute: () => Effect.succeed({ output: 99 }),
        })
      })
      yield* runtime.register((event) => {
        if (!first) return
        const tool = event.tools.lookup
        if (!tool) throw new Error("Missing lookup")
        tool.deferred = true
        event.tools.lookup_alias = tool
        delete event.tools.lookup
        delete event.tools.gone
        event.tools.denied = { description: "invented permission bypass", input: {}, deferred: true }
      })
      const tools = yield* registry.snapshot([{ action: "denied", resource: "*", effect: "deny" }])
      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
      const selected = SessionRunnerModel.resolved(OpenAI.configure({ apiKey: false }).responses("deployment"), {
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        cost: [],
        limit: { context: 200_000, output: 4096 },
      })
      const prepare = requests.primary({
        session,
        agent: Agent.ID.make("build"),
        model: selected,
        system: [],
        messages: [],
        tools,
      })
      const prepared = yield* prepare
      expect(
        prepared.request.tools
          .filter((tool) => tool.type === "tool" && tool.deferred === true)
          .map((tool) => tool.name),
      ).toEqual(["lookup_alias"])
      expect(prepared.request.tools.map((tool) => tool.name)).toEqual([
        "browser",
        "functions",
        "python",
        "execute",
        "lookup_alias",
        "tool_search",
      ])
      const call = (name: string) =>
        prepared.executeTool({
          sessionID: session.id,
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.make("msg_hook_deferral"),
          call: { type: "tool-call", id: `call_${name}`, name, input: { value: 13 } },
        })
      expect((yield* call("lookup_alias")).output).toBe(91)
      for (const name of ["lookup", "gone", "denied", "catalog_only", "tool_search"])
        expect(yield* call(name).pipe(Effect.flip)).toBeInstanceOf(Tool.Error)
      expect(executions).toBe(1)
      first = false
      const later = yield* prepare
      expect(later.request.tools.map((tool) => tool.name)).toEqual([
        "browser",
        "functions",
        "gone",
        "lookup",
        "python",
        "execute",
      ])
      expect(later.request.tools.filter((tool) => tool.type === "tool" && tool.deferred === true)).toEqual([])
      expect(tools.definitions.filter((tool) => tool.deferred === true)).toEqual([])
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )
}
