import { expect } from "bun:test"
import { Job } from "@opencode/core/job"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

for (const mode of ["effect", "promise"] as const) {
  it.live(`${mode} plugins cancel the real child Job and receive terminal repeats`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const jobs = yield* Job.Service
      const ctx = yield* PluginHost.make(plugins, "test.child-cancellation")
      const parent = yield* ctx.session.create()
      const child = yield* ctx.session.create({ parentID: parent.id })
      yield* jobs.start({
        id: child.id,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent.id,
          childSessionID: child.id,
          agent: "general",
          description: "Plugin cancellation",
        },
        run: Effect.never,
      })
      yield* jobs.background(child.id)
      const input = { parentID: parent.id, sessionID: child.id }

      if (mode === "effect") {
        expect(ctx.app.capabilities?.childCancellation).toBe(true)
        expect(yield* ctx.session.cancelChild(input)).toEqual({ status: "cancelled" })
        expect(yield* ctx.session.cancelChild(input)).toEqual({ status: "terminal", state: "cancelled" })
      }
      if (mode === "promise") {
        yield* PluginPromise.fromPromise({
          id: "test.child-cancellation.promise",
          async setup(promise) {
            expect(promise.app.capabilities?.childCancellation).toBe(true)
            expect(await promise.session.cancelChild(input)).toEqual({ status: "cancelled" })
            expect(await promise.session.cancelChild(input)).toEqual({ status: "terminal", state: "cancelled" })
          },
        }).effect(ctx)
      }
      expect(yield* jobs.pendingBackground).toMatchObject([{ id: child.id, status: "cancelled" }])
    }),
  )
}
