import { Effect } from "effect"
import { FileSystemSearch } from "../src/filesystem/search"
import { AbsolutePath } from "../src/schema"
import { searchLayer } from "../test/fixture/search"
import fs from "fs/promises"
import path from "path"
import assert from "node:assert/strict"
import { RelativePath } from "../src/schema"

const directory = process.argv[2]
const mode = process.argv[3]
if (!directory || !["baseline", "candidate", "repository"].includes(mode ?? "")) process.exit(2)
const vcs = mode === "repository" ? { type: "git" as const, store: AbsolutePath.make(directory + "/.git") } : undefined
await Effect.runPromise(Effect.gen(function* () {
  const search = yield* FileSystemSearch.Service
  yield* search.find({ query: "entry.ts", limit: 10 })
  yield* Effect.sleep("1 second")
  const entries = yield* search.find({ query: "entry.ts", type: "file", limit: 10 })
  if (entries.length !== 10) throw new Error(`synthetic file search failed: ${mode}, count=${entries.length}`)
  const hidden = yield* search.find({ query: "hidden-probe", type: "file" })
  const empty = yield* search.find({ query: "", type: "file", limit: 10 })
  if (mode === "candidate") {
    assert.equal(empty.length, 10)
    yield* Effect.promise(() => fs.mkdir(path.join(directory, "qa-probe")))
    yield* Effect.promise(() => fs.writeFile(path.join(directory, "qa-probe", "created.ts"), "before\n"))
    assert.deepEqual((yield* search.find({ query: "qa-probe/created.ts", type: "file" })).map((entry) => entry.path), ["qa-probe/created.ts"])
    yield* Effect.promise(() => fs.rename(path.join(directory, "qa-probe", "created.ts"), path.join(directory, "qa-probe", "renamed.ts")))
    assert.equal((yield* search.find({ query: "created.ts", type: "file" })).length, 0)
    assert.deepEqual((yield* search.glob({ path: RelativePath.make("qa-probe"), pattern: "*.ts" })).map((entry) => entry.path), ["qa-probe/renamed.ts"])
    yield* Effect.promise(() => fs.writeFile(path.join(directory, "qa-probe", "renamed.ts"), "after\n"))
    assert.equal((yield* search.grep({ path: RelativePath.make("qa-probe/renamed.ts"), pattern: "after" }))[0]?.submatches[0]?.text, "after")
    assert.equal((yield* search.find({ query: "qa-probe", type: "directory", limit: 1 }))[0]?.type, "directory")
    yield* Effect.promise(() => fs.rm(path.join(directory, "qa-probe"), { recursive: true }))
    assert.equal((yield* search.find({ query: "renamed.ts", type: "file" })).length, 0)
    assert.equal((yield* search.glob({ pattern: "**/renamed.ts" })).length, 0)
  }
  console.log(JSON.stringify({ ready: true, entries: entries.length, hidden: hidden.length, empty: empty.length }))
  yield* Effect.sleep("30 seconds")
}).pipe(Effect.provide(searchLayer(directory, vcs, mode === "baseline" ? "watched" : "default"))))
