import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import { owner, ownerGraph, ownerReplacements } from "./fixture/engine-stop-owner"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(ownerGraph, ownerReplacements))

it.live("bare 24042 observation does not fence a later durable synthetic append", () =>
  Effect.gen(function* () {
    const s = yield* owner
    expect(Array.from(yield* s.sessions.active)).toEqual([])
    const id = SessionMessage.ID.create()
    const appended = yield* s.sessions.synthetic({ sessionID: s.sessionID, id, mode: "append", text: "owed input" })
    expect(appended).toEqual({ id })
    expect(yield* s.messages).toEqual([{ id, type: "synthetic" }])
  }),
)
