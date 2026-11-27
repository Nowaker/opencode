import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { isRecord } from "@/util/record"

export function skippedSnapshot(part: SessionV1.Part) {
  if (part.type !== "tool") return false
  const engine: unknown = part.state.metadata?.engine
  return isRecord(engine) && engine.snapshot === "skipped"
}
