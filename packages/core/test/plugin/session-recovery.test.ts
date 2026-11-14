import { expect } from "bun:test"
import { Effect } from "effect"
import { Event } from "@opencode/schema/event"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

for (const api of ["Effect", "Promise"] as const) {
  it.live(`${api} native recovery returns raw snapshots and retains typed guard refusal fields`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const ctx = yield* PluginHost.make(plugins, "recovery.fixture")
      const session = yield* ctx.session.create()
      const initial = yield* ctx.session.recovery({ sessionID: session.id })
      expect(initial).toMatchObject({
        throughSeq: -1,
        assistantMessageID: null,
        idleMessageID: null,
        executionID: null,
        localActive: false,
        pendingInput: false,
      })
      const input = { sessionID: session.id, text: "input", resume: false, experimental: { expected: initial } }
      yield* ctx.session.prompt({ ...input, experimental: undefined })
      const interruption = {
        sessionID: session.id,
        experimental: { expected: { executionID: Event.ID.create(), inputRevision: initial.inputRevision } },
      }
      const check = (error: unknown, reason: string, interrupted = false) => {
        expect(error).toMatchObject({
          _tag: interrupted ? "Session.InterruptGuardError" : "Session.PromptGuardError",
          accepted: false,
          reason,
          sessionID: session.id,
          ...(interrupted ? { interrupted: false } : {}),
        })
      }
      if (api === "Effect") {
        check(yield* ctx.session.prompt(input).pipe(Effect.flip), "not-idle")
        check(yield* ctx.session.interrupt(interruption).pipe(Effect.flip), "input-changed", true)
      }
      if (api === "Promise")
        yield* PluginPromise.fromPromise({
          id: "recovery.fixture",
          async setup(ctx) {
            expect(await ctx.session.recovery({ sessionID: session.id })).toMatchObject({
              pendingInput: true,
              executionID: null,
              localActive: false,
            })
            await ctx.session.prompt(input).then(
              () => {
                throw new Error("Expected refusal")
              },
              (error: unknown) => check(error, "not-idle"),
            )
            await ctx.session.interrupt(interruption).then(
              () => {
                throw new Error("Expected refusal")
              },
              (error: unknown) => check(error, "input-changed", true),
            )
          },
        }).effect(ctx)
    }),
  )
}
