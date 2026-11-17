import type { EditorTraits } from "@opentui/core"

export const promptSelectionOccupancy = "boundary"

export type PromptMode = "normal" | "shell"

export interface PromptTraitsInput {
  mode: PromptMode
  autocompleteVisible: boolean
}

export type PromptTraits = EditorTraits & {
  owner: "opencode"
  role: "prompt"
}

export function isPromptTraits(traits: EditorTraits): traits is PromptTraits {
  return "owner" in traits && traits.owner === "opencode" && "role" in traits && traits.role === "prompt"
}

/** The managed textarea keymap owns `suspend`; these traits only describe capture and status. */
export function computePromptTraits(input: PromptTraitsInput): PromptTraits {
  const capture =
    input.mode === "normal"
      ? input.autocompleteVisible
        ? (["escape", "navigate", "submit", "tab"] as const)
        : (["tab"] as const)
      : undefined
  return {
    capture,
    status: input.mode === "shell" ? "SHELL" : undefined,
    owner: "opencode",
    role: "prompt",
  }
}
