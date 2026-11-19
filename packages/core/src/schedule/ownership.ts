export * as ScheduleOwnership from "./ownership.js"

import { randomUUID } from "node:crypto"
import { and, asc, eq, sql } from "drizzle-orm"
import { Clock, Effect } from "effect"
import type { Database } from "../database/database.js"
import type { EngineStop } from "../engine-stop.js"
import { KVTable } from "../kv/sql.js"
import { ScheduleTable } from "./sql.js"

const key = "schedule:leader"

export const make = Effect.fn("ScheduleOwnership.make")(function* (
  db: Database.Interface["db"],
  claims: EngineStop.Interface,
  ttl: number,
) {
  const ownerID = randomUUID()
  const claim = Effect.fn("ScheduleOwnership.claim")(function* (now: number) {
    const value = { owner: ownerID, until: now + ttl }
    const claimed = yield* db.insert(KVTable)
      .values({ key, value, time_created: now, time_updated: now })
      .onConflictDoUpdate({
        target: KVTable.key,
        set: { value, time_updated: now },
        where: sql`json_extract(${KVTable.value}, '$.owner') = ${ownerID} or json_extract(${KVTable.value}, '$.until') <= ${now}`,
      })
      .returning({ key: KVTable.key }).get().pipe(Effect.orDie)
    return claimed !== undefined
  }, claims.within)

  yield* claims.registerSchedulerProbe(Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const lease = yield* db.select({ key: KVTable.key }).from(KVTable).where(and(
      eq(KVTable.key, key),
      sql`json_extract(${KVTable.value}, '$.owner') = ${ownerID}`,
      sql`json_extract(${KVTable.value}, '$.until') > ${now}`,
    )).get().pipe(Effect.orDie)
    if (!lease) return []
    const rows = yield* db.select({ id: ScheduleTable.id }).from(ScheduleTable)
      .where(eq(ScheduleTable.status, "active")).orderBy(asc(ScheduleTable.id)).all().pipe(Effect.orDie)
    return rows.map((row) => row.id)
  })).pipe(Effect.orDie)

  return {
    claim,
    release: db.delete(KVTable).where(and(
      eq(KVTable.key, key), sql`json_extract(${KVTable.value}, '$.owner') = ${ownerID}`,
    )).run().pipe(Effect.ignore),
  }
})
