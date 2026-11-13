import { expect } from "bun:test"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { ModelsDev } from "@opencode/core/models-dev"
import { Session } from "@opencode/core/session"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionRunnerLLM } from "@opencode/core/session/runner/llm"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { Context, Deferred, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createEmbeddedRoutes } from "../src/routes"

it.live("HTTP child cancellation validates the parent and reports actual settled execution and Job status", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const started = yield* Deferred.make<void>()
    const runner = Layer.succeed(SessionRunner.Service, {
      drain: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    })
    const context = yield* Layer.build(
      createEmbeddedRoutes({}, [
        Global.node.replace(tempGlobalLayer),
        Database.node.replace(Database.node),
        Bus.node.replace(Bus.node),
        App.node.replace(App.node),
        ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
        Watcher.node.replace(Watcher.configured({ enabled: false })),
        SessionRunnerLLM.node.replace(runner),
      ]).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const sessions = Context.get(context, Session.Service)
    const jobs = Context.get(context, Job.Service)
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory.path) } })
    const child = yield* sessions.create({ parentID: parent.id })
    const input = { parentID: parent.id, sessionID: child.id }
    yield* jobs.start({
      id: child.id,
      type: "subagent",
      recovery: {
        kind: "subagent",
        parentSessionID: parent.id,
        childSessionID: child.id,
        agent: "general",
        description: "HTTP cancellation",
      },
      run: sessions.resume(child.id).pipe(Effect.as("done")),
    })
    yield* jobs.background(child.id)
    yield* Deferred.await(started)
    const cancel = (parentID: Session.ID, sessionID = child.id) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/api/experimental/session/${parentID}/children/${sessionID}/cancel`, {
            method: "POST",
          }),
        ),
      )
    const info = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/info")))
    expect(info.status).toBe(200)
    expect(yield* Effect.promise(() => info.json())).toMatchObject({ capabilities: { childCancellation: true } })

    const mismatch = yield* cancel(Session.ID.create())
    expect(mismatch.status).toBe(409)
    expect((yield* jobs.get(child.id))?.status).toBe("running")
    const missing = yield* cancel(parent.id, Session.ID.create())
    expect(missing.status).toBe(404)
    const stopped = yield* cancel(input.parentID)
    expect(stopped.status).toBe(200)
    expect(yield* Effect.promise(() => stopped.json())).toEqual({ status: "cancelled" })
    expect(yield* jobs.pendingBackground).toMatchObject([{ id: child.id, status: "cancelled" }])
    const repeated = yield* cancel(parent.id)
    expect(yield* Effect.promise(() => repeated.json())).toEqual({ status: "terminal", state: "cancelled" })
  }),
)
