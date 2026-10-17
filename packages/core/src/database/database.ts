export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer, Schedule } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { DatabaseMigration } from "./migration"
import { DatabaseLocation } from "./location"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"
import { SessionMaintenance } from "./session-maintenance"
import { SqliteFailure } from "./sqlite-error"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    // Switching a fresh file to WAL reads its header, then upgrades to a write
    // lock. SQLite skips the busy handler on that upgrade to avoid deadlock, so
    // when several processes open one new file at once each loser fails with
    // SQLITE_BUSY at once. Its next attempt holds no read lock, so it waits behind
    // the converter through the busy timeout and then finds the file in WAL.
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA journal_mode = WAL").pipe(
      Effect.retry({
        while: (error) => SqliteFailure.parse(SqliteFailure.unwrap(error))?.retryAcquisition === true,
        schedule: Schedule.spaced("10 millis"),
        times: 20,
      }),
    )
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)
    yield* SessionMaintenance.install(db)

    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  // WAL is enabled by the layer above once the busy timeout is set.
  return layer.pipe(Layer.provide(sqliteLayer({ filename, disableWAL: true })))
}

export function path() {
  return DatabaseLocation.resolve({
    data: Global.Path.data,
    db: Flag.OPENCODE_DB,
    channel: InstallationChannel,
    disableChannelDb: process.env.OPENCODE_DISABLE_CHANNEL_DB,
  })
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
