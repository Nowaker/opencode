import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { expect, spyOn } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { InstanceRef } from "../../src/effect/instance-ref"
import { MCP } from "../../src/mcp"
import { McpAuth } from "../../src/mcp/auth"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { McpOAuthPendingProvider } from "../../src/mcp/oauth-provider"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { unusedPort } from "../../script/serve-idle-probe"
import { tmpdirScoped } from "../fixture/fixture"
import { gate, observe, server } from "../fixture/mcp-native-lifetime"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([InstanceStore.node, MCP.node, McpAuth.node, CrossSpawnSpawner.node]), [
    [InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
  ]),
)

for (const phase of ["connect", "start-commit", "exchange", "finish-commit"] as const) {
  it.effect(`retains interrupted OAuth ${phase} through native settlement`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const store = yield* InstanceStore.Service
      const ctx = yield* store.acquire({ directory }, 100).pipe(Effect.scoped)
      yield* Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()))
        const fixture = yield* server
        const mcp = yield* MCP.Service
        const port = yield* Effect.promise(unusedPort)
        const name = `native-${phase}`
        const commit = gate()
        const original = McpOAuthPendingProvider.prototype.commit
        const commits = { completed: 0 }
        const spy = spyOn(McpOAuthPendingProvider.prototype, "commit").mockImplementation(async function (
          this: McpOAuthPendingProvider,
        ) {
          commit.started.resolve()
          if (phase === "start-commit" || phase === "finish-commit") await commit.finish.promise
          await original.call(this)
          commits.completed++
          commit.settled.resolve()
        })
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            commit.finish.resolve()
            spy.mockRestore()
          }),
        )
        fixture.state.oauth = true
        yield* mcp.add(name, { type: "remote", url: fixture.url, oauth: { callbackPort: port } })
        const completing = phase === "exchange" || phase === "finish-commit"
        if (completing) yield* mcp.startAuth(name)
        fixture.state.oauth = completing
        const events = yield* observe
        fixture.state.holdConnect = phase === "connect"
        fixture.state.holdToken = phase === "exchange"
        const work = yield* (completing ? mcp.finishAuth(name, "fixture-code") : mcp.startAuth(name)).pipe(
          Effect.forkScoped,
        )
        const held = phase === "connect" ? fixture.connect : phase === "exchange" ? fixture.token : commit
        yield* Effect.promise(() => held.started.promise)
        yield* Fiber.interrupt(work)
        yield* TestClock.adjust(500)
        expect(events.calls).toHaveLength(0)
        held.finish.resolve()
        yield* Effect.promise(() => commit.settled.promise)
        expect(commits.completed).toBe(1)
        if (completing) {
          const auth = yield* McpAuth.Service
          expect(Boolean((yield* auth.getForUrl(name, fixture.url))?.tokens)).toBe(true)
        }
        yield* events.settled
        yield* TestClock.adjust(99)
        expect(events.calls).toHaveLength(0)
        yield* TestClock.adjust(1)
        yield* Deferred.await(events.disposed)
      }).pipe(Effect.provideService(InstanceRef, ctx))
    }),
  )
}
