import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { createInterface } from "node:readline"
import { SessionMaintenance } from "../../src/database/session-maintenance"
import { connection } from "./maintenance-startup"

const filename = process.argv[2]
const mode = process.argv[3]
if (!filename || !mode) throw new Error("database and mode arguments required")
const input = createInterface({ input: process.stdin })
const commands = input[Symbol.asyncIterator]()
async function wait(command: string) {
  const next = await commands.next()
  if (next.done || next.value !== command) throw new Error(`expected ${command} handshake`)
}

try {
  if (mode === "fence") {
    using db = new Database(filename)
    db.exec("PRAGMA busy_timeout=0")
    process.stdout.write("ready\n")
    for (;;) {
      await wait("attempt")
      try {
        db.exec("INSERT INTO session_maintenance_fence VALUES('owner','active','replacement')")
        process.stdout.write("fenced\n")
        break
      } catch (error) {
        if (!(error instanceof Error) || !/locked/.test(error.message)) throw error
        process.stdout.write("blocked\n")
      }
    }
  } else if (mode === "schema") {
    const statement = process.argv[4]
    if (!statement) throw new Error("schema SQL argument required")
    using db = new Database(filename)
    db.exec("PRAGMA busy_timeout=10000")
    process.stdout.write("ready\n")
    await wait("change")
    db.exec(statement)
    process.stdout.write("changed\n")
  } else if (mode === "installer") {
    const state = { firstRead: true, repair: true }
    await Effect.runPromise(Effect.gen(function* () {
      const db = yield* connection(filename, async (query, phase) => {
        if (process.argv[4] === "repair" && phase === "after" && /^DROP TRIGGER/i.test(query.trim()) && state.repair) {
          state.repair = false
          process.stdout.write("repairing\n")
          await wait("repair")
        }
        if (phase !== "after" || !/^commit$/i.test(query.trim()) || !state.firstRead) return
        state.firstRead = false
        process.stdout.write("read\n")
        await wait("continue")
      })
      yield* SessionMaintenance.install(db)
      process.stdout.write("installed\n")
      yield* Effect.promise(() => wait("close"))
    }).pipe(Effect.scoped))
  } else {
    throw new Error("unknown fixture mode")
  }
} finally {
  input.close()
}
