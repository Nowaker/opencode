import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { databasePath } from "../src/database-path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import path from "node:path"

const original = process.env.OPENCODE_DB
afterEach(() => {
  if (original === undefined) delete process.env.OPENCODE_DB
  else process.env.OPENCODE_DB = original
})

test.each([undefined, "", "opencode.db", "./opencode.db"])(
  "refuses the implicit v1 database with OPENCODE_DB=%s",
  async (value) => {
    await using tmp = await tmpdir()
    if (value === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = value

    await expect(Effect.runPromise(databasePath(tmp.path))).rejects.toThrow("OPENCODE_DB")

    expect(await Bun.file(path.join(tmp.path, "opencode.db")).exists()).toBe(false)
  },
)

test.each([":memory:", "opencode-v2.db"])("resolves explicit v2 database %s", async (value) => {
  await using tmp = await tmpdir()
  process.env.OPENCODE_DB = value

  expect(await Effect.runPromise(databasePath(tmp.path))).toBe(
    value === ":memory:" ? value : path.join(tmp.path, value),
  )
})
