import fs from "node:fs"
import tty from "node:tty"
import { parentPort, workerData } from "node:worker_threads"
import { stringWidth } from "#string-width"
import { StartupEditor } from "./editor"
import { StartupFrame } from "./frame"
import { StartupIntake } from "./intake"
import { StartupReader } from "./reader"
import type { Init, Reply, Request } from "./protocol"

// The startup composer's input loop. It runs on its own thread because the main thread is busy evaluating the CLI
// and the TUI and cannot service input until it is done. It reads the terminal through its own descriptor, so the
// main thread's stdin stays untouched, and it writes only whole frames. The main thread writes nothing to the
// terminal until this thread has acknowledged a handover, so no frame of ours can land after the renderer's output.

// Bytes after a cutoff stay unread in the kernel unless the reader has already taken them; those are returned.
type Reader = { readonly stop: () => Promise<Uint8Array[]> }

const ESCAPE_TIMEOUT = 20
if (!parentPort) throw new Error("The startup input worker must run in a worker thread")
const port = parentPort
const init: Init = workerData
const measure = (segment: string) => stringWidth(segment)
const editor = StartupEditor.create({ text: init.prompt, measure })
const intake = StartupIntake.create((token) => {
  if (token.type === "text") return editor.insert(token.text)
  if (token.type === "paste") return editor.paste(token.text)
  if (token.type !== "key") return
  if (editor.key(token.key, StartupFrame.geometry(init.route, size.width).columns) === "quit") return "quit"
})
let size = { width: init.width, height: init.height }
let status: string | undefined
let done = false
let escape: ReturnType<typeof setTimeout> | undefined
const reader = open()

function open(): Reader | undefined {
  try {
    const flags = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOCTTY
    const fd = fs.openSync("/dev/tty", flags)
    return typeof Bun === "undefined" ? nodeReader(fd) : StartupReader.create(fd, receive)
  } catch (error) {
    post({ type: "unavailable", message: error instanceof Error ? error.message : String(error) })
  }
}

// Node: a tty stream over our own descriptor. Pausing stops delivery; whatever it had read ahead is drained
// synchronously, so no read callback can run between the drain and destroy(), which closes only our descriptor.
function nodeReader(fd: number): Reader {
  const stream = new tty.ReadStream(fd)
  const data = (chunk: Buffer) => receive(new Uint8Array(chunk))
  stream.on("data", data)
  stream.on("error", fail)
  return {
    stop: async () => {
      stream.off("data", data)
      stream.pause()
      const rest: Uint8Array[] = []
      for (let chunk: Buffer | null = stream.read(); chunk !== null; chunk = stream.read())
        rest.push(new Uint8Array(chunk))
      stream.off("error", fail)
      stream.destroy()
      return rest
    },
  }
}

function receive(bytes: Uint8Array) {
  if (done) return
  const outcome = intake.push(bytes)
  if (escape && !intake.escapePending) {
    clearTimeout(escape)
    escape = undefined
  }
  settle(outcome)
}

function flushEscape() {
  escape = undefined
  settle(intake.flushEscape())
}

function settle(outcome: StartupIntake.Outcome) {
  if (outcome === "quit") return void quit()
  paint()
  if (outcome === "stopped") return void finish()
  // The deadline is armed once, when the Escape arrives; later input decides it or the deadline does.
  if (intake.escapePending && !escape) escape = setTimeout(flushEscape, ESCAPE_TIMEOUT)
}

function paint() {
  if (done) return
  write(
    StartupFrame.render({
      route: init.route,
      width: size.width,
      height: size.height,
      text: editor.text,
      caret: editor.caret,
      anchor: editor.anchor,
      status,
      version: init.version,
      measure,
    }),
  )
}

// Writes happen under the shared lock and only while the terminal is still ours, so once the main thread has taken
// it back no frame can land after its output. A full terminal buffer waits instead of dropping part of a frame.
function write(text: string) {
  const flags = init.flags
  while (Atomics.compareExchange(flags, 0, 0, 1) !== 0) Atomics.wait(flags, 0, 1, 5)
  try {
    if (Atomics.load(flags, 1) !== 0) return
    const bytes = Buffer.from(text)
    let offset = 0
    while (offset < bytes.length) {
      try {
        offset += fs.writeSync(1, bytes, offset)
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EAGAIN") throw error
        Atomics.wait(flags, 1, 0, 5)
      }
    }
  } finally {
    Atomics.store(flags, 0, 0)
    Atomics.notify(flags, 0)
  }
}

async function finish() {
  if (done || !reader) return
  done = true
  clearTimeout(escape)
  const rest = [intake.rest(), ...(await reader.stop())]
  const bytes = new Uint8Array(rest.reduce((total, chunk) => total + chunk.length, 0))
  rest.reduce((offset, chunk) => {
    bytes.set(chunk, offset)
    return offset + chunk.length
  }, 0)
  write(StartupFrame.relinquish)
  post({ type: "handover", snapshot: editor.snapshot(), bytes }, [bytes.buffer])
}

async function quit() {
  if (done || !reader) return
  done = true
  clearTimeout(escape)
  await reader.stop()
  post({ type: "quit" })
}

function fail(error: unknown) {
  throw error instanceof Error ? error : new Error(String(error))
}

function post(reply: Reply, transfer: ArrayBuffer[] = []) {
  port.postMessage(reply, transfer)
}

port.on("message", (request: Request) => {
  if (request.type === "resize") {
    size = { width: request.width, height: request.height }
    return paint()
  }
  if (request.type === "status") {
    status = request.text
    return paint()
  }
  if (request.type === "handover") return settle(intake.request())
})

if (reader) {
  paint()
  post({ type: "ready" })
}
