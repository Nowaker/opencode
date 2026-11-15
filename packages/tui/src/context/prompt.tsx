import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"
import type { ComposerObservation } from "@opencode/plugin/tui/composer"
import { createSignal, onCleanup } from "solid-js"
import { mountedComposer } from "../component/prompt/draft-stash"
import { useRoute } from "./route"

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: () => {
    const route = useRoute()
    const [active, setActive] = createSignal(true)
    onCleanup(() => setActive(false))
    let current: PromptRef | undefined

    return {
      get current() {
        return current
      },
      set(ref: PromptRef | undefined) {
        current = ref
      },
      observe(): ComposerObservation {
        if (!active()) return { status: "unavailable", reason: "disposed" }
        const selected = route.data
        switch (selected.type) {
          case "plugin":
            return { status: "unavailable", reason: "not-selected" }
          case "home":
          case "session": {
            const sessionID = selected.type === "home" ? undefined : selected.sessionID
            const draft = mountedComposer(sessionID)?.observe()
            return draft
              ? { status: "ready", kind: "final", sessionID: sessionID ?? null, draft }
              : { status: "unavailable", reason: "not-mounted" }
          }
          default: {
            const exhaustive: never = selected
            return exhaustive
          }
        }
      },
    }
  },
})
