import { expect } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

for (const api of ["Effect", "Promise"] as const) {
  for (const mode of [undefined, "replace", "merge"] as const) {
    it.live(`${api} plugin metadata ${mode ?? "default"} preserves the update contract`, () =>
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const sessions = yield* Session.Service
        const owner = yield* PluginHost.make(plugins, "metadata.owner")
        const writer = yield* PluginHost.make(plugins, "metadata.writer")
        const session = yield* owner.session.create({ metadata: { owner: { retained: true } } })
        const input = {
          sessionID: session.id,
          metadata: { writer: { saved: true } },
          ...(mode ? { experimental: { metadataMode: mode } } : {}),
        }
        if (api === "Effect") yield* writer.session.update(input)
        if (api === "Promise")
          yield* PluginPromise.fromPromise({
            id: "metadata.writer",
            async setup(ctx) {
              await ctx.session.update(input)
            },
          }).effect(writer)
        expect((yield* sessions.get(session.id)).metadata).toEqual(
          mode === "merge" ? { owner: { retained: true }, writer: { saved: true } } : { writer: { saved: true } },
        )
        if (mode === "merge") expect(writer.app.capabilities?.sessionMetadataMergePatch).toBe(true)
      }),
    )
  }
}
