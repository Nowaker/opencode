export * as StartupTerminal from "./terminal"

import fs from "node:fs"
import { StartupFrame } from "./frame"

// The early owner's terminal modes. Taking the terminal is all or nothing: raw mode and the first frame both land,
// or the terminal is left as it was and the caller learns why. Giving it back tolerates only a terminal that has
// gone away, where nothing is left to restore.

// What a hung-up, closed or redirected-away terminal reports.
const GONE = new Set(["EIO", "ENXIO", "EBADF", "EPIPE"])

const pause = new Int32Array(new SharedArrayBuffer(4))

export function gone(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string" && GONE.has(error.code)
}

/** Writes all of `text`, across short writes and a non-blocking descriptor that is momentarily full. */
export function write(fd: number, text: string) {
  const bytes = Buffer.from(text)
  let offset = 0
  while (offset < bytes.length) {
    try {
      offset += fs.writeSync(fd, bytes, offset)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EAGAIN")) throw error
      Atomics.wait(pause, 0, 0, 1)
    }
  }
}

/** Enters raw mode and the alternate screen with `screen` drawn. Throws with the terminal as it was. */
export function acquire(screen: string) {
  process.stdin.setRawMode(true)
  // Node reports a failed mode change as an "error" event instead of a throw when stdin has an error listener.
  if (!process.stdin.isRaw) throw new Error("The terminal did not enter raw mode")
  try {
    write(1, StartupFrame.enter + screen)
  } catch (error) {
    release()
    throw error
  }
}

/** Leaves the alternate screen and raw mode. */
export function release() {
  quietly(() => write(1, StartupFrame.leave))
  quietly(() => process.stdin.setRawMode(false))
}

function quietly(action: () => void) {
  try {
    action()
  } catch (error) {
    if (!gone(error)) throw error
  }
}
