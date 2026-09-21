import { createHash, randomUUID } from "node:crypto"
import type { TuiComposerApi, TuiComposerGuard, TuiComposerResult, TuiComposerSnapshot, TuiPromptRef } from "@opencode-ai/plugin/tui"

type State = { dialog: boolean; ready: boolean; sessionID: string | null }
type Content = Pick<TuiComposerSnapshot, "generation" | "sha256" | "partsSha256">

/** All checks and mutations run synchronously on the owning TUI thread. */
export function createPromptControl(read: () => TuiPromptRef | undefined, state: () => State): TuiComposerApi {
  let active: TuiPromptRef | undefined
  let generation = randomUUID()
  const replacements = new Map<string, { key: string; receipt: TuiComposerResult }>()
  const submissions = new Map<string, { key: string; receipt: TuiComposerResult }>()

  function snapshot(): TuiComposerSnapshot {
    const ref = read()
    if (active !== ref) {
      active = ref
      generation = randomUUID()
      replacements.clear()
    }
    const current = ref?.current
    const handoff = ref?.handoff
    const flags = state()
    const reason = !ref ? "unmounted" : !handoff ? "unsupported" : flags.dialog ? "dialog"
      : !handoff.visible ? "hidden" : handoff.disabled ? "disabled"
      : current?.mode === "shell" ? "shell"
      : !flags.ready || !handoff.ready ? "syncing" : "ready"
    return {
      generation, revision: handoff?.revision ?? 0, ready: reason === "ready", reason,
      focused: ref?.focused ?? false, visible: handoff?.visible ?? false,
      disabled: handoff?.disabled ?? true, dialog: flags.dialog, sessionID: flags.sessionID,
      sha256: createHash("sha256").update(current?.input ?? "").digest("hex"),
      partsSha256: createHash("sha256").update(JSON.stringify(current?.parts ?? [])).digest("hex"),
      inputBytes: Buffer.byteLength(current?.input ?? ""), parts: current?.parts.length ?? 0,
      mode: current?.mode ?? "normal",
    }
  }

  // The revision advances when our own write settles, so only content can say
  // whether the composer still holds what the caller described.
  function matches(request: Content, current: TuiComposerSnapshot) {
    return request.generation === current.generation && request.sha256 === current.sha256
      && request.partsSha256 === current.partsSha256
  }

  function key(request: TuiComposerGuard) {
    return JSON.stringify([request.generation, request.sha256, request.partsSha256, request.correlationId])
  }

  return {
    snapshot,
    replace(request) {
      const current = snapshot()
      const requestKey = JSON.stringify([key(request), createHash("sha256").update(request.text).digest("hex")])
      const replacement = replacements.get(request.correlationId)
      if (replacement) {
        return replacement.key === requestKey && matches(replacement.receipt.snapshot, current)
          ? replacement.receipt : { status: "conflict", snapshot: current }
      }
      if (!matches(request, current)) return { status: "conflict", snapshot: current }
      if (!current.ready || !active) return { status: "not-ready", snapshot: current }
      active.set({ input: request.text, parts: [] })
      const accepted = snapshot()
      const exact = active?.current.input === request.text && active.current.parts.length === 0
        && accepted.generation === current.generation && accepted.mode === "normal"
      const receipt: TuiComposerResult = { status: exact ? "accepted" : "mismatch", snapshot: accepted }
      replacements.set(request.correlationId, { key: requestKey, receipt })
      return receipt
    },
    submit(request) {
      const requestKey = key(request)
      const submission = submissions.get(request.correlationId)
      if (submission?.key === requestKey) return submission.receipt
      const current = snapshot()
      if (submission) return { status: "conflict", snapshot: current }
      if (!matches(request, current)) return { status: "conflict", snapshot: current }
      if (!current.ready || !active?.handoff?.submit) return { status: "not-ready", snapshot: current }
      const receipt: TuiComposerResult = { status: "submitted", snapshot: current }
      submissions.set(request.correlationId, { key: requestKey, receipt })
      active.handoff.submit({ input: active.current.input, parts: active.current.parts.length })
      return receipt
    },
  }
}
