export * as StartupReader from "./reader"

import fs from "node:fs"

// The descriptor is nonblocking. A read and its delivery happen in the same worker callback, so stop() cannot race
// native read completion or discard bytes already consumed by an asynchronous file stream. While empty, the startup
// worker checks once per frame; the timer is gone as soon as the renderer takes over.
export function create(fd: number, receive: (bytes: Uint8Array) => void) {
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let active = true
  let timer = setTimeout(read, 0)

  function close() {
    if (!active) return
    active = false
    clearTimeout(timer)
    fs.closeSync(fd)
  }

  function read() {
    if (!active) return
    const count = (() => {
      try {
        return fs.readSync(fd, buffer, 0, buffer.length, null)
      } catch (error) {
        if (error instanceof Error && "code" in error) {
          if (error.code === "EAGAIN" || error.code === "EWOULDBLOCK") return undefined
          if (error.code === "EINTR") return undefined
        }
        close()
        throw error
      }
    })()
    try {
      if (count === 0) throw new Error("Startup terminal closed before handover")
      if (count !== undefined) receive(new Uint8Array(buffer.subarray(0, count)))
    } catch (error) {
      close()
      throw error
    }
    if (active) timer = setTimeout(read, count === undefined ? 16 : 0)
  }

  return {
    stop: async () => {
      close()
      return []
    },
  }
}
