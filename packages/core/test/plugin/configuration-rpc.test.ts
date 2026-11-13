import { expect } from "bun:test"
import { Config } from "@opencode/core/config"
import { Plugin } from "@opencode/core/plugin"
import { Rpc } from "@opencode/core/rpc"
import { Document, Info } from "@opencode/schema/config"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import type { Registration } from "@opencode/plugin/promise/registration"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const port = Rpc.define({
  id: "configuration-lifetime",
  methods: {
    value: { input: { type: "object", properties: {}, additionalProperties: false }, output: { type: "string" } },
  },
  events: {},
})

for (const boundary of ["rerun", "dispose"] as const) {
  it.effect(`removes a Promise callback RPC after configuration ${boundary}`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const source = yield* Config.Test
      const rpc = yield* Rpc.Service
      const registration: { current?: Registration } = {}
      const definition = fromPromise({
        id: "rpc-config",
        setup: async (ctx) => {
          registration.current = await ctx.config.configure(async (draft) => {
            if (draft.shell !== "register") return
            await ctx.rpc.register(port, { value: async () => "active" })
          })
        },
      })
      const generation = { ...definition, revision: "1" }
      yield* source.setEntries([new Document({ type: "document", info: new Info({ shell: "register" }) })])
      yield* plugins.activate([generation])
      expect(yield* rpc.call(port.id, "value", {})).toBe("active")

      switch (boundary) {
        case "rerun":
          yield* source.setEntries([new Document({ type: "document", info: new Info({ shell: "omit" }) })])
          break
        case "dispose":
          if (!registration.current) return yield* Effect.die("configuration registration missing")
          yield* Effect.promise(() => registration.current?.dispose() ?? Promise.resolve())
          break
        default:
          boundary satisfies never
      }
      yield* plugins.activate([generation])

      expect(
        yield* rpc
          .call(port.id, "value", {})
          .pipe(Effect.match({ onSuccess: () => "available", onFailure: (error) => error.type })),
      ).toBe("rpc.unavailable")
    }),
  )
}
