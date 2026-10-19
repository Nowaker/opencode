import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import { watch } from "node:fs"
import os from "node:os"
import path from "node:path"

const runner = path.resolve(import.meta.dir, "../../../..", "script/test.ts")

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runner-proof-"))
  await fs.mkdir(path.join(root, "tmp"))
  await Bun.write(
    path.join(root, "fixture.test.ts"),
    `import { test, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
test("leaves scratch behind", async () => {
  await fs.mkdir(path.join(os.tmpdir(), "opencode-tui-test-forgotten"))
  await fs.mkdir(path.join(os.tmpdir(), "opencode-test-failed-init"))
  const active = await fs.open(path.join(os.tmpdir(), "active"), "w")
  await active.writeFile("owned")
  await Bun.write(path.join(process.env.NODE_COMPILE_CACHE, "entry"), "cache")
  await Bun.write(path.join(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH, "entry"), "cache")
  if (process.env.FIXTURE_RESULT === "teardown") {
    await Promise.all(Array.from({ length: 2000 }, (_, i) => fs.mkdir(path.join(os.tmpdir(), "busy-" + i))))
  }
  console.log("SCRATCH=" + os.tmpdir())
  await Bun.stdin.text()
  await active.close()
  if (process.env.FIXTURE_RESULT === "exit") process.exit(7)
  expect(["pass", "teardown"]).toContain(process.env.FIXTURE_RESULT)
})
`,
  )
  return {
    root,
    start(result: string) {
      return Bun.spawn([process.execPath, runner, "--timeout", "10000", "./fixture.test.ts"], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          TMPDIR: path.join(root, "tmp"),
          FIXTURE_RESULT: result,
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, { recursive: true, force: true })
    },
  }
}

async function ready(child: ReturnType<Awaited<ReturnType<typeof fixture>>["start"]>) {
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let output = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error("test child exited before publishing its scratch path")
      output += decoder.decode(chunk.value, { stream: true })
      const line = output.split("\n").slice(0, -1).find((line) => line.startsWith("SCRATCH="))
      if (line) return line.slice("SCRATCH=".length)
    }
  } finally {
    reader.releaseLock()
  }
}

test.each(["pass", "fail", "exit"])("test runner removes scratch after %s", async (result) => {
  // Given a real suite that deliberately leaves fixtures and runtime caches.
  await using rig = await fixture()
  const child = rig.start(result)
  try {
    const scratch = await ready(child)
    expect((await fs.readdir(scratch)).toSorted()).toEqual(["active", "opencode-test-failed-init", "opencode-tui-test-forgotten"])

    // When the suite exits normally or with a failed assertion.
    child.stdin.end()
    expect(await child.exited).toBe(result === "pass" ? 0 : result === "exit" ? 7 : 1)

    // Then the parent removes its whole run root, not only disposed fixtures.
    expect(await fs.readdir(path.join(rig.root, "tmp"))).toEqual([])
  } finally {
    child.kill()
    await child.exited
  }
})

test("test runner keeps parallel scratch alive until its owner exits", async () => {
  // Given two live suites with a shared temp parent.
  await using rig = await fixture()
  const first = rig.start("pass")
  const second = rig.start("pass")
  try {
    const [a, b] = await Promise.all([ready(first), ready(second)])
    expect(a).not.toBe(b)
    expect(await fs.readdir(path.join(rig.root, "tmp"))).toHaveLength(2)

    // When only the first suite exits.
    first.stdin.end()
    expect(await first.exited).toBe(0)

    // Then the second suite still owns usable fixtures.
    expect(await Bun.file(path.join(b, "active")).text()).toBe("owned")
    expect(await fs.readdir(path.join(rig.root, "tmp"))).toHaveLength(1)
    second.stdin.end()
    expect(await second.exited).toBe(0)
    expect(await fs.readdir(path.join(rig.root, "tmp"))).toEqual([])
  } finally {
    first.kill()
    second.kill()
    await Promise.all([first.exited, second.exited])
  }
})

test.each(["SIGTERM", "SIGHUP"] as const)("test runner forwards %s before removing active scratch", async (signal) => {
  // Given a live suite holding an open scratch file.
  await using rig = await fixture()
  const child = rig.start("pass")
  try {
    const scratch = await ready(child)
    expect(await Bun.file(path.join(scratch, "active")).text()).toBe("owned")

    // When the runner receives a termination signal.
    child.kill(signal)
    expect(await child.exited).not.toBe(0)

    // Then it has waited for the child and removed only its own scratch.
    expect(await fs.readdir(path.join(rig.root, "tmp"))).toEqual([])
  } finally {
    child.kill()
    await child.exited
  }
})

test("test runner removes scratch when test discovery fails", async () => {
  // Given a broken preload that exits before any test finalizer can register.
  await using rig = await fixture()
  await Bun.write(path.join(rig.root, "bunfig.toml"), '[test]\npreload = ["./broken.ts"]\n')
  await Bun.write(path.join(rig.root, "broken.ts"), 'throw new Error("preload failed")\n')

  // When Bun cannot initialize the suite.
  const child = rig.start("pass")
  child.stdin.end()
  expect(await child.exited).toBe(1)

  // Then run-owned scratch is still removed.
  expect(await fs.readdir(path.join(rig.root, "tmp"))).toEqual([])
})

test("test runner finishes teardown when signalled after its child exits", async () => {
  // Given enough real scratch entries to observe asynchronous recursive removal.
  await using rig = await fixture()
  const child = rig.start("teardown")
  const scratch = await ready(child)
  const interrupted = Promise.withResolvers<void>()
  const watcher = watch(scratch, (event) => {
    if (event !== "rename") return
    child.kill("SIGTERM")
    watcher.close()
    interrupted.resolve()
  })
  try {
    // When deletion starts after the child exits, terminate the supervisor.
    child.stdin.end()
    expect(await child.exited).not.toBe(0)
    await interrupted.promise

    // Then it preserves signal status while finishing its owned teardown.
    expect(await fs.readdir(path.join(rig.root, "tmp"))).toEqual([])
  } finally {
    watcher.close()
    child.kill()
    await child.exited
  }
})
