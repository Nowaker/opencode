import { GlobalBus } from "@/bus/global"
import { InstanceStore } from "@/project/instance-store"
import { Effect } from "effect"
import { Event } from "./event"
import type { DisposeReason } from "@/effect/instance-registry"

export const emitGlobalDisposed = Effect.sync(() =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Event.Disposed.type,
      properties: {},
    },
  }),
)

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn("Server.disposeAllInstancesAndEmitGlobalDisposed")(
  function* (options?: { swallowErrors?: boolean; reason?: DisposeReason }) {
    const store = yield* InstanceStore.Service
    yield* Effect.gen(function* () {
      yield* store.disposeAll(options?.reason)
      yield* emitGlobalDisposed
    }).pipe(
      Effect.uninterruptible,
      (work) => options?.swallowErrors
        ? work.pipe(Effect.catchCause((cause) => Effect.logWarning("global disposal failed", { cause })))
        : work,
    )
  },
)

export * as GlobalLifecycle from "./global-lifecycle"
