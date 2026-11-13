import { expect } from "bun:test"
import { Job } from "@opencode/core/job"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { JobControl } from "@opencode/core/job/control"
import { Deferred, Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { observedJobControl } from "../fixture/job-results"

const it = testEffect(PluginTestLayer)

for (const mode of ["effect", "promise"] as const) {
  it.live(`${mode} plugins read raw owned native results`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const ctx = yield* PluginHost.make(plugins, "test.job-results")
      const jobs = yield* Job.Service
      const parent = yield* ctx.session.create()
      const foreign = yield* ctx.session.create()
      yield* jobs.start({
        id: "plugin_result",
        type: "image",
        recovery: { kind: "image", sessionID: parent.id, path: "/result.png", model: "test/image" },
        run: Effect.succeed("plugin native output"),
      })
      yield* jobs.background("plugin_result")
      const input = { parentID: parent.id, jobID: "plugin_result", wait: true }
      if (mode === "effect") {
        expect(ctx.app.capabilities?.jobResults).toBe(true)
        expect(yield* ctx.job.result(input)).toMatchObject({
          id: "plugin_result",
          kind: "image",
          status: "completed",
          output: "plugin native output",
        })
        expect(yield* ctx.job.result({ ...input, parentID: foreign.id }).pipe(Effect.flip)).toMatchObject({
          _tag: "Job.ParentMismatchError",
        })
      }
      if (mode === "promise") {
        yield* PluginPromise.fromPromise({
          id: "test.job-results.promise",
          async setup(promise) {
            expect(promise.app.capabilities?.jobResults).toBe(true)
            expect(await promise.job.result(input)).toMatchObject({
              id: "plugin_result",
              kind: "image",
              status: "completed",
              output: "plugin native output",
            })
            await expect(promise.job.result({ ...input, parentID: foreign.id })).rejects.toMatchObject({
              _tag: "Job.ParentMismatchError",
            })
          },
        }).effect(ctx)
      }
    }),
  )
}

it.live("a Promise AbortSignal interrupts only the native result read", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const observed = yield* observedJobControl
    const ctx = yield* PluginHost.make(plugins, "test.job-result-signal").pipe(
      Effect.provideService(JobControl.Service, observed.control),
    )
    const jobs = yield* Job.Service
    const parent = yield* ctx.session.create()
    const release = yield* Deferred.make<string>()
    const context = yield* Effect.context<never>()
    yield* jobs.start({
      id: "abort_result",
      type: "image",
      recovery: { kind: "image", sessionID: parent.id, path: "/abort.png", model: "test/image" },
      run: Deferred.await(release),
    })
    yield* jobs.background("abort_result")
    yield* PluginPromise.fromPromise({
      id: "test.job-result-signal.promise",
      async setup(promise) {
        const controller = new AbortController()
        const input = { parentID: parent.id, jobID: "abort_result", wait: true }
        const waiting = promise.job.result(input, { signal: controller.signal })
        await Effect.runPromiseWith(context)(Deferred.await(observed.wait))
        controller.abort()
        await expect(waiting).rejects.toThrow("All fibers interrupted without error")
        expect(await promise.job.result({ ...input, wait: false })).toMatchObject({ status: "running" })
        await Effect.runPromiseWith(context)(Deferred.succeed(release, "after signal"))
        expect(await promise.job.result(input)).toMatchObject({ status: "completed", output: "after signal" })
      },
    }).effect(ctx)
  }),
)
