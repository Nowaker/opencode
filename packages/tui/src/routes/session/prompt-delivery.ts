import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2"
import { splitVibetermHead } from "../../util/vibeterm-provenance"

export type PromptDelivery = { state: "queued" | "paused" | "inbox" | "mid-turn"; wakesAt?: number }

/** How a delivery that starts no turn by itself gets read: `later` also arms one fallback wake. */
export type InboxWake = "later" | "never"

// The badge words, each in one place so renaming one is a one-line change.
export const DeliveryLabel = { queued: "QUEUED", paused: "PAUSED", inbox: "INBOX" } as const

// opencode-tools `_lib/vibeterm-orchestration/later-wake.ts` LATER_WAKE_DELAY_MS: a wake=later message starts a
// turn this long after it was sent if the session is still idle and has not replied. Later messages arriving while
// that wake is pending share it, so the earliest unread one sets the time.
export const LATER_WAKE_DELAY_MS = 30 * 60_000

// opencode-tools `_lib/session-message` QUEUED_NOTE_DELIVERY, the `delivery:` of a note that starts no turn.
const QUEUED_NOTE_DELIVERY = "queued without starting a turn"

/*
 * Where each user message stands with the turn it arrived during, keyed by message ID.
 *
 * A step reads every user message up to the one its assistant message answers, so a message is read once any later
 * assistant message answers it or a newer user message. Until then:
 * - a delivery that starts no turn by itself is "inbox" whatever the session does, since the next turn reads it; a
 *   wake=later one carries the time its fallback wake starts that turn, unless the session is paused, which holds
 *   that wake too;
 * - any other message is "paused" while the session is paused, since unpause runs it;
 * - otherwise it is "queued" while a turn runs that it waits behind: one whose step was still streaming when it
 *   arrived, or one that kept stepping without it (the server's `queued_prompts: "turn_end"`).
 * A read message is "mid-turn" when the first step after it read it and the step before it had ended on tool calls,
 * so the turn took it in without ending first.
 */
export function promptDeliveries(
  messages: readonly Message[],
  input: { busy: boolean; paused: boolean; inbox: (messageID: string) => InboxWake | undefined },
) {
  const position = new Map(messages.map((message, index) => [message.id, index]))
  const result = new Map<string, PromptDelivery>()
  const previous: (AssistantMessage | undefined)[] = []
  let last: AssistantMessage | undefined
  for (const message of messages) {
    previous.push(last)
    if (message.role === "assistant") last = message
  }
  let reader = -1
  let next: AssistantMessage | undefined
  let earliestLater: number | undefined
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === "assistant") {
      reader = Math.max(reader, position.get(message.parentID) ?? -1)
      next = message
      continue
    }
    const before = previous[index]
    if (reader < index) {
      const wake = input.inbox(message.id)
      if (wake) {
        result.set(message.id, { state: "inbox" })
        if (wake === "later") earliestLater = message.time.created
        continue
      }
      if (input.paused) {
        result.set(message.id, { state: "paused" })
        continue
      }
      if (input.busy && (next || (before && !before.time.completed))) result.set(message.id, { state: "queued" })
      continue
    }
    const readFirst = next && (position.get(next.parentID) ?? -1) >= index
    if (readFirst && (before?.finish === "tool-calls" || before?.finish === "unknown"))
      result.set(message.id, { state: "mid-turn" })
  }
  if (earliestLater === undefined || input.paused) return result
  const wakesAt = earliestLater + LATER_WAKE_DELAY_MS
  for (const [messageID, delivery] of result)
    if (delivery.state === "inbox" && input.inbox(messageID) === "later") result.set(messageID, { ...delivery, wakesAt })
  return result
}

// The wake a Vibeterm delivery asked for, from the `[vibeterm_metadata]` block its text starts with: `wake: later` or
// `wake: never` from vibeterm_prompt_session, or the queued-note `delivery:` of vibeterm_notify_session and other
// notes. Anything else, a typed prompt, a wake=now delivery or a question answer, starts or continues a turn.
export function inboxWake(parts: readonly Part[]): InboxWake | undefined {
  const first = parts.find((part) => part.type === "text" && !part.synthetic)
  const fields = first?.type === "text" ? splitVibetermHead(first.text)?.fields.split("\n") : undefined
  if (!fields) return
  if (fields.includes("wake: later")) return "later"
  if (fields.includes("wake: never")) return "never"
  if (fields.some((field) => field.startsWith(`delivery: ${QUEUED_NOTE_DELIVERY}`))) return "never"
}

// The badge a delivery shows, or none once it was read.
export function deliveryBadge(delivery: PromptDelivery, time: (at: number) => string) {
  if (delivery.state === "mid-turn") return
  if (delivery.state === "inbox" && delivery.wakesAt !== undefined)
    return `${DeliveryLabel.inbox} - wakes ${time(delivery.wakesAt)}`
  return DeliveryLabel[delivery.state]
}
