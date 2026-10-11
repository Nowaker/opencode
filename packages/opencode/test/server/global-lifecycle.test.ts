import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { OwnerQuiescence } from "../../src/owner/quiescence"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeAllInstancesAndEmitGlobalDisposed } from "../../src/server/global-lifecycle"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mock(InstanceStore.Service)({
  disposeAll: () => OwnerQuiescence.activity(Effect.void),
}))

it.live("does not announce global disposal when a seal rejects disposal", () =>
  Effect.gen(function* () {
    const received: GlobalEvent[] = []
    const listener = (event: GlobalEvent) => { received.push(event) }
    GlobalBus.on("event", listener)
    yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener)))
    using seal = OwnerQuiescence.lease()

    yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })

    expect(received).toEqual([])
  }),
)
