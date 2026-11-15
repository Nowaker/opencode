import type { PromptInput } from "@opencode/schema/prompt-input"

/**
 * A detached, deeply readonly snapshot of the final native composer's draft.
 * All caret, selection, mention and pasted-source ranges use native edit-buffer
 * display offsets: cells under the renderer's width method, tab width and
 * control notation, plus one per line break. They are not UTF-16 string indices
 * or UTF-8 byte offsets. Wide graphemes, tabs and controls can span several cells.
 */
export type ComposerDraft = Pick<PromptInput.Prompt, "text" | "agents" | "skills"> & {
  readonly files?: readonly (PromptInput.FileAttachment & { readonly path?: string })[]
  readonly pasted: readonly {
    readonly text: string
    readonly source: { readonly start: number; readonly end: number; readonly text: string }
  }[]
  readonly mode: "normal" | "shell"
  /** Native edit-buffer display offset; see ComposerDraft. */
  readonly caret: number
  /** Direction is retained. A collapsed selection has anchor = focus = caret. */
  readonly selection: {
    /** Native edit-buffer display offset of the fixed selection endpoint. */
    readonly anchor: number
    /** Native edit-buffer display offset of the moving selection endpoint. */
    readonly focus: number
  }
}

/** The actual selected, mounted final composer, independently of keyboard focus. */
export type ComposerObservation =
  | {
      readonly status: "unavailable"
      readonly reason: "unsupported" | "not-mounted" | "not-selected" | "disposed"
    }
  | {
      readonly status: "ready"
      readonly kind: "final"
      /** Null identifies the final Home composer. */
      readonly sessionID: string | null
      readonly draft: ComposerDraft
    }

/** Read-only access to native composer state; never sends, edits or focuses input. */
export interface Composer {
  /** Reactive in Solid. Returns explicit unavailability while no selected final composer is ready. */
  current(): ComposerObservation
  /**
   * Emits current state synchronously, then changes. The idempotent disposer ends
   * delivery; component cleanup, plugin deactivation and TUI cleanup also dispose
   * the subscription. A retained API reports disposed after its lifetime ends.
   */
  subscribe(listener: (observation: ComposerObservation) => void): () => void
}
