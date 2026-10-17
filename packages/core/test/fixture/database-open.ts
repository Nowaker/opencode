import { Effect } from "effect"
import { Database } from "../../src/database/database"

// Opens the real Database layer once stdin closes, so a parent can release many
// already-loaded processes onto one fresh file at the same moment.
const filename = process.argv[2]
if (!filename) throw new Error("database argument required")
process.stdout.write("ready\n")
await Bun.stdin.text()
await Effect.runPromise(
  Effect.gen(function* () {
    yield* Database.Service
  }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped),
)
