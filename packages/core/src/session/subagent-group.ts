export * as SubagentGroup from "./subagent-group.js"

import { and, eq, gte, like, lt } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"

export const Group = Schema.Struct({ id: Schema.String, index: Schema.Int, total: Schema.Int })
export const Notice = Schema.Union([Schema.Literals(["each", "none"]), Schema.Struct({ group: Group })])
export type Notice = typeof Notice.Type

export const Slot = Schema.Struct({
  index: Schema.Int,
  generation: SessionMessage.ID,
  description: Schema.String,
  agent: Schema.String,
  childSessionID: Schema.optionalKey(SessionSchema.ID),
  status: Schema.Literals(["running", "completed", "error", "cancelled"]),
  output: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
})
export type Slot = typeof Slot.Type
const State = Schema.Struct({
  parentSessionID: SessionSchema.ID,
  id: Schema.String,
  total: Schema.Int,
  notificationID: SessionMessage.ID,
  delivered: Schema.Boolean,
  slots: Schema.Array(Slot),
})
export type State = typeof State.Type
export type Token = {
  readonly parentSessionID: SessionSchema.ID
  readonly id: string
  readonly notificationID: SessionMessage.ID
  readonly index: number
  readonly generation: SessionMessage.ID
}
export class Conflict extends Schema.TaggedError<Conflict>()("SubagentGroup.Conflict", {
  message: Schema.String,
}) {}

type DB = Database.Interface["db"]
const prefix = "opencode/subagent-group/"
const key = (parent: SessionSchema.ID, id: string) => `${prefix}${encodeURIComponent(parent)}/${encodeURIComponent(id)}`
const decode = Schema.decodeUnknownSync(State)
const encode = Schema.encodeSync(Schema.toCodecJson(State))

const read = (db: DB, parent: SessionSchema.ID, id: string) =>
  db
    .select()
    .from(KVTable)
    .where(eq(KVTable.key, key(parent, id)))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => (row ? decode(row.value) : undefined)),
    )
const write = (db: DB, state: State) =>
  db
    .insert(KVTable)
    .values({ key: key(state.parentSessionID, state.id), value: encode(state) })
    .onConflictDoUpdate({
      target: KVTable.key,
      set: { value: encode(state) },
    })
    .run()
    .pipe(Effect.orDie)

export const register = Effect.fn("SubagentGroup.register")(function* (
  db: DB,
  input: {
    readonly parentSessionID: SessionSchema.ID
    readonly group: typeof Group.Type
    readonly description: string
    readonly agent: string
  },
) {
  const group = input.group
  if (group.id.length === 0 || group.total < 1 || group.index < 0 || group.index >= group.total)
    return yield* new Conflict({ message: "Subagent group requires an id, positive total, and 0 <= index < total" })
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const current = yield* read(db, input.parentSessionID, group.id)
          if (
            current &&
            (current.total !== group.total ||
              current.delivered ||
              current.slots.some((slot) => slot.index === group.index))
          )
            return yield* new Conflict({
              message: `Subagent group ${group.id} has a conflicting total or an already invoked slot ${group.index}`,
            })
          const state: State = current ?? {
            parentSessionID: input.parentSessionID,
            id: group.id,
            total: group.total,
            notificationID: SessionMessage.ID.create(),
            delivered: false,
            slots: [],
          }
          const slot: Slot = {
            index: group.index,
            generation: SessionMessage.ID.create(),
            description: input.description,
            agent: input.agent,
            status: "running",
          }
          yield* write(db, { ...state, slots: [...state.slots, slot] })
          return {
            parentSessionID: input.parentSessionID,
            id: group.id,
            notificationID: state.notificationID,
            index: group.index,
            generation: slot.generation,
          } satisfies Token
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})

export const update = Effect.fn("SubagentGroup.update")(function* (
  db: DB,
  token: Token,
  change: Pick<Slot, "status"> & Partial<Pick<Slot, "childSessionID" | "output" | "error">>,
) {
  yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const state = yield* read(db, token.parentSessionID, token.id)
          if (!state || state.notificationID !== token.notificationID || state.delivered) return
          yield* write(db, {
            ...state,
            slots: state.slots.map((slot) =>
              slot.index === token.index && slot.generation === token.generation && slot.status === "running"
                ? { ...slot, ...change }
                : slot,
            ),
          })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
})

export const pending = (db: DB) =>
  db
    .select()
    .from(KVTable)
    .where(like(KVTable.key, `${prefix}%`))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.map((row) => decode(row.value)).filter((state) => !state.delivered)),
    )
export const owners = (db: DB, childSessionID: SessionSchema.ID) =>
  pending(db).pipe(
    Effect.map((groups) =>
      groups.flatMap((group) =>
        group.slots.filter((slot) => slot.status === "running" && slot.childSessionID === childSessionID),
      ),
    ),
  )

export const claimChild = Effect.fn("SubagentGroup.claimChild")(function* (
  db: DB,
  token: Token,
  childSessionID: SessionSchema.ID,
) {
  yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const state = yield* read(db, token.parentSessionID, token.id)
          const slot = state?.slots.find((slot) => slot.index === token.index && slot.generation === token.generation)
          if (!state || state.notificationID !== token.notificationID || state.delivered || slot?.status !== "running")
            return yield* new Conflict({ message: "Subagent group slot is no longer pending" })
          const occupied = (yield* owners(db, childSessionID)).some((slot) => slot.generation !== token.generation)
          if (occupied)
            return yield* new Conflict({ message: `Subagent ${childSessionID} is already owned by a group slot` })
          yield* write(db, {
            ...state,
            slots: state.slots.map((slot) =>
              slot.generation === token.generation ? { ...slot, childSessionID } : slot,
            ),
          })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})

export const ready = (state: State) =>
  state.slots.length === state.total && state.slots.every((slot) => slot.status !== "running")
export const get = read
export const acknowledge = Effect.fn("SubagentGroup.acknowledge")(function* (db: DB, state: State) {
  yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const current = yield* read(db, state.parentSessionID, state.id)
          if (current?.notificationID === state.notificationID) yield* write(db, { ...current, delivered: true })
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
})
export const remove = (db: DB, parent: SessionSchema.ID) =>
  db
    .delete(KVTable)
    .where(
      and(
        gte(KVTable.key, `${prefix}${encodeURIComponent(parent)}/`),
        lt(KVTable.key, `${prefix}${encodeURIComponent(parent)}/\uffff`),
      ),
    )
    .run()
    .pipe(Effect.orDie, Effect.asVoid)
