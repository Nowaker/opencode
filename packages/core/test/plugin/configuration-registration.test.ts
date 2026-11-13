import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import type { ConfigDomain } from "@opencode/plugin/effect/config"
import { Effect, Exit } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.effect("rejects configuration registrations after setup has settled", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const captured: { config?: ConfigDomain } = {}
    yield* plugins.activate([
      {
        id: "setup-only",
        revision: "1",
        effect: (ctx) =>
          Effect.sync(() => {
            captured.config = ctx.config
          }),
      },
    ])
    if (!captured.config) return yield* Effect.die("plugin setup did not run")

    const late = yield* captured.config.configure(() => Effect.void).pipe(Effect.exit)

    expect(Exit.isFailure(late)).toBe(true)
  }),
)
