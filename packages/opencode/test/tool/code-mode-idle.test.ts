import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Agent } from "../../src/agent/agent"
import { InstanceRef } from "../../src/effect/instance-ref"
import { MCP } from "../../src/mcp"
import { Plugin } from "../../src/plugin"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Session } from "../../src/session/session"
import { MessageID } from "../../src/session/schema"
import { CodeModeTool } from "../../src/tool/code-mode"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { tmpdirScoped } from "../fixture/fixture"
import { observe, server } from "../fixture/mcp-native-lifetime"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      InstanceStore.node,
      MCP.node,
      Agent.node,
      Session.node,
      Plugin.node,
      Truncate.node,
      CrossSpawnSpawner.node,
    ]),
    [
      [InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
      [Plugin.node, Layer.mock(Plugin.Service, { trigger: (_name, _input, output) => Effect.succeed(output) })],
    ],
  ),
)

it.effect("retains a raced-out native MCP call after codemode execution completes", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const ctx = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
    yield* Effect.gen(function* () {
      const fixture = yield* server
      const mcp = yield* MCP.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Native MCP race" })
      yield* mcp.add("native", { type: "remote", url: fixture.url, oauth: false })
      const events = yield* observe
      const tool = yield* CodeModeTool.pipe(
        Effect.flatMap(Tool.init),
        Effect.provideService(Session.Service, { ...sessions, get: () => Effect.succeed(chat) }),
      )
      const result = yield* tool.execute(
        { code: "return await Promise.race([tools.native.slow({}), tools.native.fast({})])" },
        {
          sessionID: chat.id,
          messageID: MessageID.ascending(),
          agent: "build",
          callID: "native-race",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      expect(result.output).toBe("fast")
      yield* TestClock.adjust(500)
      expect(events.calls).toHaveLength(0)
      fixture.slow.finish.resolve()
      yield* events.settled
      yield* TestClock.adjust(99)
      expect(events.calls).toHaveLength(0)
      yield* TestClock.adjust(1)
      yield* Deferred.await(events.disposed)
    }).pipe(Effect.provideService(InstanceRef, ctx))
  }),
)
