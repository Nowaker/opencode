import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import type { Tool } from "@/tool/tool"
import { assertExternalDirectoryEffect } from "../../src/tool/external-directory"
import { Filesystem } from "@/util/filesystem"
import { TestInstance, tmpdirScoped } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

const glob = (p: string) =>
  process.platform === "win32" ? Filesystem.normalizePathPattern(p) : p.replaceAll("\\", "/")

function makeCtx() {
  const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
  const ctx: Tool.Context = {
    ...baseCtx,
    ask: (req) =>
      Effect.sync(() => {
        requests.push(req)
      }),
  }
  return { requests, ctx }
}

describe("tool.assertExternalDirectory", () => {
  it.live("no-ops for empty target", () =>
    Effect.gen(function* () {
      const { requests, ctx } = makeCtx()

      yield* assertExternalDirectoryEffect(ctx)

      expect(requests.length).toBe(0)
    }),
  )

  it.instance("no-ops for paths inside the instance directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { requests, ctx } = makeCtx()

      yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "file.txt"))

      expect(requests.length).toBe(0)
    }),
  )

  it.instance("asks with a single canonical glob", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { requests, ctx } = makeCtx()

      const target = path.join(path.dirname(test.directory), "outside", "file.txt")
      const expected = glob(path.join(path.dirname(target), "*"))

      yield* assertExternalDirectoryEffect(ctx, target)

      const req = requests.find((r) => r.permission === "external_directory")
      expect(req).toBeDefined()
      expect(req!.patterns).toEqual([expected])
      expect(req!.always).toEqual([expected])
    }),
  )

  it.instance("uses target directory when kind=directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { requests, ctx } = makeCtx()

      const target = path.join(path.dirname(test.directory), "outside")
      const expected = glob(path.join(target, "*"))

      yield* assertExternalDirectoryEffect(ctx, target, { kind: "directory" })

      const req = requests.find((r) => r.permission === "external_directory")
      expect(req).toBeDefined()
      expect(req!.patterns).toEqual([expected])
      expect(req!.always).toEqual([expected])
    }),
  )

  it.live("skips prompting when bypass=true", () =>
    Effect.gen(function* () {
      const { requests, ctx } = makeCtx()

      yield* assertExternalDirectoryEffect(ctx, "/tmp/outside/file.txt", { bypass: true })

      expect(requests.length).toBe(0)
    }),
  )

  if (process.platform !== "win32") {
    describe("symlinks", () => {
      const external = (requests: ReturnType<typeof makeCtx>["requests"]) =>
        requests.filter((r) => r.permission === "external_directory")

      it.instance("asks when an in-project file link points outside", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const outside = yield* tmpdirScoped()
          yield* Effect.promise(() => Bun.write(path.join(outside, "secret.txt"), "x"))
          const link = path.join(test.directory, "link.txt")
          yield* Effect.promise(() => fs.symlink(path.join(outside, "secret.txt"), link))
          const { requests, ctx } = makeCtx()

          yield* assertExternalDirectoryEffect(ctx, link)

          expect(external(requests).map((r) => r.patterns)).toEqual([[glob(path.join(outside, "*"))]])
          expect(external(requests)[0].metadata).toEqual({
            filepath: path.join(outside, "secret.txt"),
            parentDir: outside,
          })
        }),
      )

      it.instance("asks for files under an in-project directory link that points outside", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const outside = yield* tmpdirScoped()
          yield* Effect.promise(() => fs.mkdir(path.join(outside, "sub")))
          yield* Effect.promise(() => fs.symlink(path.join(outside, "sub"), path.join(test.directory, "linked")))
          const { requests, ctx } = makeCtx()

          yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "linked", "existing-or-not.txt"))
          yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "linked", "new", "deep.txt"))
          yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "linked"), { kind: "directory" })

          expect(external(requests).map((r) => r.patterns)).toEqual([
            [glob(path.join(outside, "sub", "*"))],
            [glob(path.join(outside, "sub", "new", "*"))],
            [glob(path.join(outside, "sub", "*"))],
          ])
        }),
      )

      it.instance("asks when a link points into another git repository", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const other = yield* tmpdirScoped({ git: true })
          yield* Effect.promise(() => Bun.write(path.join(other, "src", "target.txt"), "x"))
          yield* Effect.promise(() =>
            fs.symlink(path.relative(test.directory, path.join(other, "src")), path.join(test.directory, "other")),
          )
          const { requests, ctx } = makeCtx()

          yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "other", "target.txt"))

          expect(external(requests).map((r) => r.patterns)).toEqual([[glob(path.join(other, "src", "*"))]])
        }),
      )

      it.instance("asks for the target of a dangling link that points outside", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const outside = yield* tmpdirScoped()
          const link = path.join(test.directory, "dangling.txt")
          yield* Effect.promise(() => fs.symlink(path.join(outside, "missing", "created.txt"), link))
          const { requests, ctx } = makeCtx()

          yield* assertExternalDirectoryEffect(ctx, link)

          expect(external(requests).map((r) => r.patterns)).toEqual([[glob(path.join(outside, "missing", "*"))]])
        }),
      )

      it.instance("does not ask for links that stay inside the project", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => Bun.write(path.join(test.directory, "real", "file.txt"), "x"))
          yield* Effect.promise(() => fs.symlink("real", path.join(test.directory, "alias")))
          yield* Effect.promise(() => fs.symlink("real/file.txt", path.join(test.directory, "file-link.txt")))
          yield* Effect.promise(() => fs.symlink("real/missing.txt", path.join(test.directory, "dangling.txt")))
          const { requests, ctx } = makeCtx()

          yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "alias", "file.txt"))
          yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "file-link.txt"))
          yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "dangling.txt"))
          yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "alias", "new.txt"))

          expect(external(requests)).toEqual([])
        }),
      )

      it.instance("does not loop on cyclic links", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* Effect.promise(() => fs.symlink("b", path.join(test.directory, "a")))
          yield* Effect.promise(() => fs.symlink("a", path.join(test.directory, "b")))
          const { requests, ctx } = makeCtx()

          yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "a"))

          expect(external(requests)).toEqual([])
        }),
      )

      it.instance("keeps the written path for links outside the project", () =>
        Effect.gen(function* () {
          yield* TestInstance
          const outside = yield* tmpdirScoped()
          yield* Effect.promise(() => fs.mkdir(path.join(outside, "real")))
          yield* Effect.promise(() => fs.symlink(path.join(outside, "real"), path.join(outside, "alias")))
          const { requests, ctx } = makeCtx()

          yield* assertExternalDirectoryEffect(ctx, path.join(outside, "alias", "file.txt"))

          expect(external(requests).map((r) => r.patterns)).toEqual([[glob(path.join(outside, "alias", "*"))]])
        }),
      )
    })
  }

  if (process.platform === "win32") {
    it.instance(
      "normalizes Windows path variants to one glob",
      () =>
        Effect.gen(function* () {
          const { requests, ctx } = makeCtx()

          const outerTmp = yield* tmpdirScoped()
          yield* Effect.promise(() => Bun.write(path.join(outerTmp, "outside.txt"), "x"))

          const target = path.join(outerTmp, "outside.txt")
          const alt = target
            .replace(/^[A-Za-z]:/, "")
            .replaceAll("\\", "/")
            .toLowerCase()

          yield* assertExternalDirectoryEffect(ctx, alt)

          const req = requests.find((r) => r.permission === "external_directory")
          const expected = glob(path.join(outerTmp, "*"))
          expect(req).toBeDefined()
          expect(req!.patterns).toEqual([expected])
          expect(req!.always).toEqual([expected])
        }),
      { git: true },
    )

    it.instance(
      "uses drive root glob for root files",
      () =>
        Effect.gen(function* () {
          const { requests, ctx } = makeCtx()

          const tmp = yield* TestInstance
          const root = path.parse(tmp.directory).root
          const target = path.join(root, "boot.ini")

          yield* assertExternalDirectoryEffect(ctx, target)

          const req = requests.find((r) => r.permission === "external_directory")
          const expected = path.join(root, "*")
          expect(req).toBeDefined()
          expect(req!.patterns).toEqual([expected])
          expect(req!.always).toEqual([expected])
        }),
      { git: true },
    )
  }
})
