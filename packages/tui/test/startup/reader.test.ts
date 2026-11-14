import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { StartupReader } from "../../src/startup/reader"
import { tmpdir } from "../fixture/fixture"

// The early reader is Unix-only; Windows bypasses startup ownership and has no POSIX FIFOs.
const unix = test.skipIf(process.platform === "win32")

unix("stopping before the first read leaves every queued byte in the kernel", async () => {
  await using root = await tmpdir()
  const pipe = open(root.path)
  const received: Uint8Array[] = []
  const reader = StartupReader.create(pipe.read, (bytes) => received.push(bytes))
  const payload = Uint8Array.of(0xf0, 0x9f, 0x92, 0xa1, 0xff, 0x00, 0x1b)
  try {
    fs.writeSync(pipe.control, payload)
    expect(await reader.stop()).toEqual([])
    const remaining = new Uint8Array(payload.length)
    expect(fs.readSync(pipe.control, remaining)).toBe(payload.length)
    expect(remaining).toEqual(payload)
    expect(received).toEqual([])
  } finally {
    await reader.stop()
    fs.closeSync(pipe.control)
  }
})

unix("handover from a delivered chunk leaves subsequent input unread", async () => {
  await using root = await tmpdir()
  const pipe = open(root.path)
  const received = Promise.withResolvers<Uint8Array>()
  const stopped = Promise.withResolvers<void>()
  const first = Buffer.from("日本 e\u0301")
  const after = Uint8Array.of(0x1b, 0x5b, 0x44, 0xff)
  const reader = StartupReader.create(pipe.read, (bytes) => {
    received.resolve(bytes)
    void reader.stop().then(() => stopped.resolve(), stopped.reject)
  })
  try {
    fs.writeSync(pipe.control, first)
    expect(await received.promise).toEqual(new Uint8Array(first))
    await stopped.promise
    fs.writeSync(pipe.control, after)
    const remaining = new Uint8Array(after.length)
    expect(fs.readSync(pipe.control, remaining)).toBe(after.length)
    expect(remaining).toEqual(after)
  } finally {
    await reader.stop()
    fs.closeSync(pipe.control)
  }
})

function open(root: string) {
  const file = path.join(root, "input")
  expect(Bun.spawnSync(["mkfifo", file]).exitCode).toBe(0)
  const control = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NONBLOCK)
  return { control, read: fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK) }
}
