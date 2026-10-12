import { Schema } from "effect"
import { optional } from "./schema"
export * as MachineProvenance from "./machine-provenance"

const Host = {
  machineId: Schema.String,
  machine: Schema.NullOr(Schema.String),
  hostname: Schema.NullOr(Schema.String),
  platform: Schema.String,
  at: Schema.Finite,
}

export const Creator = Schema.Struct({
  ...Host,
  objectId: Schema.String,
  originalObjectId: optional(Schema.String),
  source: Schema.Literal("stamped"),
}).annotate({
  identifier: "Vibeterm.Creator",
  description: "Immutable creation host; copies retain the original host and creation time.",
})
export interface Creator extends Schema.Schema.Type<typeof Creator> {}

export const Message = Schema.Struct({ creator: optional(Creator) })

export const LastExecution = Schema.Struct({
  ...Host,
  sessionId: Schema.String,
  executionId: Schema.String,
}).annotate({
  identifier: "Vibeterm.LastExecution",
  description: "Latest actual runner admission, ordered by at, executionId, machineId. Not message creation or import.",
})
export interface LastExecution extends Schema.Schema.Type<typeof LastExecution> {}

export function latest(sessionId: string, ...values: readonly unknown[]) {
  const decode = Schema.decodeUnknownOption(LastExecution)
  return values
    .flatMap((value) => {
      const result = decode(value)
      return result._tag === "Some" && result.value.sessionId === sessionId ? [result.value] : []
    })
    .sort((left, right) =>
      left.at - right.at || compare(left.executionId, right.executionId) || compare(left.machineId, right.machineId),
    )
    .at(-1)
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

const Note = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
})

export function mergeMetadata(
  sessionId: string,
  incoming: Record<string, unknown> | undefined,
  current?: Record<string, unknown>,
) {
  const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : {}
  const next = record(incoming?.vibeterm)
  const previous = record(current?.vibeterm)
  const lastExecution = latest(sessionId, next.lastExecution, previous.lastExecution)
  const notes = new Map<string, Record<string, unknown> & typeof Note.Type>()
  const decodeNote = Schema.decodeUnknownOption(Note)
  for (const value of [previous.notes, next.notes]) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      const decoded = decodeNote(item)
      if (decoded._tag !== "Some") continue
      const note = { ...record(item), ...decoded.value }
      const seen = notes.get(note.id)
      if (!seen || note.updatedAt > seen.updatedAt) notes.set(note.id, note)
    }
  }
  const { lastExecution: ignored, ...rest } = { ...next, ...previous }
  // Vibeterm writes only the `vibeterm` key straight to the row, so only that
  // key is merged; every other key is the engine's and follows the event, as
  // upstream, or a metadata update could never change or remove one.
  if (!incoming?.vibeterm && !current?.vibeterm) return incoming
  return {
    ...incoming,
    vibeterm: {
      ...rest,
      ...(notes.size ? { notes: [...notes.values()].sort((left, right) => left.createdAt - right.createdAt || compare(left.id, right.id)) } : {}),
      ...(lastExecution ? { lastExecution } : {}),
    },
  }
}
