import { createHash, randomUUID } from "node:crypto"
import type {
  TuiComposerApi,
  TuiComposerDeliverRefusal,
  TuiComposerDeliverRequest,
  TuiComposerDeliverResult,
  TuiComposerDraft,
  TuiComposerGuard,
  TuiComposerResult,
  TuiComposerSealResult,
  TuiComposerSnapshot,
  TuiPromptRef,
} from "@opencode-ai/plugin/tui"
import type { ComposerSeal } from "../context/composer-seal"
import { copyPromptParts } from "../prompt/undo"
import { Identifier } from "@opencode-ai/core/id/id"

type State = { dialog: boolean; ready: boolean; sessionID: string | null }
type Content = Pick<TuiComposerSnapshot, "generation" | "sha256" | "partsSha256">
/** Sends a delivery past the composer; see `TuiComposerApi.deliver`. Absent, every delivery is `unmounted`. */
export type PromptSend = (
  request: Required<Omit<TuiComposerDeliverRequest, "metadata">> & Pick<TuiComposerDeliverRequest, "metadata">,
) => TuiComposerDeliverResult

/** All checks and mutations run synchronously on the owning TUI thread. */
export function createPromptControl(
  read: () => TuiPromptRef | undefined,
  state: () => State,
  composerSeal?: ComposerSeal,
  send?: PromptSend,
): TuiComposerApi {
  let active: TuiPromptRef | undefined
  let generation = randomUUID()
  const replacements = new Map<string, { key: string; receipt: TuiComposerResult }>()
  const submissions = new Map<string, { key: string; receipt: TuiComposerResult }>()
  const deliveries = new Map<string, { receipt: TuiComposerDeliverResult & { status: "submitted" }; metadata: string }>()

  function observe() {
    const ref = read()
    if (active !== ref) {
      active = ref
      generation = randomUUID()
      replacements.clear()
    }
    const current = ref?.current
    const handoff = ref?.handoff
    const flags = state()
    const reason: TuiComposerSnapshot["reason"] = !ref ? "unmounted" : !handoff ? "unsupported"
      : composerSeal?.sealed() ? "disabled" : flags.dialog ? "dialog"
      : !handoff.visible ? "hidden" : handoff.disabled ? "disabled"
      : current?.mode === "shell" ? "shell"
      : !flags.ready || !handoff.ready ? "syncing" : "ready"
    return { ref, current, handoff, flags, reason }
  }

  function draft(): TuiComposerDraft {
    const { current, handoff, flags, reason } = observe()
    return {
      generation, revision: handoff?.revision ?? 0, ready: reason === "ready", reason, sessionID: flags.sessionID,
      mode: current?.mode ?? "normal", input: current?.input ?? "", parts: current?.parts ?? [],
      caret: handoff?.caret?.() ?? null,
    }
  }

  function snapshot(): TuiComposerSnapshot {
    const { ref, current, handoff, flags, reason } = observe()
    return {
      generation, revision: handoff?.revision ?? 0, ready: reason === "ready", reason,
      focused: ref?.focused ?? false, visible: handoff?.visible ?? false,
      disabled: reason === "disabled" || (handoff?.disabled ?? true), dialog: flags.dialog, sessionID: flags.sessionID,
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

  function seal(): TuiComposerSealResult {
    const { ref, handoff, flags } = observe()
    if (!ref) return { status: "refused", reason: "unmounted" }
    if (!composerSeal || handoff?.busy === undefined) return { status: "refused", reason: "unsupported" }
    if (composerSeal.sealed()) return { status: "refused", reason: "sealed" }
    if (flags.dialog) return { status: "refused", reason: "dialog" }
    if (handoff.busy || composerSeal.busy()) return { status: "refused", reason: "busy" }
    const held = composerSeal.acquire()
    const captured = draft()
    return {
      status: "sealed",
      seal: held,
      draft: { ...captured, parts: copyPromptParts(captured.parts), caret: captured.caret && structuredClone(captured.caret) },
    }
  }

  /* Gated on what decides whether the composer could submit at all, minus what only stands between a person and
     the composer: an open dialog, shell mode and focus are not reasons to refuse, since nothing is typed. */
  function deliver(request: TuiComposerDeliverRequest): TuiComposerDeliverResult {
    const ids = { messageID: request.messageID ?? Identifier.ascending("message"), partID: request.partID ?? Identifier.ascending("part") }
    if (!ids.messageID.startsWith("msg_") || !ids.partID.startsWith("prt_")) return { status: "not-ready", reason: "invalid" }
    if (request.metadata !== undefined && !isJsonObject(request.metadata)) return { status: "not-ready", reason: "invalid" }
    const metadata = request.metadata === undefined ? "" : canonicalJson(request.metadata)
    const earlier = deliveries.get(ids.messageID)
    if (earlier)
      return earlier.receipt.partID === ids.partID && earlier.metadata === metadata
        ? earlier.receipt
        : { status: "not-ready", reason: "invalid" }
    const { ref, handoff, flags } = observe()
    const refuse = (reason: TuiComposerDeliverRefusal): TuiComposerDeliverResult => ({ status: "not-ready", reason })
    if (!ref || !handoff || !send) return refuse("unmounted")
    if (composerSeal?.sealed()) return refuse("disabled")
    if (!handoff.visible) return refuse("hidden")
    if (handoff.disabled) return refuse("disabled")
    if (!flags.ready) return refuse("syncing")
    if (flags.sessionID !== request.sessionID) return refuse("session")
    const result = send({
      sessionID: request.sessionID,
      text: request.text,
      ...ids,
      ...(request.metadata === undefined ? {} : { metadata: structuredClone(request.metadata) }),
    })
    if (result.status === "submitted") {
      deliveries.set(ids.messageID, { receipt: result, metadata })
      const oldest = deliveries.keys().next()
      if (deliveries.size > 256 && !oldest.done) deliveries.delete(oldest.value)
    }
    return result
  }

  return {
    seal,
    snapshot,
    read: draft,
    deliver,
    deliveryMetadata: true,
    replace(request) {
      const current = snapshot()
      const parts = request.promptParts ?? []
      const requestKey = JSON.stringify([
        key(request),
        createHash("sha256").update(request.text).digest("hex"),
        createHash("sha256").update(JSON.stringify(parts)).digest("hex"),
        request.caret ?? null,
      ])
      const replacement = replacements.get(request.correlationId)
      if (replacement) {
        return replacement.key === requestKey && matches(replacement.receipt.snapshot, current)
          ? replacement.receipt : { status: "conflict", snapshot: current }
      }
      if (!matches(request, current)) return { status: "conflict", snapshot: current }
      if (!current.ready || !active) return { status: "not-ready", snapshot: current }
      active.set({ input: request.text, parts: structuredClone(parts) })
      if (request.caret) active.handoff?.place?.(request.caret)
      const accepted = snapshot()
      const exact = active?.current.input === request.text
        && JSON.stringify(active.current.parts) === JSON.stringify(parts)
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

// Strings, finite numbers, booleans, null, arrays and objects whose prototype is Object's or null, with no cycles.
function isJsonObject(value: unknown): value is Record<string, unknown> {
  const seen = new Set<object>()
  const json = (item: unknown): boolean => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return true
    if (typeof item === "number") return Number.isFinite(item)
    if (typeof item !== "object" || seen.has(item)) return false
    seen.add(item)
    const plain = Array.isArray(item) ? item.every(json) : isPlain(item) && Object.values(item).every(json)
    seen.delete(item)
    return plain
  }
  return isPlain(value) && json(value)
}

function isPlain(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// JSON with object keys sorted, so two deliveries of the same metadata compare equal whatever their key order.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  return JSON.stringify(value)
}
