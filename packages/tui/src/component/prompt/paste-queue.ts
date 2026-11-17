import type { TextareaRenderable } from "@opentui/core"
import { batch } from "solid-js"

type PasteTarget = {
  readonly input: TextareaRenderable
  readonly sessionID?: string
  readonly mode: "normal" | "shell"
}

export function createPasteQueue(current: () => PasteTarget | undefined, onError: (error: unknown) => void) {
  let queue = Promise.resolve()
  return (prepare: () => Promise<(() => void) | undefined>, applied?: () => void) => {
    queue = queue
      .then(async () => {
        const before = current()
        if (!before) return
        const text = before.input.plainText
        const apply = await prepare()
        const after = current()
        if (
          !apply ||
          !after ||
          after.input !== before.input ||
          after.sessionID !== before.sessionID ||
          after.mode !== before.mode ||
          after.input.plainText !== text
        )
          return
        // Keep the draft and replay receipt coherent before reactive owner changes run.
        batch(() => {
          apply()
          applied?.()
        })
      })
      .catch(onError)
    return queue
  }
}
