import type { SessionCompactionDetails } from "@opencode/plugin/effect/session"
import { SessionMessage } from "./message.js"
import { SessionRecentText } from "./recent-text.js"

export function compactionTail(messages: ReadonlyArray<SessionMessage.Info>, keepID: SessionMessage.ID | undefined) {
  const start = keepID === undefined ? -1 : messages.findIndex((message) => message.id === keepID)
  return (start < 0 ? [] : messages.slice(start)).flatMap((message): SessionCompactionDetails["retainedMessages"] => {
    const text = SessionRecentText.messageToText(message)
    if (!text) return []
    return [
      {
        id: message.id,
        text,
        ...(message.type === "user" ? { role: "user" as const, rawText: message.text } : {}),
        ...(message.type === "assistant" ? { role: "assistant" as const } : {}),
      },
    ]
  })
}

export function compactionDetails(input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly retained: ReadonlyArray<SessionMessage.Info>
  readonly keepID?: SessionMessage.ID
  readonly messageID?: SessionMessage.ID
  readonly reason: SessionCompactionDetails["reason"]
  readonly conversationModel: SessionCompactionDetails["conversationModel"]
  readonly native: boolean
}): SessionCompactionDetails | undefined {
  const messages = input.messages.filter((message) => message.type !== "compaction" || message.status !== "running")
  const boundary = messages.at(-1)
  if (!boundary) return undefined
  const retainedMessages = compactionTail(input.retained, input.keepID)
  const kept = new Set(retainedMessages.map((message) => message.id))
  return {
    generationID: SessionMessage.ID.create(),
    messageID: input.messageID,
    reason: input.reason,
    boundaryID: boundary.id,
    keepID: input.keepID,
    replacedMessageIDs: messages.filter((message) => !kept.has(message.id)).map((message) => message.id),
    retainedMessages,
    conversationModel: input.conversationModel,
    native: input.native,
  }
}
