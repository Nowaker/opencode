import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Instance } from "@opencode/core/instance/service"
import { Job } from "@opencode/core/job"
import { JobControl } from "@opencode/core/job/control"
import { SessionStore } from "@opencode/core/session/store"
import { Deferred, Effect, Layer } from "effect"

export const observedJobControl = Effect.gen(function* () {
  const jobs = yield* Job.Service
  const database = yield* Database.Service
  const store = yield* SessionStore.Service
  const instance = yield* Instance.Service
  const read = yield* Deferred.make<void>()
  const wait = yield* Deferred.make<void>()
  const layer = AppNodeBuilder.build(JobControl.node, [
    Job.node.replace(
      Layer.succeed(Job.Service, {
        ...jobs,
        get: (id) => Deferred.succeed(read, undefined).pipe(Effect.andThen(jobs.get(id))),
        wait: (input) => Deferred.succeed(wait, undefined).pipe(Effect.andThen(jobs.wait(input))),
      }),
    ),
    Database.node.replace(Layer.succeed(Database.Service, database)),
    SessionStore.node.replace(Layer.succeed(SessionStore.Service, store)),
    Instance.node.replace(Layer.succeed(Instance.Service, instance)),
  ])
  const control = yield* JobControl.Service.pipe(Effect.provide(Layer.fresh(layer)))
  return { control, read, wait }
})
