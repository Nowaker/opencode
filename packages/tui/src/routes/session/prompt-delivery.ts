import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2"

export type PromptDelivery = "queued" | "mid-turn"

/*
 * Where each user message stands with the turn it arrived during, keyed by message ID.
 *
 * A step reads every user message up to the one its assistant message answers, so a message is read once any later
 * assistant message answers it or a newer user message. Until then it is "queued" while a turn runs that it waits
 * behind: one whose step was still streaming when it arrived, or one that kept stepping without it (the server's
 * `queued_prompts: "turn_end"`). It is "mid-turn" when the first step after it read it and the step before it had
 * ended on tool calls, so the turn took it in without ending first.
 */
export function promptDeliveries(messages: readonly Message[], busy: boolean) {
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
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === "assistant") {
      reader = Math.max(reader, position.get(message.parentID) ?? -1)
      next = message
      continue
    }
    const before = previous[index]
    if (reader < index) {
      if (busy && (next || (before && !before.time.completed))) result.set(message.id, "queued")
      continue
    }
    const readFirst = next && (position.get(next.parentID) ?? -1) >= index
    if (readFirst && (before?.finish === "tool-calls" || before?.finish === "unknown")) result.set(message.id, "mid-turn")
  }
  return result
}
