import type { Config } from "@opencode/schema/config"
import type { Effect, Scope, Types } from "effect"
import type { Registration } from "./registration.js"

export type Draft = Types.DeepMutable<Config.Info>

export interface ConfigDomain {
  /**
   * Experimental: mutate resolved document configuration after plugin setup and before native config consumers.
   * Callbacks run sequentially on a fresh draft at activation and source reload. Registration is setup-only.
   * Closing the registration removes its edits. The plugin list cannot be changed from this stage.
   */
  readonly configure: (
    callback: (draft: Draft) => Effect.Effect<void, never, Scope.Scope>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
}
