import { expect } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

for (const api of ["Effect", "Promise"] as const) {
  it.live(`${api} plugin synthetic append returns raw projected IDs and rejects inference controls`, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const plugins = yield* Plugin.Service
      const context = yield* PluginHost.make(plugins, "synthetic-test")
      const session = yield* context.session.create({ title: "Synthetic API" })
      const id = SessionMessage.ID.create()
      const input = {
        sessionID: session.id,
        id,
        mode: "append" as const,
        text: "Plugin append",
        metadata: { source: api },
        ignored: false,
      }
      const invalid = [{ resume: true }, { resume: false }, { delivery: "queue" }, { delivery: "steer" }] as const
      const results: unknown[] = []

      expect(context.app.capabilities?.syntheticAppend).toBe(true)
      if (api === "Effect") {
        results.push(yield* context.session.synthetic(input))
        for (const controls of invalid)
          expect(
            yield* context.session
              .synthetic({ ...input, id: SessionMessage.ID.create(), ...controls })
              .pipe(Effect.flip),
          ).toMatchObject({ _tag: "SchemaError" })
        results.push(
          yield* context.session.synthetic({ sessionID: session.id, text: "Pending plugin input", resume: false }),
        )
      }
      if (api === "Promise")
        yield* PluginPromise.fromPromise({
          id: "synthetic-test",
          async setup(ctx) {
            results.push(await ctx.session.synthetic(input))
            for (const controls of invalid)
              await expect(
                ctx.session.synthetic({ ...input, id: SessionMessage.ID.create(), ...controls }),
              ).rejects.toMatchObject({ _tag: "SchemaError" })
            results.push(
              await ctx.session.synthetic({ sessionID: session.id, text: "Pending plugin input", resume: false }),
            )
          },
        }).effect(context)

      expect(results[0]).toEqual({ id })
      expect(results[1]).toMatchObject({
        type: "synthetic",
        sessionID: session.id,
        delivery: "steer",
        payload: { text: "Pending plugin input" },
      })
      expect(yield* sessions.messages({ sessionID: session.id })).toMatchObject([
        { id, text: "Plugin append", ignored: false, metadata: { source: api } },
      ])
      expect(yield* sessions.inbox(session.id)).toMatchObject([{ payload: { text: "Pending plugin input" } }])
    }),
  )
}
