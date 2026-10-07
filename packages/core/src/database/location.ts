export * as DatabaseLocation from "./location"

import { isAbsolute, join } from "path"

// Where the database file lives for a data directory, an OPENCODE_DB value and
// a release channel. Kept apart from database.ts so callers that only need the
// path, like the instant startup prompt's cache, do not load SQLite.
export function resolve(input: { data: string; db?: string; channel: string; disableChannelDb?: string }) {
  if (input.db) {
    if (input.db === ":memory:" || isAbsolute(input.db)) return input.db
    return join(input.data, input.db)
  }
  if (
    ["latest", "beta", "prod"].includes(input.channel) ||
    input.disableChannelDb === "1" ||
    input.disableChannelDb === "true"
  )
    return join(input.data, "opencode.db")
  return join(input.data, `opencode-${input.channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}
