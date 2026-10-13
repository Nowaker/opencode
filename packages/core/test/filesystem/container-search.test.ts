import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../fixture/tmpdir"
import { withSearch } from "../fixture/search"
import { it } from "../lib/effect"

const temporary = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
)

describe("non-repository search", () => {
  it.live("finds existing files on the immediate first request", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "first.ts"), "needle\n"))
      const result = yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        return yield* search.find({ query: "first.ts", type: "file" })
      }).pipe(withSearch(tmp.path))
      expect(result.map((entry) => entry.path)).toContain(RelativePath.make("first.ts"))
    }),
  )

  for (const mutation of ["create", "rename", "delete"] as const) {
    it.live(`refreshes find when files ${mutation} after initialization`, () =>
      Effect.gen(function* () {
        const tmp = yield* temporary
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "old.ts"), "needle\n"))
        yield* Effect.gen(function* () {
          const search = yield* FileSystemSearch.Service
          yield* search.find({ query: "old.ts", type: "file" })
          yield* Effect.promise(async () => {
            switch (mutation) {
              case "create":
                return fs.writeFile(path.join(tmp.path, "new.ts"), "needle\n")
              case "rename":
                return fs.rename(path.join(tmp.path, "old.ts"), path.join(tmp.path, "new.ts"))
              case "delete":
                return fs.unlink(path.join(tmp.path, "old.ts"))
            }
          })
          const result = yield* search.find({ query: mutation === "delete" ? "old.ts" : "new.ts", type: "file" })
          expect(result.map((entry) => entry.path)).toEqual(mutation === "delete" ? [] : [RelativePath.make("new.ts")])
        }).pipe(withSearch(tmp.path))
      }),
    )
  }

  it.live("returns directory entries and limits when the tree changes", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* search.find({ query: "src" })
        yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src", "nested"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "nested", "fresh.ts"), "needle\n"))
        const result = yield* search.find({ query: "src", type: "directory", limit: 1 })
        expect(result).toHaveLength(1)
        expect(result[0]?.type).toBe("directory")
        expect(result[0]?.path.endsWith(path.sep)).toBe(true)
      }).pipe(withSearch(tmp.path))
    }),
  )

  it.live("reads current content and scoped paths when files change", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src")))
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "fresh.ts"), "old\n"))
      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* search.find({ query: "fresh.ts" })
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "fresh.ts"), "needle\n"))
        const result = yield* search.grep({ path: RelativePath.make("src/fresh.ts"), pattern: "needle", limit: 1 })
        expect(result[0]?.entry.path).toBe(RelativePath.make("src/fresh.ts"))
        expect(result[0]?.submatches[0]?.text).toBe("needle")
        const glob = yield* search.glob({ path: RelativePath.make("src"), pattern: "*.ts", limit: 1 })
        expect(glob.map((entry) => entry.path)).toEqual([RelativePath.make("src/fresh.ts")])
      }).pipe(withSearch(tmp.path))
    }),
  )

  it.live("lists files for an empty query with the default limit", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      yield* Effect.promise(() =>
        Promise.all(Array.from({ length: 60 }, (_, index) =>
          fs.writeFile(path.join(tmp.path, `entry-${index}.ts`), "needle\n"),
        )),
      )
      const result = yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        return yield* search.find({ query: "   ", type: "file" })
      }).pipe(withSearch(tmp.path))
      expect(result).toHaveLength(50)
      expect(result.every((entry) => entry.type === "file")).toBe(true)
    }),
  )

  it.live("respects nested ignore rules and excludes dotfiles from discovery", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      yield* Effect.promise(async () => {
        const child = path.join(tmp.path, "nested")
        const git = Bun.spawn(["git", "init", "--quiet", child], {
          env: { ...process.env, GIT_MASTER: "1" }, stdout: "ignore", stderr: "ignore",
        })
        if (await git.exited !== 0) throw new Error("synthetic git initialization failed")
        await fs.mkdir(path.join(child, "build"))
        await fs.mkdir(path.join(child, "node_modules"))
        await fs.writeFile(path.join(child, ".gitignore"), "build/\nnode_modules/\n")
        await fs.writeFile(path.join(child, "build", "ignored.ts"), "needle\n")
        await fs.writeFile(path.join(child, "node_modules", "ignored.ts"), "needle\n")
        await fs.writeFile(path.join(child, ".hidden.ts"), "needle\n")
        await fs.writeFile(path.join(child, "visible.ts"), "needle\n")
      })
      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        const found = yield* search.find({ query: ".ts", type: "file" })
        expect(found.map((entry) => entry.path)).toEqual([RelativePath.make("nested/visible.ts")])
        const glob = yield* search.glob({ pattern: "**/*.ts" })
        expect(glob.map((entry) => entry.path).sort()).toEqual([
          RelativePath.make("nested/.hidden.ts"),
          RelativePath.make("nested/visible.ts"),
        ])
        const grep = yield* search.grep({ pattern: "needle", include: "*.ts" })
        expect(grep.map((match) => match.entry.path).sort()).toEqual([
          RelativePath.make("nested/.hidden.ts"),
          RelativePath.make("nested/visible.ts"),
        ])
      }).pipe(withSearch(tmp.path))
    }),
  )
})
