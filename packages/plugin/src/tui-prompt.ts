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
  /** Logical draft UUID. Absent on older hosts and custom prompt providers. */
  draftID?: string
  input: string
  parts: TuiPromptInfo["parts"]
  /** Null when the composer cannot report its caret. Moving the caret does not advance `revision`. */
  caret: TuiComposerCaret | null
}

type TuiComposerTypingContext = {
  readonly draftID: string
  readonly sessionID: string | null
  /** Producer Date.now(), shared with the submit gesture clock. */
  readonly timeMs: number
}

/** Count-only observations from the standard interactive composer, never the CLI run footer. */
export type TuiComposerTypingEvent = TuiComposerTypingContext & (
  | { readonly kind: "started" | "focus_gained" | "focus_lost" | "cleared" | "restored" }
  | { readonly kind: "abandoned"; readonly reason: string }
  | {
      readonly kind: "edit"
      readonly insertedChars: number
      readonly deletedChars: number
      readonly isPaste: boolean
      readonly pasteChars: number
    }
)

export type TuiComposerTypingSubmit = {
  readonly draftID: string
  readonly sessionID: string
  readonly messageID: string
  readonly timeMs: number
}

export type TuiComposerTypingObserver = {
  /** Runs on the input thread: enqueue only, with no disk or process I/O. No text is exposed. */
  event(event: TuiComposerTypingEvent): void
  /** Resolve only once the intent is durable. Rejection preserves the composer and prevents dispatch. */
  beforeSubmit(event: TuiComposerTypingSubmit): Promise<void>
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
 * Why `deliver()` refused; a refused delivery sends nothing. `unmounted`: the TUI shows no session prompt (a subagent,
 * or it is still opening). `hidden`: a prompt is mounted but not shown. `disabled`: the composer is sealed or disabled,
 * such as while a revert is applied. `session`: the TUI is not showing `sessionID`. `agent`/`model`/`workspace`: no
 * agent or model is selected, or the session's workspace is not connected. `invalid`: a malformed ID, `metadata` that is not a plain JSON object, or a repeated `messageID` whose
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
   * Observes standard native composers, including Unicode code point edit counts and terminal focus reports
   * when the terminal/tmux forwards them. Draft activity begins on an edit, explicit restore or submit intent;
   * empty mounts, clears and sends do not start another record. A subscription receives active draft identity and focus;
   * earlier edits are not replayed. Programmatic writes and external editors do not count as typing.
   * beforeSubmit gates interactive prompt and server slash command dispatch with their exact message ID.
   * Shell dispatch ends the draft with abandoned/sent_to_shell, since its user message is synthetic.
   * It records an intent, not admission: only a persisted user message proves acceptance.
   */
  observeTyping?(observer: TuiComposerTypingObserver): () => void
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
  replace(request: TuiComposerGuard & { text: string; promptParts?: TuiPromptInfo["parts"]; caret?: TuiComposerCaret; draftID?: string }): TuiComposerResult
  /** A submitted receipt acknowledges invocation, not server admission. */
  submit(request: TuiComposerGuard): TuiComposerResult
  /**
   * Sends `text` to the shown session as its own turn, with the agent, model and variant the composer would use,
   * without touching the composer: its text, caret, focus and undo history stay as they are, and an open dialog
   * (command palette, agent or model list, paste editor) stays open with its filter and selection. A permission or
   * question prompt shown in the composer's place stays on screen, unanswered: the server stores the text and the
   * turn waiting on that prompt reads it once the person answered. It is refused only where the composer itself could
   * not submit: no session prompt, sealed, disabled, still syncing. A submitted
   * receipt acknowledges that the TUI sent it, not that the server stored it; a server that refuses it does not put
   * the text in the composer.
   */
  deliver(request: TuiComposerDeliverRequest): TuiComposerDeliverResult
  /** `true` when `deliver()` stores `request.metadata` on the delivered text part. Absent on hosts that drop it. */
  readonly deliveryMetadata?: true
}
