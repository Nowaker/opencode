import type { Schema } from "effect"
import type { Session } from "@opencode/schema/session"

export function mergeMetadata(current: Session.Metadata | undefined, patch: Session.Metadata): Session.Metadata {
  const result = new Map(Object.entries(current ?? {}))
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      result.delete(key)
      continue
    }
    const previous = result.get(key)
    result.set(key, isRecord(value) ? mergeMetadata(isRecord(previous) ? previous : undefined, value) : value)
  }
  return Object.fromEntries(result)
}

function isRecord(value: Schema.Json | undefined): value is Session.Metadata {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
