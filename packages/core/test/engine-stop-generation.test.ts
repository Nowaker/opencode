import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { EngineStop } from "@opencode/core/engine-stop"
import { Cause, Effect, Exit, Fiber } from "effect"
import { it, setup } from "./fixture/subagent-options"
import { forceInput, seal } from "./fixture/engine-stop"

it.live("refuses sealed direct generation before model calls or usage publication", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const claims = yield* EngineStop.Service
    const before = yield* Bus.latestSequence(s.db, s.parent.id)
    expect((yield* seal(claims)).status).toBe("sealed")
    const result = yield* s.sessions.generate({ sessionID: s.parent.id, prompt: "transient" }).pipe(Effect.exit)
    expect(Exit.isFailure(result) ? Cause.squash(result.cause) : result).toMatchObject({
      _tag: "EngineStop.RefusedError", admission: { status: "not-admitted" },
    })
    expect(yield* s.llm.requests()).toEqual([])
    expect(yield* Bus.latestSequence(s.db, s.parent.id)).toBe(before)
  }),
)

it.live("force interrupts owned direct generation and waits for its cleanup", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const claims = yield* EngineStop.Service
    const before = yield* Bus.latestSequence(s.db, s.parent.id)
    const gate = yield* s.llm.gate()
    const generation = yield* s.sessions.generate({ sessionID: s.parent.id, prompt: "transient" })
      .pipe(Effect.forkScoped)
    yield* Effect.raceFirst(
      gate.started,
      Fiber.await(generation).pipe(Effect.andThen(Effect.die(new Error("generation exited before its model call")))),
    )
    const operation = yield* claims.prepare(yield* forceInput(claims))
    const result = yield* Fiber.await(generation)
    expect(Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)).toBe(true)
    expect(yield* Bus.latestSequence(s.db, s.parent.id)).toBe(before)
    expect((yield* claims.awaitOperation(operation.operationID, 10_000)).status).toBe("sealed")
  }),
)
