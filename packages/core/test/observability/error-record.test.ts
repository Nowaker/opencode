import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ErrorRecord } from "../../src/observability/error-record"

async function scratch() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-error-record-"))
  return {
    file: path.join(dir, "errors.jsonl"),
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

async function records(file: string) {
  return (await Bun.file(file).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("ErrorRecord", () => {
  test("appends one bounded JSON line per error, with its frames and nothing else", async () => {
    await using log = await scratch()
    const writer = ErrorRecord.writer({ file: log.file, process: "tui-worker", version: "1.2.3-vt-4-0123456789" })

    writer.record(new TypeError("bad value"), "unhandledRejection")

    const [record, ...rest] = await records(log.file)
    expect(rest).toEqual([])
    expect(Object.keys(record!).sort()).toEqual(["message", "origin", "process", "run", "schema", "stack", "time", "type", "version"])
    expect(record).toMatchObject({
      schema: 1,
      process: "tui-worker",
      origin: "unhandledRejection",
      type: "TypeError",
      message: "bad value",
      version: "1.2.3-vt-4-0123456789",
    })
    expect(String(record!.stack)).toMatch(/^TypeError: bad value\n\s+at .*error-record\.test\.ts:\d+:\d+/)
    expect(Date.parse(String(record!.time))).toBeGreaterThan(0)
  })

  test("bounds the message and the frames", async () => {
    await using log = await scratch()
    const writer = ErrorRecord.writer({ file: log.file, process: "tui-worker", version: "local" })
    const error = new Error("x".repeat(10_000))
    error.stack = [`Error: ${error.message}`, ...Array.from({ length: 500 }, (_, index) => `    at f${index} (/a.ts:1:1)`)].join("\n")

    writer.record(error, "uncaughtException")

    const [record] = await records(log.file)
    expect(String(record!.message).length).toBeLessThanOrEqual(2_003)
    const stack = String(record!.stack).split("\n")
    expect(stack.filter((line) => line.trimStart().startsWith("at "))).toHaveLength(50)
    expect(stack[0]!.length).toBeLessThanOrEqual(2_010)
  })

  test("describes a thrown value that is not an Error", async () => {
    await using log = await scratch()
    const writer = ErrorRecord.writer({ file: log.file, process: "tui-worker", version: "local" })

    writer.record({ code: 7 }, "unhandledRejection")

    const [record] = await records(log.file)
    expect(record).toMatchObject({ type: "NonErrorThrown", message: '{"code":7}' })
    expect(record!.stack).toBeUndefined()
  })

  test("stops writing past its per-minute budget, so an error loop cannot fill the disk", async () => {
    await using log = await scratch()
    let now = 1_000_000
    const writer = ErrorRecord.writer({ file: log.file, process: "tui-worker", version: "local", now: () => now })

    for (let index = 0; index < ErrorRecord.MAX_PER_MINUTE + 10; index++) writer.record(new Error(`e${index}`), "uncaughtException")
    now += 61_000
    writer.record(new Error("later"), "uncaughtException")

    const written = await records(log.file)
    expect(written).toHaveLength(ErrorRecord.MAX_PER_MINUTE + 1)
    expect(written.at(-1)).toMatchObject({ message: "later" })
  })

  test("moves a full file aside before appending", async () => {
    await using log = await scratch()
    await Bun.write(log.file, "x".repeat(ErrorRecord.MAX_FILE_BYTES))
    const writer = ErrorRecord.writer({ file: log.file, process: "tui-worker", version: "local" })

    writer.record(new Error("fresh"), "uncaughtException")

    expect(await records(log.file)).toHaveLength(1)
    expect((await fs.stat(`${log.file}.1`)).size).toBe(ErrorRecord.MAX_FILE_BYTES)
  })

  test("never throws, even when the file cannot be written", () => {
    const writer = ErrorRecord.writer({ file: "/nonexistent-dir/for/sure/errors.jsonl", process: "tui-worker", version: "local" })

    expect(() => writer.record(new Error("x"), "uncaughtException")).not.toThrow()
  })
})
