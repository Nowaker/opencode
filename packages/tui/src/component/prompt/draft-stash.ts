import type { TextareaRenderable, WidthMethod } from "@opentui/core"
import { createSignal } from "solid-js"
import { clone } from "remeda"
import { appendPrompt, type PromptInfo } from "../../prompt/history"
import type { PromptRef } from "./index"
import type { PendingInput } from "./textarea"

// Holds one in-progress draft per tab across Prompt remounts. A draft is
// consumed on take: restoring it moves it out of the stash, so a stale copy
// never shadows newer input.
export type DraftEntry = { prompt: PromptInfo; cursor: number; pendingInput?: readonly PendingInput[] }

const byTab = new Map<string | undefined, DraftEntry>()

export function captureDraft(prompt: PromptInfo, input: TextareaRenderable): DraftEntry {
  return { prompt: { ...clone(prompt), text: input.plainText }, cursor: input.cursorOffset }
}

export function takeDraft(sessionID: string | undefined) {
  const entry = byTab.get(sessionID)
  byTab.delete(sessionID)
  return entry
}

export function saveDraft(sessionID: string | undefined, entry: DraftEntry) {
  byTab.set(sessionID, { ...byTab.get(sessionID), ...entry })
}

export function savePendingInput(
  sessionID: string | undefined,
  events: readonly PendingInput[],
  fallback: () => DraftEntry,
) {
  const draft = byTab.get(sessionID) ?? fallback()
  saveDraft(sessionID, {
    ...draft,
    pendingInput: [...(draft.pendingInput ?? []), ...events],
  })
}

const composers = new Map<string | undefined, PromptRef>()
const [composerVersion, setComposerVersion] = createSignal(0)

export function mountedComposer(sessionID: string | undefined) {
  composerVersion()
  return composers.get(sessionID)
}

/** Marks a tab's mounted composer as the one {@link appendToSessionPrompt} writes to; returns its unregister. */
export function registerComposer(sessionID: string | undefined, composer: PromptRef) {
  composers.set(sessionID, composer)
  setComposerVersion((value) => value + 1)
  return () => {
    if (composers.get(sessionID) !== composer) return
    composers.delete(sessionID)
    setComposerVersion((value) => value + 1)
  }
}

/**
 * Appends a prompt that comes back after an await (an undo or revert) to a session's composer if one is mounted, else
 * to its stashed draft, after anything already typed there. A session view remounts with its tab, so the composer it
 * started with may be gone by then. Returns the composer it wrote to.
 */
export function appendToSessionPrompt(sessionID: string, prompt: PromptInfo, widthMethod: WidthMethod) {
  const composer = composers.get(sessionID)
  if (!composer) {
    const draft = takeDraft(sessionID)
    saveDraft(sessionID, {
      ...draft,
      prompt: draft ? appendPrompt(draft.prompt, prompt, widthMethod) : prompt,
      cursor: Infinity,
    })
    return
  }
  composer.setMode("normal")
  composer.set(appendPrompt(composer.current, prompt, widthMethod))
  return composer
}
