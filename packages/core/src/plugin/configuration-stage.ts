export * as ConfigurationStage from "./configuration-stage.js"

import { Cause, Effect, Exit } from "effect"
import { ConfigDraft } from "../config/draft.js"
import type { ConfigSnapshot } from "../config/snapshot.js"
import type { Activation } from "./activation.js"

export const apply = Effect.fn("Plugin.configure")(function* (
  configuration: ConfigSnapshot.Configuration,
  activations: readonly Activation[],
) {
  while (true) {
    const sources = yield* configuration.entries()
    const healthy = activations.filter((owner) => !owner.failure)
    yield* Effect.forEach(healthy, (owner) => owner.configuration.close(), { discard: true })
    const owners = healthy.filter((owner) => owner.configuration.registered())
    if (!owners.length) {
      yield* configuration.commit(sources)
      return sources
    }
    const before = ConfigDraft.resolve(sources)
    const draft = ConfigDraft.resolve(sources)
    let failed = false
    for (const owner of owners) {
      const exit = yield* owner
        .configure(draft, () => {
          ConfigDraft.project(sources, before, draft)
        })
        .pipe(Effect.exit)
      if (Exit.isSuccess(exit)) continue
      if (Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause)
      failed = true
      break
    }
    if (failed || sources !== (yield* configuration.entries())) continue
    yield* configuration.commit(ConfigDraft.project(sources, before, draft))
    return sources
  }
})
