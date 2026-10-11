import type { TuiPromptInfo } from "./tui.js"

export type TuiComposerSnapshot = {
  generation: string
  revision: number
  ready: boolean
  reason: "ready" | "unmounted" | "unsupported" | "syncing" | "hidden" | "disabled" | "dialog" | "shell"
  focused: boolean
  visible: boolean
  disabled: boolean
  dialog: boolean
  sessionID: string | null
  sha256: string
  partsSha256: string
  inputBytes: number
  parts: number
  mode: "normal" | "shell"
}

export type TuiComposerGuard = {
  generation: string
  sha256: string
  partsSha256: string
  correlationId: string
}

export type TuiComposerResult = {
  status: "accepted" | "conflict" | "not-ready" | "mismatch" | "submitted"
  snapshot: TuiComposerSnapshot
}

/** Where the caret sits, as UTF-16 offsets into the composer's `input`. */
export type TuiComposerCaret = {
  offset: number
  selection?: { start: number; end: number }
}

/** What the composer holds, for a plugin that keeps or restores drafts. */
export type TuiComposerDraft = Pick<TuiComposerSnapshot, "generation" | "revision" | "ready" | "reason" | "sessionID" | "mode"> & {
  input: string
  parts: TuiPromptInfo["parts"]
  /** Null when the composer cannot report its caret. Moving the caret does not advance `revision`. */
  caret: TuiComposerCaret | null
}

/**
 * Why `seal()` refused; a refused seal changes nothing. `busy` means something already started can still change the
 * composer: a paste or the external editor still running, a prompt not yet admitted by the server, open
 * autocomplete, workspace or directory work, or a queued startup submit.
 */
export type TuiComposerSealRefusal = "unmounted" | "unsupported" | "sealed" | "dialog" | "busy"

export type TuiComposerSeal = Disposable & {
  /** Counts the seals this process has granted; never reused. */
  readonly generation: number
  /** Reopens input without replaying blocked attempts. False when this seal had already ended. */
  release(): boolean
}

export type TuiComposerSealResult =
  | { status: "sealed"; seal: TuiComposerSeal; draft: TuiComposerDraft }
  | { status: "refused"; reason: TuiComposerSealRefusal }

export type TuiComposerApi = {
  /**
    * Pauses composer input synchronously until release. Keys, pastes, mouse input, navigation and legacy prompt
    * mutations are blocked, not queued or accepted; the TUI shows persistent paused feedback. `replace()`/`submit()`
    * answer `not-ready` (`reason: "disabled"`). Release accepts fresh input only; blocked attempts must be retried.
    * `draft` is what the composer holds under the seal. The caller must persist it before stopping this process
    * and keep this exact seal held through termination. Releasing before killing reopens an input-loss race.
    * This API neither persists the draft nor authorizes a parent kill; no final snapshot closes that race.
   */
  seal(): TuiComposerSealResult
  snapshot(): TuiComposerSnapshot
  /** The composer's text and parts. Nothing is hashed, so it is cheap to poll by revision. */
  read(): TuiComposerDraft
  /**
   * `promptParts` defaults to none; given, they must describe ranges of `text`.
   * `caret` defaults to the end of `text`; offsets past it are clamped.
   */
  replace(request: TuiComposerGuard & { text: string; promptParts?: TuiPromptInfo["parts"]; caret?: TuiComposerCaret }): TuiComposerResult
  /** A submitted receipt acknowledges invocation, not server admission. */
  submit(request: TuiComposerGuard): TuiComposerResult
}
