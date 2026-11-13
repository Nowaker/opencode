import type { Draft } from "../effect/config.js"
import type { Registration } from "./registration.js"

export interface ConfigDomain {
  /**
   * Experimental: mutate resolved document configuration after plugin setup and before native config consumers.
   * Callbacks are awaited sequentially on a fresh draft at activation and source reload. Registration is setup-only.
   * Closing the registration removes its edits. The plugin list cannot be changed from this stage.
   */
  readonly configure: (callback: (draft: Draft) => Promise<void> | void) => Promise<Registration>
}
