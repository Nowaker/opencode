export * as SessionRouteSwitchState from "./route-switch-state.js"

import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { isSqlError } from "effect/sql/SqlError"
import { RouteSwitch } from "@opencode/schema/route-switch"
import { Event } from "@opencode/schema/event"
import { SessionMessage } from "./message.js"
import type { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import type { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"

type DB = Database.Interface["db"]
const key = (sessionID: SessionSchema.ID) => `opencode/session-route-switch/${sessionID}`
const Attempt = Schema.Struct({
  kind: Schema.Literals(["alternate", "return"]),
  owner: Event.ID,
  inputID: SessionMessage.ID,
  step: Schema.Int,
  source: RouteSwitch.Route,
  target: RouteSwitch.Route,
  sourceAttemptID: Schema.optional(SessionMessage.ID),
  targetAttemptID: SessionMessage.ID,
  at: Schema.Finite,
  outcome: Schema.Literals(["claimed", "succeeded", "failed", "unknown"]),
})
export type Attempt = typeof Attempt.Type

const State = Schema.Struct({
  revision: Schema.Int,
  preference: RouteSwitch.Preference,
  returnPreference: RouteSwitch.Preference,
  reason: Schema.optional(RouteSwitch.Reason),
  manualReturn: Schema.Boolean,
  owner: Schema.optional(Event.ID),
  preferred: Schema.optional(RouteSwitch.Route),
  quotaStop: Schema.optional(
    Schema.Struct({
      route: RouteSwitch.Route,
      reason: Schema.Literals(["quota_exhausted", "reserve_held"]),
      assistantID: SessionMessage.ID,
      step: Schema.Int,
    }),
  ),
  manualRetry: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      epoch: Schema.String,
      revision: Schema.Int,
      inputRevision: Schema.NullOr(Schema.Struct({ seq: Schema.Int, eventID: Event.ID })),
      state: Schema.Literals(["requested", "claimed"]),
    }),
  ),
  sticky: Schema.optional(
    Schema.Struct({
      preferred: RouteSwitch.Route,
      effective: RouteSwitch.Route,
      since: Schema.Finite,
    }),
  ),
  turn: Schema.optional(
    Schema.Struct({
      id: SessionMessage.ID,
      inputID: SessionMessage.ID,
      owner: Event.ID,
      afterSettlement: Schema.Boolean,
      alternate: Schema.optional(Attempt),
      returned: Schema.optional(Attempt),
    }),
  ),
  settledThrough: Schema.optional(Schema.Int),
  recoveryBlockedThrough: Schema.optional(Schema.Int),
  cooldownUntil: Schema.optional(Schema.Finite),
  awaitCleanTurn: Schema.optional(Schema.Boolean),
  lastAlternate: Schema.optional(Attempt),
  lastReturn: Schema.optional(Attempt),
})
export type State = typeof State.Type
const decode = Schema.decodeUnknownSync(State)
const json = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))

const defaults = (child: boolean): State => ({
  revision: 0,
  preference: child ? "off" : "inherit",
  returnPreference: child ? "off" : "inherit",
  manualReturn: false,
})

export const read = (db: DB, sessionID: SessionSchema.ID, child: boolean) =>
  db
    .select()
    .from(KVTable)
    .where(eq(KVTable.key, key(sessionID)))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => (row ? decode(row.value) : defaults(child))),
    )

export const write = (db: DB, sessionID: SessionSchema.ID, state: State) => {
  const value = json(JSON.stringify(State.make(state)))
  return db
    .insert(KVTable)
    .values({ key: key(sessionID), value })
    .onConflictDoUpdate({ target: KVTable.key, set: { value } })
    .run()
    .pipe(Effect.orDie, Effect.asVoid)
}

export const snapshotChild = (db: DB, parentID: SessionSchema.ID, childID: SessionSchema.ID, parentIsChild: boolean) =>
  Effect.gen(function* () {
    const parent = yield* read(db, parentID, parentIsChild)
    yield* write(db, childID, {
      ...defaults(true),
      preference: parent.preference,
      returnPreference: parent.returnPreference,
    })
  })

export const stampOwner = (db: DB, sessionID: SessionSchema.ID, owner: Event.ID, child: boolean) =>
  read(db, sessionID, child).pipe(Effect.flatMap((state) => write(db, sessionID, { ...state, owner })))

export const operatorSelected = (db: DB, sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const row = yield* db
      .select()
      .from(KVTable)
      .where(eq(KVTable.key, key(sessionID)))
      .get()
      .pipe(Effect.orDie)
    const session = row
      ? undefined
      : yield* db
          .select({ parent: SessionTable.parent_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
    if (!row && !session) return
    const state = row ? decode(row.value) : defaults(session?.parent != null)
    yield* write(db, sessionID, {
      ...state,
      revision: state.revision + 1,
      preferred: undefined,
      sticky: undefined,
      manualReturn: false,
      quotaStop: undefined,
      reason: undefined,
    })
  })

export const remove = (db: DB, sessionID: SessionSchema.ID) =>
  db
    .delete(KVTable)
    .where(eq(KVTable.key, key(sessionID)))
    .run()
    .pipe(Effect.orDie, Effect.asVoid)

export const transaction = <A, E, R>(db: DB, effect: Effect.Effect<A, E, R>) =>
  db.transaction(() => effect, { behavior: "immediate" }).pipe(Effect.catchIf(isSqlError, Effect.die))
