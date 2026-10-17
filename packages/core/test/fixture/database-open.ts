import { Effect } from "effect"
import { Database } from "../../src/database/database"

// Opens the real Database layer once stdin closes, so a parent can release many
// already-loaded processes onto one fresh file at the same moment. The optional
// mode makes this child misbehave on purpose, so the parent's cleanup of its
// children can be tested: exit before signalling readiness, or never finish.
const filename = process.argv[2]
const mode = process.argv[3] ?? "open"
if (!filename) throw new Error("database argument required")
if (mode === "exit-before-ready") process.exit(3)
process.stdout.write("ready\n")
await Bun.stdin.text()
if (mode === "stall") await new Promise(() => setInterval(() => {}, 1000))
await Effect.runPromise(
  Effect.gen(function* () {
    yield* Database.Service
  }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped),
)
