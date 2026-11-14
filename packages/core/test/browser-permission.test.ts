import { expect } from "bun:test"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionTitle } from "@opencode/core/session/title"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Schema } from "effect"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const llm = TestLLM.testLayer()
const it = testEffect(
  Layer.merge(
    llm,
    AppNodeBuilder.build(LayerNode.group([Session.node, SdkPlugins.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llm),
      SessionTitle.node.replace(Layer.succeed(SessionTitle.Service, { generate: () => Effect.void })),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: "browser-permission", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
    ]),
  ),
)

const setup = Effect.gen(function* () {
  const plugins = yield* SdkPlugins.Service
  yield* plugins.register({
    id: "external-browser",
    effect: (ctx) =>
      ctx.tool.transform((editor) =>
        editor.add({
          name: "browser",
          description: "A separately installed browser tool",
          input: Schema.Struct({ value: Schema.String }),
          options: { codemode: false },
          execute: (input) => Effect.succeed({ content: `External browser read ${input.value.length} characters` }),
        }),
      ),
  })
  const dir = yield* tmpdirScoped()
  const location = { directory: AbsolutePath.make(dir.path) }
  const locations = yield* LocationServiceMap.Service
  const context = yield* locations.contextEffect(location).pipe(Effect.scoped)
  yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
  const sessions = yield* Session.Service
  return { location, sessions }
})

it.live("an external browser tool reaches the provider and executor without a built-in attachment", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    // Disabling Code Mode exposes the real built-in tool definitions directly if their attachment gate leaks.
    const session = yield* fixture.sessions.create({
      location: fixture.location,
      permissions: [{ action: "execute", resource: "*", effect: "deny" }],
    })
    const model = yield* TestLLM.Test
    yield* model.push(
      TestLLM.toolCall("external-browser", "browser", { value: "native" }),
      TestLLM.text("Done", "done"),
    )

    yield* fixture.sessions.prompt({ sessionID: session.id, text: "Read with the external browser" })
    yield* fixture.sessions.wait(session.id)

    const requests = yield* model.requests()
    expect(requests[0]?.tools.filter((tool) => /^browser(?:_|$)/.test(tool.name)).map((tool) => tool.name)).toEqual([
      "browser",
    ])
    expect(
      requests[1]?.messages.flatMap((message) =>
        message.role === "tool" ? message.content.filter((part) => part.id === "external-browser") : [],
      ),
    ).toMatchObject([{ result: { type: "text", value: "External browser read 6 characters" } }])
  }),
)

for (const action of ["browser", "*"]) {
  it.live(`an external browser tool still respects a ${action} deny`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const session = yield* fixture.sessions.create({
        location: fixture.location,
        permissions: [{ action, resource: "*", effect: "deny" }],
      })
      const model = yield* TestLLM.Test
      yield* model.push(TestLLM.text("Done", "done"))

      yield* fixture.sessions.prompt({ sessionID: session.id, text: "Keep the denied tool hidden" })
      yield* fixture.sessions.wait(session.id)

      const requests = yield* model.requests()
      expect(requests[0]?.tools.filter((tool) => /^browser(?:_|$)/.test(tool.name))).toEqual([])
    }),
  )
}
