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

/**
 * Text sent to the shown session as a turn of its own, past the composer. `messageID` and `partID` are the IDs the
 * message and its text part are stored under (`msg_…`, `prt_…`); the server stores a message once per ID, so a
 * caller that is unsure whether a delivery landed sends it again with the same IDs. Omitted, the TUI makes them.
 *
 * `metadata` is stored as the text part's `metadata`, as a prompt's text part input `metadata` is: shown by readers
 * such as the TUI, never sent to the model. It must be a plain JSON object (strings, finite numbers, booleans, null,
 * arrays and plain objects, no cycles); it is copied when `deliver()` is called. Omitted, the part has no `metadata`.
 * A repeat with the same `messageID` returns the earlier receipt only when `partID` and `metadata` are the same as the
 * first time (object key order aside); otherwise it is refused `invalid`, since the message is stored only once.
 * Only a host whose `TuiComposerApi.deliveryMetadata` is `true` stores it; an older host drops it silently.
 */
export type TuiComposerDeliverRequest = {
  sessionID: string
  text: string
  messageID?: string
  partID?: string
  metadata?: Record<string, unknown>
}

/**
 * Why `deliver()` refused; a refused delivery sends nothing. `hidden`: the session shows no prompt (a permission or a
 * question is waiting, or it is a subagent). `disabled`: the composer is sealed or disabled. `session`: the TUI is not
 * showing `sessionID`. `agent`/`model`/`workspace`: no agent or model is selected, or the session's workspace is not
 * connected. `invalid`: a malformed ID, `metadata` that is not a plain JSON object, or a repeated `messageID` whose
 * `partID` or `metadata` differs from the first delivery.
 */
export type TuiComposerDeliverRefusal =
  | "unmounted"
  | "hidden"
  | "disabled"
  | "syncing"
  | "session"
  | "agent"
  | "model"
  | "workspace"
  | "invalid"

export type TuiComposerDeliverResult =
  | { status: "submitted"; messageID: string; partID: string }
  | { status: "not-ready"; reason: TuiComposerDeliverRefusal }

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
  /**
   * Sends `text` to the shown session as its own turn, with the agent, model and variant the composer would use,
   * without touching the composer: its text, caret, focus and undo history stay as they are, and an open dialog
   * (command palette, agent or model list, paste editor) stays open with its filter and selection. It is refused
   * only where the composer itself could not submit: no prompt shown, sealed, disabled, still syncing. A submitted
   * receipt acknowledges that the TUI sent it, not that the server stored it; a server that refuses it does not put
   * the text in the composer.
   */
  deliver(request: TuiComposerDeliverRequest): TuiComposerDeliverResult
  /** `true` when `deliver()` stores `request.metadata` on the delivered text part. Absent on hosts that drop it. */
  readonly deliveryMetadata?: true
}
