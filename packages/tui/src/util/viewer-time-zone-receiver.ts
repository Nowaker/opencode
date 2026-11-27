import { createConnection, type Socket } from "node:net"
import { isAbsolute, normalize } from "node:path"
import { setViewerTimeZone } from "./viewer-time-zone"

const firstFrameMs = 5_000
const freshnessMs = 20_000
const initialRetryMs = 250
const maxRetryMs = 5_000
const maxFrameBytes = 512

export function startViewerTimeZoneReceiver(env: NodeJS.ProcessEnv = process.env) {
  const path = env.VIBETERM_VIEWER_TIME_ZONE_SOCKET
  if (!path || process.platform === "win32" || !socketPath(path)) return
  const scope = tmuxScope(env.TMUX, env.TMUX_PANE)
  if (!scope || normalize(scope.path) === normalize(path)) return

  const subscribe =
    JSON.stringify({ consumer: "viewer-time-zone", version: 1, pane: scope.pane, expectedPid: scope.pid }) + "\n"
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
  let socket: Socket | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let retryMs = initialRetryMs
  let disposed = false

  function close() {
    clearTimeout(deadline)
    const current = socket
    socket = undefined
    current?.destroy()
    setViewerTimeZone(undefined)
  }

  const connect = () => {
    if (disposed) return
    const current = createConnection({ path })
    socket = current
    current.unref()
    let pending: Buffer | undefined
    function disconnect() {
      if (socket !== current) return
      close()
      if (disposed) return
      retry = setTimeout(connect, retryMs).unref()
      retryMs = Math.min(retryMs * 2, maxRetryMs)
    }

    deadline = setTimeout(disconnect, firstFrameMs).unref()
    current.once("connect", () => {
      if (socket !== current) return
      current.unref()
      current.write(subscribe)
    })
    current.on("error", disconnect)
    current.once("end", disconnect)
    current.once("close", disconnect)
    current.on("data", (chunk: Buffer) => {
      let start = 0
      while (start < chunk.length && socket === current) {
        const end = chunk.indexOf(10, start)
        const fragment = chunk.subarray(start, end === -1 ? chunk.length : end)
        if ((pending?.length ?? 0) + fragment.length > maxFrameBytes) return disconnect()
        if (end === -1) {
          pending = pending ? Buffer.concat([pending, fragment]) : Buffer.from(fragment)
          return
        }

        const value = decodeFrame(decoder, pending ? Buffer.concat([pending, fragment]) : fragment)
        if (value === undefined || !setViewerTimeZone(value)) return disconnect()
        if (socket !== current) return
        pending = undefined
        retryMs = initialRetryMs
        clearTimeout(deadline)
        deadline = setTimeout(disconnect, freshnessMs).unref()
        start = end + 1
      }
    })
  }

  connect()
  return () => {
    if (disposed) return
    disposed = true
    clearTimeout(retry)
    close()
  }
}

function socketPath(path: string) {
  // An overlong sockaddr_un path can be truncated and connect to a different socket.
  return (
    isAbsolute(path) &&
    !path.endsWith("/") &&
    !path.includes("\0") &&
    Buffer.byteLength(path) <= (process.platform === "linux" ? 107 : 103)
  )
}

function tmuxScope(tmux: string | undefined, pane: string | undefined) {
  if (!tmux || !pane?.startsWith("%") || decimal(pane.slice(1)) === undefined) return
  const sessionSeparator = tmux.lastIndexOf(",")
  const pidSeparator = tmux.lastIndexOf(",", sessionSeparator - 1)
  if (pidSeparator <= 0 || decimal(tmux.slice(sessionSeparator + 1)) === undefined) return
  const path = tmux.slice(0, pidSeparator)
  const pid = decimal(tmux.slice(pidSeparator + 1, sessionSeparator))
  if (!pid || !socketPath(path)) return
  return { path, pane, pid }
}

function decimal(value: string) {
  if (!value || /\D/.test(value)) return
  const number = Number(value)
  if (Number.isSafeInteger(number)) return number
}

function decodeFrame(decoder: TextDecoder, bytes: Buffer) {
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(bytes))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return
    throw error
  }
  if (!value || typeof value !== "object" || !("timeZone" in value)) return
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== "timeZone") return
  if (typeof value.timeZone === "string" || value.timeZone === null) return value.timeZone
}
