export * as EngineStop from "./engine-stop.js"
export * from "@opencode/schema/engine-stop"
export { OwnershipError, type Reservation } from "./engine-stop/claims.js"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { make } from "./engine-stop/claims.js"
import { control } from "./engine-stop/control.js"
import { State } from "./engine-stop/state.js"

export class Service extends Context.Service<Service, Interface>()("@opencode/EngineStop") {}

const create = Effect.gen(function* () {
  const state = new State()
  const claims = make(state)
  const lifecycle = yield* control(state, claims)
  return {
    withWork: claims.withWork,
    within: claims.within,
    reserve: claims.reserve,
    retain: claims.retain,
    transfer: claims.transfer,
    check: claims.check,
    shutdownRequested: claims.shutdownRequested,
    releaseCurrent: claims.releaseCurrent,
    ...lifecycle,
  } as const
})

export type Interface = Effect.Success<typeof create>
export const layer = Layer.effect(Service, create)
export const node = makeGlobalNode({ service: Service, layer, deps: [] })
