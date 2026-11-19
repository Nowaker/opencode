import { expect } from "bun:test"
import { EngineStop } from "@opencode/core/engine-stop"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import { seal } from "./fixture/engine-stop"
import { owner, ownerGraph, ownerReplacements } from "./fixture/engine-stop-owner"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([ownerGraph, EngineStop.node]), ownerReplacements))

for (const ignored of [false, true]) {
  it.live(`24042 plus real service refuses post-seal Session append (ignored=${ignored}) before writing`, () =>
    Effect.gen(function* () {
      const s = yield* owner
      const service = yield* EngineStop.Service
      const operation = yield* seal(service)
      expect(operation.status).toBe("sealed")
      const id = SessionMessage.ID.create()
      const result = yield* s.sessions
        .synthetic({
          sessionID: s.sessionID,
          id,
          mode: "append",
          text: "owed input",
          ignored,
        })
        .pipe(Effect.exit)
      expect(yield* s.messages).toEqual([])
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        expect(Cause.squash(result.cause)).toMatchObject({
          _tag: "EngineStop.RefusedError",
          operationID: operation.operationID,
          admission: { status: "not-admitted" },
        })
      }
    }),
  )
}

it.live("24042 plus real service refuses a sealed agent switch before publishing any durable event", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const service = yield* EngineStop.Service
    const before = yield* s.sequence
    const agent = (yield* s.sessions.get(s.sessionID)).agent
    const operation = yield* seal(service)
    expect(operation.status).toBe("sealed")

    const result = yield* s.sessions
      .switchAgent({
        sessionID: s.sessionID,
        agent: Agent.ID.make("sealed-profile-probe"),
      })
      .pipe(Effect.exit)

    expect(yield* s.sequence).toBe(before)
    expect((yield* s.sessions.get(s.sessionID)).agent).toBe(agent)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(Cause.squash(result.cause)).toMatchObject({
        _tag: "EngineStop.RefusedError",
        admission: { status: "not-admitted" },
      })
    }
  }),
)
