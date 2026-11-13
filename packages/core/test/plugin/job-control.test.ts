import { expect } from "bun:test"
import { Job } from "@opencode/core/job"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Deferred, Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

for (const mode of ["effect", "promise"] as const) {
  it.live(`${mode} plugins list their native Job subtree and cancel only a direct owner`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const jobs = yield* Job.Service
      const ctx = yield* PluginHost.make(plugins, "test.job-control")
      const parent = yield* ctx.session.create()
      const child = yield* ctx.session.create({ parentID: parent.id })
      const stopped = yield* Deferred.make<void>()
      for (const [id, sessionID] of [
        ["image_parent", parent.id],
        ["image_child", child.id],
      ] as const) {
        yield* jobs.start({
          id,
          type: "image",
          recovery: {
            kind: "image",
            sessionID,
            path: `/${id}.png`,
            model: "test/image",
          },
          run: Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(stopped, undefined))),
        })
        yield* jobs.background(id)
      }
      const input = { parentSessionID: parent.id }
      if (mode === "effect") {
        expect(ctx.app.capabilities?.jobControl).toBe(true)
        expect((yield* ctx.job.list(input)).data.map((job) => job.id)).toEqual(["image_parent"])
        expect((yield* ctx.job.list({ ...input, descendants: true })).data.map((job) => job.id)).toEqual([
          "image_parent",
          "image_child",
        ])
        expect(yield* ctx.job.cancel({ parentID: child.id, jobID: "image_parent" }).pipe(Effect.flip)).toMatchObject({
          _tag: "Job.ParentMismatchError",
        })
        expect(yield* ctx.job.cancel({ parentID: parent.id, jobID: "image_parent" })).toEqual({ status: "cancelled" })
      }
      if (mode === "promise") {
        yield* PluginPromise.fromPromise({
          id: "test.job-control.promise",
          async setup(promise) {
            expect(promise.app.capabilities?.jobControl).toBe(true)
            expect((await promise.job.list(input)).data.map((job) => job.id)).toEqual(["image_parent"])
            expect((await promise.job.list({ ...input, descendants: true })).data.map((job) => job.id)).toEqual([
              "image_parent",
              "image_child",
            ])
            await expect(promise.job.cancel({ parentID: child.id, jobID: "image_parent" })).rejects.toMatchObject({
              _tag: "Job.ParentMismatchError",
            })
            expect(await promise.job.cancel({ parentID: parent.id, jobID: "image_parent" })).toEqual({
              status: "cancelled",
            })
          },
        }).effect(ctx)
      }
      expect(yield* Deferred.isDone(stopped)).toBe(true)
      expect((yield* jobs.pendingBackground).map((job) => ({ id: job.id, status: job.status }))).toEqual([
        { id: "image_parent", status: "cancelled" },
        { id: "image_child", status: "running" },
      ])
    }),
  )
}
