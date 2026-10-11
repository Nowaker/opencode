import os from "node:os"
import type { Creator, LastExecution } from "@opencode-ai/schema/machine-provenance"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
export * as MachineProvenance from "./machine-provenance"

function host() {
  const machineId = process.env.VIBETERM_MACHINE_ID
  if (!machineId) return
  return {
    machineId,
    machine: process.env.VIBETERM_MACHINE_NAME || null,
    hostname: os.hostname() || null,
    platform: os.platform(),
  }
}

export function create<T extends SessionV1.Info>(message: T): T {
  const identity = host()
  if (!identity || message.vibeterm?.creator) return message
  const creator: Creator = { ...identity, objectId: message.id, at: message.time.created, source: "stamped" }
  Object.assign(message, { vibeterm: { ...message.vibeterm, creator } })
  return message
}

export function copy<T extends SessionV1.Info>(message: T, objectId: string) {
  const creator = message.vibeterm?.creator
  if (!creator) return message.vibeterm
  return {
    ...message.vibeterm,
    creator: { ...creator, objectId, originalObjectId: creator.originalObjectId ?? creator.objectId },
  }
}

export function execution(sessionId: string): LastExecution | undefined {
  const identity = host()
  if (!identity) return
  return { ...identity, sessionId, at: Date.now(), executionId: crypto.randomUUID() }
}
