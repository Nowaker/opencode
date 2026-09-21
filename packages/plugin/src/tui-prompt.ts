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

export type TuiComposerApi = {
  snapshot(): TuiComposerSnapshot
  replace(request: TuiComposerGuard & { text: string }): TuiComposerResult
  /** A submitted receipt acknowledges invocation, not server admission. */
  submit(request: TuiComposerGuard): TuiComposerResult
}
