import { expect, test } from "bun:test"
import { EventEmitter, once } from "node:events"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

// Windows does not take early terminal ownership or support this POSIX signal fixture.
const unix = test.skipIf(process.platform === "win32")
const empty = { text: "", caret: 0, anchor: 0, touched: false, submit: false }

unix.each([
  { name: "unfinished bracketed paste", bytes: Buffer.from("\x1b[200~h\u00e9llo 日本") },
  { name: "split UTF-8 character", bytes: Buffer.from([0xf0, 0x9f]) },
  { name: "unfinished control sequence", bytes: Buffer.from("\x1b[1;") },
])("failure recovery preserves already-read $name bytes without waiting for their completion", async ({ bytes }) => {
  await using child = spawn()
  await child.wait(() => child.frames() >= 2)
  const frames = child.frames()
  child.write(bytes)
  await child.wait(() => child.frames() > frames)

  const result = await child.recover()

  expect(result).toContain(`Startup draft (not submitted): ${JSON.stringify(empty)}`)
  const encoded = /Startup input remainder \(base64, not submitted\): ([A-Za-z0-9+/=]+)/.exec(result)?.[1]
  expect(encoded).toBeDefined()
  expect(Buffer.from(encoded ?? "", "base64")).toEqual(bytes)
})

unix("failure recovery prints the draft on the owned normal terminal when stderr is redirected", async () => {
  await using root = await tmpdir()
  const stderr = path.join(root.path, "stderr")
  await using child = spawn(stderr)
  await child.wait(() => child.frames() >= 2)
  child.write("recovered draft")
  await child.wait(() => child.output().includes("recovered draft"))

  const result = await child.recover()

  const restored = result.indexOf("\x1b[?1049l")
  expect(restored).toBeGreaterThan(-1)
  expect(result.slice(restored)).toContain(
    `Startup draft (not submitted): ${JSON.stringify({
      text: "recovered draft",
      caret: 15,
      anchor: 15,
      touched: true,
      submit: false,
    })}`,
  )
  expect(await Bun.file(stderr).text()).not.toContain("recovered draft")
})

function spawn(stderr?: string) {
  const events = new EventEmitter()
  const decoder = new TextDecoder()
  let output = ""
  const proc = Bun.spawn(
    [process.execPath, path.join(import.meta.dir, "../fixture/startup-recovery.ts"), ...(stderr ? [stderr] : [])],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: { ...process.env, TERM: "xterm-256color" },
      terminal: {
        cols: 80,
        rows: 24,
        data(_, chunk) {
          output += decoder.decode(chunk, { stream: true })
          events.emit("output")
        },
      },
    },
  )
  void proc.exited.then(() => events.emit("output"))
  const wait = async (predicate: () => boolean) => {
    const signal = AbortSignal.timeout(10_000)
    while (!predicate()) {
      if (proc.exitCode !== null) throw new Error(`Startup fixture exited before the expected output: ${output}`)
      await once(events, "output", { signal })
    }
  }
  return {
    output: () => output,
    frames: () => output.split("\x1b[?2026l").length - 1,
    write: (bytes: string | Uint8Array) => proc.terminal?.write(bytes),
    wait,
    async recover() {
      proc.kill("SIGUSR2")
      await wait(() => output.includes("RECOVERY_RETURNED"))
      expect(await proc.exited).toBe(1)
      return output
    },
    async [Symbol.asyncDispose]() {
      if (proc.exitCode === null) {
        proc.kill("SIGKILL")
        await proc.exited
      }
      proc.terminal?.close()
    },
  }
}
