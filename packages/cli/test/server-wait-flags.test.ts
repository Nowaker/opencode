import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { expect, test } from "bun:test"
import { Console, Effect, Option } from "effect"
import { Command } from "effect/cli"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it } from "../../core/test/lib/effect"
import { Commands } from "../src/commands/commands"
import { ServerConnection } from "../src/services/server-connection"
import { ServiceConfig } from "../src/services/service-config"
import { isolatedEnv } from "./fixture/environment"

const silent: Console.Console = { ...console, log: () => {}, error: () => {} }

test.each(["1", "2147483647"])("--server-wait parses the inclusive bound %s", async (value) => {
  let result: number | undefined
  const command = Commands.spec.pipe(
    Command.withHandler((input) =>
      Effect.sync(() => {
        result = Option.getOrUndefined(input.serverWait)
      }),
    ),
  )
  await Effect.runPromise(
    Command.runWith(command, { version: "test" })(["--server", "http://127.0.0.1:1", "--server-wait", value]).pipe(
      Effect.provide(NodeServices.layer),
    ),
  )
  expect(result).toBe(Number(value))
})

test.each(["0", "-1", "2147483648", "1.5", "NaN", "Infinity", "", "1x"])("--server-wait refuses %s", async (value) => {
  const command = Commands.spec.pipe(Command.withHandler(() => Effect.void))
  await expect(
    Effect.runPromise(
      Command.runWith(command, { version: "test", renderErrors: false })(["--server-wait", value]).pipe(
        Effect.provideService(Console.Console, silent),
        Effect.provide(NodeServices.layer),
      ),
    ),
  ).rejects.toThrow()
})

it.live("--server-wait refuses missing explicit --server before discovery", () =>
  ServerConnection.resolve({ serverWait: 1 }).pipe(
    Effect.provide(
      Global.layerWith({
        config: path.join(os.tmpdir(), "startup-wait-no-config"),
        state: path.join(os.tmpdir(), "startup-wait-no-state"),
      }),
    ),
    Effect.provide(NodeServices.layer),
    Effect.scoped,
    Effect.flip,
    Effect.tap((error) =>
      Effect.sync(() => expect(error.message).toContain("--server-wait requires an explicit --server")),
    ),
  ),
)

test.each([false, true])(
  "native help advertises --server-wait without starting or contacting an engine (explicit: %s)",
  async (explicit) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-startup-help-"))
    let requests = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        requests++
        return new Response("must not connect", { status: 500 })
      },
    })
    const env = isolatedEnv(root, { NO_COLOR: "1" })
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        path.join(import.meta.dir, "../src/index.ts"),
        ...(explicit ? ["--server", server.url.toString()] : []),
        "--help",
      ],
      {
        cwd: path.join(import.meta.dir, ".."),
        env,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
      expect(stdout).toMatch(/^\s+--server-wait\s/m)
      expect(requests).toBe(0)
      expect(await Bun.file(env.OPENCODE_DB).exists()).toBe(false)
      expect(await Bun.file(path.join(env.XDG_STATE_HOME, "opencode2", ServiceConfig.filename())).exists()).toBe(false)
    } finally {
      if (child.exitCode === null) child.kill()
      await child.exited
      await server.stop(true)
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)
