import { afterEach, describe, expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Logger } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileLogger } from "../../src/observability/logging"
import { resource } from "../../src/observability/otlp"

const otelResourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES
const opencodeClient = process.env.OPENCODE_CLIENT

afterEach(() => {
  if (otelResourceAttributes === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES
  else process.env.OTEL_RESOURCE_ATTRIBUTES = otelResourceAttributes

  if (opencodeClient === undefined) delete process.env.OPENCODE_CLIENT
  else process.env.OPENCODE_CLIENT = opencodeClient
})

describe("resource", () => {
  test("parses and decodes OTEL resource attributes", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.namespace=anomalyco,team=platform%2Cobservability,label=hello%3Dworld,key%2Fname=value%20here"

    expect(resource().attributes).toMatchObject({
      "service.namespace": "anomalyco",
      team: "platform,observability",
      label: "hello=world",
      "key/name": "value here",
    })
  })

  test("drops OTEL resource attributes when any entry is invalid", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "service.namespace=anomalyco,broken"

    expect(resource().attributes["service.namespace"]).toBeUndefined()
    expect(resource().attributes["opencode.client"]).toBeDefined()
  })

  test("keeps built-in attributes when env values conflict", () => {
    process.env.OPENCODE_CLIENT = "cli"
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "opencode.client=web,service.instance.id=override,service.namespace=anomalyco"

    expect(resource().attributes).toMatchObject({
      "opencode.client": "cli",
      "service.namespace": "anomalyco",
    })
    expect(resource().attributes["service.instance.id"]).not.toBe("override")
    expect(resource().attributes["opencode.run"]).toMatch(/^[0-9a-f]{8}$/)
  })
})

test("file logger appends concurrent runs with a run on every line", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-log-test-"))
  await using _ = {
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
  const file = path.join(dir, "opencode.log")
  const write = (runID: string) =>
    Effect.forEach(
      Array.from({ length: 50 }, (_, index) => index),
      (index) => Effect.logInfo(`entry-${index}`),
    ).pipe(
      Effect.provide(Logger.layer([fileLogger(file, runID)]).pipe(Layer.provide(NodeFileSystem.layer), Layer.orDie)),
      Effect.scoped,
    )

  await Effect.runPromise(Effect.all([write("run-a"), write("run-b")], { concurrency: "unbounded" }))

  const lines = (await Bun.file(file).text()).trim().split("\n")
  expect(lines).toHaveLength(100)
  expect(lines.filter((line) => line.includes("run=run-a"))).toHaveLength(50)
  expect(lines.filter((line) => line.includes("run=run-b"))).toHaveLength(50)
  expect(lines.every((line) => line.startsWith("timestamp=") && line.includes(" level=INFO "))).toBe(true)
  expect(lines.every((line) => !line.includes(" fiber="))).toBe(true)
  expect(lines.every((line) => !line.startsWith("{"))).toBe(true)
})

test("file logger flattens nested objects", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-log-test-"))
  await using _ = {
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
  const file = path.join(dir, "opencode.log")

  await Effect.logInfo("request complete", {
    request: { method: "GET", timing: { duration: 42 } },
    tags: ["api", "test"],
  }).pipe(
    Effect.annotateLogs({ session: { id: "session-1" } }),
    Effect.provide(Logger.layer([fileLogger(file, "run-a")]).pipe(Layer.provide(NodeFileSystem.layer), Layer.orDie)),
    Effect.scoped,
    Effect.runPromise,
  )

  const line = (await Bun.file(file).text()).trim()
  expect(line).toContain('message="request complete"')
  expect(line).toContain("request.method=GET")
  expect(line).toContain("request.timing.duration=42")
  expect(line).toContain('tags="[\\\"api\\\",\\\"test\\\"]"')
  expect(line).toContain("session.id=session-1")
  expect(line).not.toContain("request={")
})

describe("file logger after the log file is moved", () => {
  async function logAround(file: string, between: () => Promise<unknown>, fileSystem = NodeFileSystem.layer) {
    await Effect.gen(function* () {
      yield* Effect.logInfo("before")
      yield* Effect.promise(() => written(file, "before"))
      yield* Effect.promise(between)
      yield* Effect.logInfo("after")
    }).pipe(
      Effect.provide(Logger.layer([fileLogger(file, "run-a")]).pipe(Layer.provide(fileSystem), Layer.orDie)),
      Effect.scoped,
      Effect.runPromise,
    )
  }

  async function written(file: string, message: string) {
    while (
      !(
        await Bun.file(file)
          .text()
          .catch(() => "")
      ).includes(`message=${message}`)
    )
      await Bun.sleep(10)
  }

  async function messages(file: string) {
    return (await Bun.file(file).text())
      .trim()
      .split("\n")
      .map((line) => line.match(/ message=(\S+)/)?.[1])
  }

  async function tempLog() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-log-test-"))
    return {
      file: path.join(dir, "opencode.log"),
      async [Symbol.asyncDispose]() {
        await fs.rm(dir, { recursive: true, force: true })
      },
    }
  }

  test("writes to a new file at the original path after a rename", async () => {
    await using log = await tempLog()

    await logAround(log.file, () => fs.rename(log.file, `${log.file}.old`))

    expect(await messages(`${log.file}.old`)).toEqual(["before"])
    expect(await messages(log.file)).toEqual(["after"])
  })

  test("recreates a deleted file", async () => {
    await using log = await tempLog()

    await logAround(log.file, () => fs.rm(log.file))

    expect(await messages(log.file)).toEqual(["after"])
  })

  test("keeps the open file while the path still names it", async () => {
    await using log = await tempLog()
    const opened: string[] = []
    const counting = Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (fileSystem) =>
        FileSystem.FileSystem.of({
          ...fileSystem,
          open: (file, options) => {
            opened.push(file)
            return fileSystem.open(file, options)
          },
        }),
      ),
    ).pipe(Layer.provide(NodeFileSystem.layer))

    await logAround(log.file, async () => {}, counting)

    expect(opened).toEqual([log.file])
    expect(await messages(log.file)).toEqual(["before", "after"])
  })
})
