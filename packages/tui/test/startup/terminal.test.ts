import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { StartupTerminal } from "../../src/startup/terminal"
import { tmpdir } from "../fixture/fixture"

// A non-blocking FIFO takes at most its kernel buffer per write, then refuses with EAGAIN until its reader drains it,
// as a non-blocking terminal does. This fixture requires POSIX FIFOs.
async function fifo(directory: string) {
  const file = path.join(directory, "terminal")
  expect(Bun.spawnSync(["mkfifo", file]).exitCode).toBe(0)
  const held = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
  const writer = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)
  return { file, held, writer }
}

test.skipIf(process.platform === "win32")("a frame larger than the terminal buffer is written whole", async () => {
  await using state = await tmpdir()
  const pipe = await fifo(state.path)
  const reader = Bun.spawn(["sh", "-c", 'exec wc -c < "$0"', pipe.file], { stdout: "pipe" })
  const frame = "x".repeat(1 << 20)
  StartupTerminal.write(pipe.writer, frame)
  fs.closeSync(pipe.writer)
  fs.closeSync(pipe.held)
  expect(await reader.exited).toBe(0)
  expect(Number((await new Response(reader.stdout).text()).trim())).toBe(frame.length)
})

test("a closed terminal is recognized as gone, a programming error is not", async () => {
  await using state = await tmpdir()
  const fd = fs.openSync(path.join(state.path, "closed"), "w")
  fs.closeSync(fd)
  const error = (() => {
    try {
      StartupTerminal.write(fd, "frame")
    } catch (caught) {
      return caught
    }
  })()
  expect(StartupTerminal.gone(error)).toBe(true)
  expect(StartupTerminal.gone(new TypeError("a programming error"))).toBe(false)
})
