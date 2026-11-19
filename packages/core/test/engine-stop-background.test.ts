import { expect } from "bun:test"
import { EngineStop } from "@opencode/core/engine-stop"
import { Database } from "@opencode/core/database/database"
import { Command } from "@opencode/core/command"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { SessionTable } from "@opencode/core/session/sql"
import { eq } from "drizzle-orm"
import { Effect, Deferred, Fiber } from "effect"
import { childCancellationLayer, childFixture, Drains } from "./fixture/child-cancellation"
import { forceInput } from "./fixture/engine-stop"
import { testEffect } from "./lib/effect"

const it = testEffect(childCancellationLayer)

it.live("transfers an owed command child through Job startup under force without a provider drain", () =>
  Effect.gen(function* () {
    const s = yield* childFixture
    const subagents = yield* SubagentJob.Service
    const claims = yield* EngineStop.Service
    const database = yield* Database.Service
    const drains = yield* Drains
    const entered = yield* Deferred.make<void>()
    drains.set(s.child.id, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
    const locations = yield* LocationServiceMap.Service
    const location = locations.get(s.parent.location)
    yield* Plugin.awaitActivation.pipe(Effect.provide(location))
    const commands = yield* Command.Service.pipe(Effect.provide(location))
    const registered = yield* Deferred.make<EngineStop.Operation>()
    yield* commands.transform((editor) => editor.add({
      name: "owed-child",
      execute: () => Effect.gen(function* () {
        yield* s.sessions.prompt({ sessionID: s.child.id, text: "already owed", resume: false })
        const operation = yield* claims.prepare(yield* forceInput(claims))
        yield* subagents.start(s.recovery)
        yield* subagents.background(s.recovery)
        yield* Deferred.succeed(registered, operation)
      }).pipe(Effect.uninterruptible),
    }))
    const command = yield* s.sessions.command({ sessionID: s.parent.id, command: "owed-child", text: "" })
      .pipe(Effect.forkScoped)
    const operation = yield* Effect.raceFirst(
      Deferred.await(registered),
      Fiber.await(command).pipe(Effect.andThen(Effect.die(new Error("the command exited before its child was registered")))),
    )
    const result = yield* Effect.raceFirst(
      s.jobs.wait({ id: s.child.id }),
      Deferred.await(entered).pipe(Effect.andThen(Effect.die(new Error("the forced command child reached a provider drain")))),
    )
    expect(result.info?.status).toBe("cancelled")
    yield* s.jobs.awaitIdle(s.child.id)
    yield* Fiber.await(command)
    const row = yield* database.db.select({ claim: SessionTable.time_suspended })
      .from(SessionTable).where(eq(SessionTable.id, s.child.id)).get()
    expect(row?.claim).toBeNumber()
    expect((yield* claims.awaitOperation(operation.operationID, 10_000)).status).toBe("sealed")
  }),
)
