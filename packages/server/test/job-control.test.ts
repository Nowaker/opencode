import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { ModelsDev } from "@opencode/core/models-dev"
import { Session } from "@opencode/core/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { Context, Deferred, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createEmbeddedRoutes } from "../src/routes"

it.live("HTTP Job control advertises support and enforces the persisted owner with truthful terminal repeats", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const context = yield* Layer.build(
      createEmbeddedRoutes(
        {
          config: { project: false, claude: false, content: "{}" },
          fs: { filewatcher: false },
        },
        [
          Global.node.replace(tempGlobalLayer),
          Database.node.replace(Database.node),
          Bus.node.replace(Bus.node),
          App.node.replace(App.node),
          ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
        ],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const sessions = Context.get(context, Session.Service)
    const jobs = Context.get(context, Job.Service)
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const api = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
        preconnect: fetch.preconnect,
      }),
    })
    const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory.path) } })
    const child = yield* sessions.create({ parentID: parent.id })
    const stopped = yield* Deferred.make<void>()
    yield* jobs.start({
      id: "image_http",
      type: "image",
      recovery: {
        kind: "image",
        sessionID: parent.id,
        path: "/fixture.png",
        model: "test/image",
      },
      run: Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(stopped, undefined))),
    })
    yield* jobs.background("image_http")
    yield* jobs.start({
      id: child.id,
      type: "subagent",
      recovery: {
        kind: "subagent",
        parentSessionID: parent.id,
        childSessionID: child.id,
        agent: "general",
        description: "HTTP refusal",
      },
      run: Effect.never,
    })
    yield* jobs.background(child.id)

    yield* Effect.promise(async () => {
      expect((await api.server.info()).capabilities?.jobControl).toBe(true)
      await expect(api.experimental.job.cancel({ parentID: child.id, jobID: "image_http" })).rejects.toMatchObject({
        _tag: "ConflictError",
      })
      await expect(api.experimental.job.cancel({ parentID: parent.id, jobID: "missing" })).rejects.toMatchObject({
        _tag: "JobNotFoundError",
      })
      expect(await api.experimental.job.cancel({ parentID: parent.id, jobID: child.id })).toEqual({
        status: "unsupported",
        reason: "Use session.cancelChild for subagent jobs",
      })
      expect(await api.experimental.job.cancel({ parentID: parent.id, jobID: "image_http" })).toEqual({
        status: "cancelled",
      })
      expect(await api.experimental.job.cancel({ parentID: parent.id, jobID: "image_http" })).toEqual({
        status: "terminal",
        state: "cancelled",
      })
    })
    expect(yield* Deferred.isDone(stopped)).toBe(true)
    expect((yield* jobs.get(child.id))?.status).toBe("running")
  }),
)
