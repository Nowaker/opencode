import { expect } from "bun:test"
import { Command } from "@opencode/core/command"
import { EngineStop } from "@opencode/core/engine-stop"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Instance } from "@opencode/core/instance/service"
import { Session } from "@opencode/core/session"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Cause, Context, Effect, Exit, Fiber, Layer, Option } from "effect"
import { forceInput, seal } from "./fixture/engine-stop"
import { owner, ownerGraph, ownerReplacements } from "./fixture/engine-stop-owner"
import { testEffect } from "./lib/effect"

const provisions = { count: 0 }
const observedSession = Session.node.mapLayer(<R>(base: Layer.Layer<Session.Service, never, R>) =>
  Layer.unwrap(Effect.gen(function* () {
    const context = yield* Effect.context<R>()
    const instance = Context.getOption(context, Instance.Service)
    if (Option.isNone(instance)) return yield* Effect.die(new Error("Session's real Instance dependency is missing"))
    const real = instance.value
    return base.pipe(Layer.provide(Layer.succeedContext(Context.add(context, Instance.Service, Instance.Service.of({
      ...real,
      provide: (session) => {
        provisions.count++
        return real.provide(session)
      },
    })))))
  })),
)
const it = testEffect(AppNodeBuilder.build(
  LayerNode.group([ownerGraph, Command.node, EngineStop.node]),
  [...ownerReplacements, Session.node.replace(observedSession)],
))

it.live("refuses a sealed Session command before location activation or dispatch", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const claims = yield* EngineStop.Service
    provisions.count = 0
    yield* s.sessions.command({ sessionID: s.sessionID, command: "probe", text: "" }).pipe(Effect.exit)
    expect(provisions.count, "unsealed command reaches the real Instance provider").toBeGreaterThan(0)
    provisions.count = 0
    const before = yield* s.sequence
    expect((yield* seal(claims)).status).toBe("sealed")
    const exit = yield* s.sessions.command({ sessionID: s.sessionID, command: "probe", text: "" }).pipe(Effect.exit)
    expect(provisions.count, "sealed command never calls the real Instance provider").toBe(0)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit).toMatchObject({
      _tag: "EngineStop.RefusedError", admission: { status: "not-admitted" },
    })
    expect(yield* s.sequence).toBe(before)
  }),
)

it.live("refuses a sealed registry command before evaluating its callback", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const commands = yield* Command.Service
    const claims = yield* EngineStop.Service
    const dispatched: string[] = []
    yield* commands.transform((editor) => editor.add({
      name: "probe",
      execute: () => Effect.sync(() => { dispatched.push("dispatch") }),
    }))
    yield* commands.execute({
      name: "probe", invocation: { sessionID: s.sessionID, prompt: { text: "" }, delivery: "steer" },
    })
    expect(dispatched, "unsealed registry command executes the registered callback").toEqual(["dispatch"])
    dispatched.length = 0
    yield* seal(claims)
    const result = yield* commands.execute({
      name: "probe", invocation: { sessionID: s.sessionID, prompt: { text: "" }, delivery: "steer" },
    }).pipe(Effect.exit)
    expect(dispatched).toEqual([])
    expect(Exit.isFailure(result) ? Cause.squash(result.cause) : result)
      .toMatchObject({ _tag: "EngineStop.RefusedError", admission: { status: "not-admitted" } })
  }),
)

it.live("does not label a command with committed effects not-admitted after a nested refusal", () =>
  Effect.gen(function* () {
    const s = yield* owner
    const commands = yield* Command.Service
    const claims = yield* EngineStop.Service
    yield* commands.transform((editor) => editor.add({
      name: "partially-dispatched",
      execute: () => Effect.gen(function* () {
        yield* s.sessions.synthetic({ sessionID: s.sessionID, mode: "append", text: "dispatch happened" })
        yield* claims.prepare(yield* forceInput(claims))
        const nested = yield* s.sessions.synthetic({ sessionID: s.sessionID, mode: "append", text: "new root" })
          .pipe(Effect.forkChild)
        yield* Fiber.join(nested)
      }),
    }))
    const error = yield* claims.withWork(commands.execute({
      name: "partially-dispatched",
      invocation: { sessionID: s.sessionID, prompt: { text: "" }, delivery: "steer" },
    }), Effect.void).pipe(Effect.flip)
    expect(error._tag).toBe("Command.ExecutionError")
    expect(error).not.toHaveProperty("admission")
    expect(error.message).not.toContain("no new admission")
    expect(yield* s.messages).toHaveLength(1)
  }),
)
