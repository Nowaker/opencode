import path from "node:path"
import { Effect } from "effect"
import { DatabaseGuard } from "@opencode/core/database/guard"

export const databasePath = Effect.fn("cli.databasePath")(function* (data: string) {
  const configured = process.env.OPENCODE_DB
  if (!configured)
    return yield* Effect.die(
      new DatabaseGuard.Refused(path.resolve(data, "opencode.db"), "OPENCODE_DB is unset or empty."),
    )
  const filename = configured === ":memory:" ? configured : path.resolve(data, configured)
  yield* DatabaseGuard.checkFile(filename, data)
  return filename
})
