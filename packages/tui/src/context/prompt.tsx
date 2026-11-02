import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"
import type { PromptHeld } from "../plugin/prompt-control"

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: () => {
    let current: PromptRef | undefined
    let held: (() => PromptHeld | undefined) | undefined

    return {
      get current() {
        return current
      },
      set(ref: PromptRef | undefined) {
        current = ref
      },
      /** Whether a permission or question prompt stands in for the shown session's composer; see `PromptHeld`. */
      get held() {
        return held?.()
      },
      /** Returns the release, which leaves a source registered after this one in place. */
      hold(source: () => PromptHeld | undefined) {
        held = source
        return () => {
          if (held === source) held = undefined
        }
      },
    }
  },
})
