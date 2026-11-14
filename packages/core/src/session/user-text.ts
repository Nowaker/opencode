export * as SessionUserText from "./user-text.js"

import type { Prompt } from "@opencode/schema/prompt"

export const parts = (message: Pick<Prompt, "text" | "textParts">): string[] => {
  const visible = message.textParts?.filter((part) => !part.ignored) ?? []
  return [
    ...visible.filter((part) => part.position === "before").map((part) => part.text),
    message.text,
    ...visible.filter((part) => part.position === "after").map((part) => part.text),
  ]
}

export const text = (message: Pick<Prompt, "text" | "textParts">) => parts(message).join("\n")
