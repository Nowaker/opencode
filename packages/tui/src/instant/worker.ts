import fs from "fs"
import { TuiLayout } from "../layout"
import { InstantSession } from "./session"

// The instant startup prompt's input loop. It runs on its own thread because
// the main thread is busy evaluating the rest of the CLI and cannot service
// stdin until it is done; here, keys are read and painted as they are typed.
//
// `flags` is shared with the main thread: [0] is a write lock and [1] a stop
// flag, so once the main thread takes the terminal back no frame from this
// thread can land after its own output.

export type Message =
  | { type: "init"; init: InstantSession.Init; size: { width: number; height: number }; flags: SharedArrayBuffer }
  | { type: "resize"; size: { width: number; height: number } }
  | { type: "stop" }

export type Reply = { type: "stopped"; state: InstantSession.State; pending: string } | { type: "quit" }

declare const self: {
  onmessage: ((event: MessageEvent<Message>) => void) | null
  postMessage(message: Reply): void
}

let session: InstantSession.Session | undefined
let size = { width: 80, height: 24 }
let flags: Int32Array | undefined
let spinner: ReturnType<typeof setInterval> | undefined
let escape: ReturnType<typeof setTimeout> | undefined
let backlog = true

function write(text: string) {
  if (!flags || !text) return
  while (Atomics.compareExchange(flags, 0, 0, 1) !== 0) {}
  try {
    if (Atomics.load(flags, 1) === 0) fs.writeSync(1, text)
  } catch {
  } finally {
    Atomics.store(flags, 0, 0)
  }
}

const paint = () => {
  if (session?.init.screen) write(session.paint(size.width, size.height))
}

function read(chunk: Buffer) {
  if (!session) return
  if (escape) clearTimeout(escape)
  const first = backlog
  backlog = false
  if (session.input(chunk, first) === "quit") return quit()
  if (session.escapePending()) {
    escape = setTimeout(() => {
      if (session?.flushEscape() === "quit") return quit()
      paint()
    }, 30)
  }
  paint()
}

function stop() {
  clearInterval(spinner)
  clearTimeout(escape)
  process.stdin.off("data", read)
  process.stdin.pause()
}

function quit() {
  stop()
  self.postMessage({ type: "quit" })
}

self.onmessage = (event) => {
  const message = event.data
  if (message.type === "init") {
    flags = new Int32Array(message.flags)
    size = message.size
    session = InstantSession.create(message.init)
    process.stdin.on("data", read)
    process.stdin.resume()
    if (!session.init.screen) return
    session.compute(size.width, size.height)
    spinner = setInterval(() => session && write(session.tick()), TuiLayout.Spinner.interval)
    return
  }
  if (message.type === "resize") {
    size = message.size
    return paint()
  }
  if (!session) return
  stop()
  // Bytes the stream read ahead of the parser go back with the state.
  let rest = ""
  for (let chunk = process.stdin.read(); chunk !== null; chunk = process.stdin.read()) rest += chunk.toString("latin1")
  if (rest) session.input(Buffer.from(rest, "latin1"))
  self.postMessage({ type: "stopped", state: session.state(), pending: session.takePending() })
}
