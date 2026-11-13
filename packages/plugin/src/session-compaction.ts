import type { Model } from "@opencode/schema/model"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"

/** The source snapshot selected before hooks or request shrinking. Experimental. */
export interface SessionCompactionDetails {
  /** Attempt identity; speculative attempts need not become durable messages. */
  readonly generationID: SessionMessage.ID
  /** Absent while a speculative summary has not been adopted. */
  readonly messageID?: SessionMessage.ID
  readonly reason: "manual" | "auto" | "overflow"
  /** Inclusive last source message, excluding the running compaction marker. */
  readonly boundaryID: SessionMessage.ID
  readonly keepID?: SessionMessage.ID
  readonly replacedMessageIDs: ReadonlyArray<SessionMessage.ID>
  readonly retainedMessages: ReadonlyArray<{
    readonly id: SessionMessage.ID
    /** Exact text serialized into the retained recent context. */
    readonly text: string
    readonly role?: "user" | "assistant"
    /** Present only for an unabridged real user message. */
    readonly rawText?: string
  }>
  readonly conversationModel: Model.Ref
  readonly native: boolean
}

/** Awaited once before a textual summary is published. Experimental. */
export interface SessionCompactionSummary extends Omit<SessionCompactionDetails, "messageID" | "native"> {
  readonly sessionID: Session.ID
  readonly messageID: SessionMessage.ID
  /** The model that generated this candidate, including an adopted background candidate. */
  readonly model: Model.Ref
  text: string
  metadata: Record<string, unknown>
}
