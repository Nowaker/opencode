import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import path from "path"
import fs from "fs/promises"
import { WriteTool } from "../../src/tool/write"
import { FileFacts } from "../../src/tool/file-facts"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Format } from "../../src/format"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-write-session"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      LSP.node,
      FSUtil.node,
      EventV2Bridge.node,
      Format.node,
      CrossSpawnSpawner.node,
      Truncate.node,
      Agent.node,
    ]),
  ),
)

const init = Effect.fn("WriteToolTest.init")(function* () {
  const info = yield* WriteTool
  return yield* info.init()
})

const run = Effect.fn("WriteToolTest.run")(function* (
  args: Tool.InferParameters<typeof WriteTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

describe("tool.write", () => {
  for (const existing of [false, true]) {
    it.instance(`bounds the permission diff for a 20 MiB ${existing ? "overwrite" : "creation"}`, () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "large.txt")
        const content = ("x".repeat(65535) + "\n").repeat(320)
        const previews: unknown[] = []
        if (existing) yield* Effect.promise(() => fs.writeFile(filepath, "old\n"))

        const result = yield* run(
          { filePath: filepath, content },
          {
            ...ctx,
            ask: (input) =>
              Effect.sync(() => {
                previews.push(input.metadata.diff)
              }),
          },
        )

        expect(previews).toHaveLength(1)
        const diff = previews[0]
        expect(typeof diff).toBe("string")
        if (typeof diff !== "string") throw new Error("missing permission diff")
        expect(Buffer.byteLength(diff)).toBeLessThanOrEqual(256 * 1024)
        expect(diff).toContain("... diff truncated:")
        expect(result.output).toBe("Wrote file successfully (20971520 bytes).")
        expect(yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))).toBe(content)
      }),
    )
  }

  describe("new file creation", () => {
    it.instance("writes content to new file", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "newfile.txt")
        const result = yield* run({ filePath: filepath, content: "Hello, World!" })

        expect(result.output).toContain("Wrote file successfully")
        expect(result.metadata.exists).toBe(false)

        const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
        expect(content).toBe("Hello, World!")
      }),
    )

    it.instance("creates parent directories if needed", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "nested", "deep", "file.txt")
        yield* run({ filePath: filepath, content: "nested content" })

        const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
        expect(content).toBe("nested content")
      }),
    )

    it.instance("handles relative paths by resolving to instance directory", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* run({ filePath: "relative.txt", content: "relative content" })

        const content = yield* Effect.promise(() => fs.readFile(path.join(test.directory, "relative.txt"), "utf-8"))
        expect(content).toBe("relative content")
      }),
    )
  })

  describe("existing file overwrite", () => {
    it.instance("overwrites existing file content", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "existing.txt")
        yield* Effect.promise(() => fs.writeFile(filepath, "old content", "utf-8"))
        const result = yield* run({ filePath: filepath, content: "new content" })

        expect(result.output).toContain("Wrote file successfully")
        expect(result.metadata.exists).toBe(true)

        const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
        expect(content).toBe("new content")
      }),
    )

    it.instance("preserves BOM when overwriting existing files", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "existing.cs")
        const bom = String.fromCharCode(0xfeff)
        yield* Effect.promise(() => fs.writeFile(filepath, `${bom}using System;\n`, "utf-8"))

        yield* run({ filePath: filepath, content: "using Up;\n" })

        const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
        expect(content.charCodeAt(0)).toBe(0xfeff)
        expect(content.slice(1)).toBe("using Up;\n")
      }),
    )

    it.instance(
      "restores BOM after formatter strips it",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const filepath = path.join(test.directory, "formatted.cs")
          const bom = String.fromCharCode(0xfeff)
          yield* Effect.promise(() => fs.writeFile(filepath, `${bom}using System;\n`, "utf-8"))

          yield* run({ filePath: filepath, content: "using Up;\n" })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content.charCodeAt(0)).toBe(0xfeff)
          expect(content.slice(1)).toBe("using Up;\n")
        }),
      {
        config: {
          formatter: {
            stripbom: {
              extensions: [".cs"],
              command: [
                "node",
                "-e",
                "const fs = require('fs'); const file = process.argv[1]; let text = fs.readFileSync(file, 'utf8'); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); fs.writeFileSync(file, text, 'utf8')",
                "$FILE",
              ],
            },
          },
        },
      },
    )

    it.instance("returns diff in metadata for existing files", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "file.txt")
        yield* Effect.promise(() => fs.writeFile(filepath, "old", "utf-8"))
        const result = yield* run({ filePath: filepath, content: "new" })

        expect(result.metadata).toHaveProperty("filepath", filepath)
        expect(result.metadata).toHaveProperty("exists", true)
      }),
    )
  })

  describe("file permissions", () => {
    it.instance("sets file permissions when writing sensitive data", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "sensitive.json")
        yield* run({ filePath: filepath, content: JSON.stringify({ secret: "data" }) })

        if (process.platform !== "win32") {
          const stats = yield* Effect.promise(() => fs.stat(filepath))
          expect(stats.mode & 0o777).toBe(0o644)
        }
      }),
    )
  })

  describe("content types", () => {
    it.instance("writes JSON content", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "data.json")
        const data = { key: "value", nested: { array: [1, 2, 3] } }
        yield* run({ filePath: filepath, content: JSON.stringify(data, null, 2) })

        const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
        expect(JSON.parse(content)).toEqual(data)
      }),
    )

    it.instance("writes binary-safe content", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "binary.bin")
        const content = "Hello\x00World\x01\x02\x03"
        yield* run({ filePath: filepath, content })

        const buf = yield* Effect.promise(() => fs.readFile(filepath))
        expect(buf.toString()).toBe(content)
      }),
    )

    it.instance("writes empty content", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "empty.txt")
        yield* run({ filePath: filepath, content: "" })

        const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
        expect(content).toBe("")

        const stats = yield* Effect.promise(() => fs.stat(filepath))
        expect(stats.size).toBe(0)
      }),
    )

    it.instance("writes multi-line content", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "multiline.txt")
        const lines = ["Line 1", "Line 2", "Line 3", ""].join("\n")
        yield* run({ filePath: filepath, content: lines })

        const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
        expect(content).toBe(lines)
      }),
    )

    it.instance("handles different line endings", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "crlf.txt")
        const content = "Line 1\r\nLine 2\r\nLine 3"
        yield* run({ filePath: filepath, content })

        const buf = yield* Effect.promise(() => fs.readFile(filepath))
        expect(buf.toString()).toBe(content)
      }),
    )
  })

  describe("error handling", () => {
    it.instance("throws error when OS denies write access", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const readonlyPath = path.join(test.directory, "readonly.txt")
        yield* Effect.promise(() => fs.writeFile(readonlyPath, "test", "utf-8"))
        yield* Effect.promise(() => fs.chmod(readonlyPath, 0o444))
        const exit = yield* run({ filePath: readonlyPath, content: "new content" }).pipe(Effect.exit)
        expect(exit._tag).toBe("Failure")
      }),
    )
  })

  if (process.platform !== "win32") {
    describe("symlinks", () => {
      const deny = {
        ...ctx,
        ask: (req: Parameters<Tool.Context["ask"]>[0]) =>
          req.permission === "external_directory" ? Effect.die(new Error("external_directory denied")) : Effect.void,
      }

      it.instance("asks before writing through a directory link that points outside", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const outside = yield* tmpdirScoped()
          yield* Effect.promise(() => fs.symlink(outside, path.join(test.directory, "linked")))

          const exit = yield* run(
            { filePath: path.join(test.directory, "linked", "file.txt"), content: "pwned" },
            deny,
          ).pipe(Effect.exit)

          expect(exit._tag).toBe("Failure")
          expect(yield* Effect.promise(() => fs.readdir(outside))).toEqual([])
        }),
      )

      it.instance("asks before overwriting the outside target of a file link", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const outside = yield* tmpdirScoped()
          yield* Effect.promise(() => fs.writeFile(path.join(outside, "target.txt"), "original"))
          yield* Effect.promise(() =>
            fs.symlink(path.join(outside, "target.txt"), path.join(test.directory, "link.txt")),
          )

          const exit = yield* run({ filePath: path.join(test.directory, "link.txt"), content: "pwned" }, deny).pipe(
            Effect.exit,
          )

          expect(exit._tag).toBe("Failure")
          expect(yield* Effect.promise(() => fs.readFile(path.join(outside, "target.txt"), "utf-8"))).toBe("original")
        }),
      )

      it.instance("asks before creating the outside target of a dangling link", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const outside = yield* tmpdirScoped()
          yield* Effect.promise(() =>
            fs.symlink(path.join(outside, "created.txt"), path.join(test.directory, "dangling.txt")),
          )

          const exit = yield* run({ filePath: path.join(test.directory, "dangling.txt"), content: "pwned" }, deny).pipe(
            Effect.exit,
          )

          expect(exit._tag).toBe("Failure")
          expect(yield* Effect.promise(() => fs.readdir(outside))).toEqual([])
        }),
      )
    })
  }

  describe("title generation", () => {
    it.instance("returns relative path as title", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "src", "components", "Button.tsx")
        yield* Effect.promise(() => fs.mkdir(path.dirname(filepath), { recursive: true }))

        const result = yield* run({ filePath: filepath, content: "export const Button = () => {}" })
        expect(result.title).toEndWith(path.join("src", "components", "Button.tsx"))
      }),
    )
  })

  describe("file facts", () => {
    it.instance("reports the byte size it wrote", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const result = yield* run({ filePath: path.join(test.directory, "sized.txt"), content: "Hello, World!" })

        expect(result.output).toStartWith("Wrote file successfully (13 bytes).")
      }),
    )

    if (process.platform !== "win32") {
      it.instance("writes through a link and names where the content went", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const real = path.join(test.directory, "real.txt")
          const link = path.join(test.directory, "link.txt")
          yield* Effect.promise(() => fs.writeFile(real, "old"))
          yield* Effect.promise(() => fs.symlink("real.txt", link))

          const result = yield* run({ filePath: link, content: "new" })

          expect(result.output).toStartWith(`Wrote file successfully: ${link} -> ${real} (3 bytes).`)
          expect(yield* Effect.promise(() => fs.readFile(real, "utf-8"))).toBe("new")
          expect((yield* Effect.promise(() => fs.lstat(link))).isSymbolicLink()).toBe(true)
        }),
      )

      it.instance("refuses a dangling link and names the file it would create", () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const link = path.join(test.directory, "dangling.txt")
          const target = path.join(test.directory, "missing.txt")
          yield* Effect.promise(() => fs.symlink("missing.txt", link))

          const exit = yield* run({ filePath: link, content: "x" }).pipe(Effect.exit)

          expect(Exit.isFailure(exit) && String(Cause.squash(exit.cause))).toContain(
            `Refusing to write ${link}: it is a symbolic link to missing.txt (${target}), which does not exist. Write to ${target} to create it.`,
          )
          expect(
            yield* Effect.promise(() =>
              fs.access(target).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
        }),
      )
    }

    it.instance("refuses to overwrite a file that changed on disk since it was read", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "stale.txt")
        yield* Effect.promise(() => fs.writeFile(filepath, "seen"))
        FileFacts.remember(ctx.sessionID, filepath)
        yield* Effect.promise(() => fs.writeFile(filepath, "user edit"))

        const exit = yield* run({ filePath: filepath, content: "model" }).pipe(Effect.exit)

        expect(Exit.isFailure(exit) && String(Cause.squash(exit.cause))).toContain(FileFacts.STALE)
        expect(yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))).toBe("user edit")
      }),
    )

    it.instance("treats a touched file of the same size as changed", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "touched.txt")
        yield* Effect.promise(() => fs.writeFile(filepath, "same"))
        FileFacts.remember(ctx.sessionID, filepath)
        yield* Effect.promise(() => fs.utimes(filepath, new Date(2000, 0, 1), new Date(2000, 0, 1)))

        const exit = yield* run({ filePath: filepath, content: "model" }).pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )

    it.instance("keeps its own writes fresh and leaves unread files unguarded", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "own.txt")
        yield* Effect.promise(() => fs.writeFile(filepath, "seen"))
        FileFacts.remember(ctx.sessionID, filepath)

        yield* run({ filePath: filepath, content: "first write" })
        yield* run({ filePath: filepath, content: "second write" })
        yield* Effect.promise(() => fs.writeFile(filepath, "outside"))
        const other = yield* run(
          { filePath: filepath, content: "other session" },
          { ...ctx, sessionID: SessionID.make("ses_never-read") },
        )

        expect(other.output).toStartWith("Wrote file successfully")
        expect(yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))).toBe("other session")
      }),
    )
  })
})
