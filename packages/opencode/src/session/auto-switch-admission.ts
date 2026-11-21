import { Schema } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

const Receipt = Schema.Struct({ version: Schema.Literal(1), partIds: Schema.Array(Schema.String) })
const Stamp = Schema.Struct({ acceptedAt: Schema.Int.check(Schema.isGreaterThan(0)) })

export function acceptedAt(message: SessionV1.WithParts) {
  const text = message.parts.filter((part): part is SessionV1.TextPart => part.type === "text")
  const receipts = text.filter((part) => part.metadata?.vibetermInboxReceipt !== undefined)
  if (!receipts.length) {
    if (text.some((part) => part.metadata?.vibeterm?.provenance || part.text.includes("[vibeterm_metadata]"))) return undefined
    return message.info.time.created
  }
  const receipt = receipts.length === 1 ? receipts[0] : undefined
  if (!receipt?.ignored || !receipt.synthetic || receipt.text !== "") return undefined
  const parsed = Schema.decodeUnknownOption(Receipt)(receipt.metadata?.vibetermInboxReceipt)
  if (parsed._tag === "None") return undefined
  const stamped = text.find((part) => !part.ignored && !part.synthetic && parsed.value.partIds.includes(part.id))
  const stamp = Schema.decodeUnknownOption(Stamp)(stamped?.metadata?.vibeterm)
  if (stamp._tag === "None" || stamp.value.acceptedAt > message.info.time.created) return undefined
  return stamp.value.acceptedAt
}

export function stripWireStamp(metadata: Record<string, unknown>) {
  const { vibetermInboxReceipt: receipt, vibeterm, ...rest } = metadata
  if (!vibeterm || typeof vibeterm !== "object" || !Object.hasOwn(vibeterm, "acceptedAt")) {
    return { ...rest, ...(vibeterm !== undefined && { vibeterm }) }
  }
  const stripped = Object.fromEntries(Object.entries(vibeterm).filter(([key]) => key !== "acceptedAt"))
  return { ...rest, vibeterm: stripped }
}

export * as AutoSwitchAdmission from "./auto-switch-admission"
