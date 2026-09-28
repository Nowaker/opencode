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

/** What the composer holds, for a plugin that keeps or restores drafts. */
export type TuiComposerDraft = Pick<TuiComposerSnapshot, "generation" | "revision" | "ready" | "reason" | "sessionID" | "mode"> & {
  input: string
  parts: TuiPromptInfo["parts"]
}

export type TuiComposerApi = {
  snapshot(): TuiComposerSnapshot
  /** The composer's text and parts. Nothing is hashed, so it is cheap to poll by revision. */
  read(): TuiComposerDraft
  /** `promptParts` defaults to none; given, they must describe ranges of `text`. */
  replace(request: TuiComposerGuard & { text: string; promptParts?: TuiPromptInfo["parts"] }): TuiComposerResult
  /** A submitted receipt acknowledges invocation, not server admission. */
  submit(request: TuiComposerGuard): TuiComposerResult
}
