import { afterEach, expect, jest, test } from "bun:test"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { createComputed, createRoot } from "solid-js"
import { startViewerTimeZoneReceiver } from "../../src/util/viewer-time-zone-receiver"
import { setViewerTimeZone, viewerTimeZone } from "../../src/util/viewer-time-zone"

const unix = test.skipIf(process.platform === "win32")
const scope = { TMUX: "/tmp/tmux,with,commas,123,0", TMUX_PANE: "%7" }
const request = { consumer: "viewer-time-zone", version: 1, pane: "%7", expectedPid: 123 }

afterEach(() => {
  jest.useRealTimers()
  setViewerTimeZone(undefined)
})

async function bridge() {
  // Keep the socket path below the Unix address limit even with a nested TMPDIR.
  const dir = await mkdtemp("/tmp/opencode-zone-")
  const path = join(dir, "stream.sock")
  const peers = new Set<Socket>()
  let connections = 0
  const server = createServer((peer) => {
    connections++
    peers.add(peer)
    peer.once("close", () => peers.delete(peer))
  })
  await once(server.listen(path), "listening")
  return {
    path,
    server,
    env: { ...scope, VIBETERM_VIEWER_TIME_ZONE_SOCKET: path },
    get connections() {
      return connections
    },
    async [Symbol.asyncDispose]() {
      for (const peer of peers) peer.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function subscriber(server: Server) {
  const [connection] = await once(server, "connection", { signal: AbortSignal.timeout(2_000) })
  const peer: Socket = connection
  const lines = createInterface({ input: peer })
  try {
    const [line] = await once(lines, "line", { signal: AbortSignal.timeout(2_000) })
    expect(JSON.parse(line)).toEqual(request)
    return peer
  } finally {
    lines.close()
  }
}

async function nextZone(expected: string | undefined) {
  const signal = AbortSignal.timeout(2_000)
  const result = Promise.withResolvers<void>()
  const abort = () => result.reject(new Error(`timezone did not change to ${expected}`))
  signal.addEventListener("abort", abort)
  const dispose = createRoot((dispose) => {
    createComputed(() => {
      if (viewerTimeZone() === expected) result.resolve()
    })
    return dispose
  })
  try {
    await result.promise
  } finally {
    dispose()
    signal.removeEventListener("abort", abort)
  }
}

function connect(resident: Awaited<ReturnType<typeof bridge>>) {
  const peer = subscriber(resident.server)
  const stop = startViewerTimeZoneReceiver(resident.env)
  if (!stop) throw new Error("receiver rejected a valid socket scope")
  return { peer, stop, [Symbol.dispose]: stop }
}

async function sendZone(peer: Socket, value: string | null) {
  const applied = nextZone(value ?? undefined)
  peer.write(JSON.stringify({ timeZone: value }) + "\n")
  await applied
}

unix("initial and updated frames apply over one stream; null restores the process zone", async () => {
  await using resident = await bridge()
  using receiver = connect(resident)
  const peer = await receiver.peer

  const first = nextZone("Asia/Tokyo")
  peer.write('{"timeZo')
  peer.write('ne":"Asia/Tokyo"}\n')
  await first

  const update = nextZone("America/New_York")
  peer.write('{"timeZone":"Asia/Tokyo"}\n{"timeZone":"America/New_York"}\n')
  await update
  await sendZone(peer, null)
  expect(resident.connections).toBe(1)
})

unix("EOF clears the zone and a new subscription replays the current sample", async () => {
  await using resident = await bridge()
  using receiver = connect(resident)
  const peer = await receiver.peer
  await sendZone(peer, "Asia/Tokyo")

  const cleared = nextZone(undefined)
  const replay = subscriber(resident.server)
  peer.end()
  await cleared
  await sendZone(await replay, "Asia/Tokyo")
})

test("disabled or malformed configuration does not start a receiver", () => {
  const good = { ...scope, VIBETERM_VIEWER_TIME_ZONE_SOCKET: "/tmp/viewer-zone.sock" }
  const cases: ReadonlyArray<NodeJS.ProcessEnv> = [
    {},
    scope,
    { ...good, VIBETERM_VIEWER_TIME_ZONE_SOCKET: "viewer-zone.sock" },
    { ...good, VIBETERM_VIEWER_TIME_ZONE_SOCKET: "tcp://127.0.0.1:1234" },
    { ...good, VIBETERM_VIEWER_TIME_ZONE_SOCKET: "/tmp/zone\0.sock" },
    { ...good, VIBETERM_VIEWER_TIME_ZONE_SOCKET: "/tmp/" + "a".repeat(200) },
    { ...good, TMUX: "/tmp/viewer-zone.sock,123,0" },
    ...["", "123", "tmux,123,0", "/tmux,0,0", "/tmux,+1,0", "/tmux,9007199254740992,0", "/tmux,12,-1"].map(
      (TMUX) => ({ ...good, TMUX }),
    ),
    ...["", "7", "%-1", "%7\n", "%9007199254740992"].map((TMUX_PANE) => ({ ...good, TMUX_PANE })),
  ]
  for (const environment of cases) expect(startViewerTimeZoneReceiver(environment)).toBeUndefined()
  expect(viewerTimeZone()).toBeUndefined()
})

for (const [kind, frame] of Object.entries({
  "malformed JSON": "not-json\n",
  "missing field": "{}\n",
  "extra field": '{"timeZone":"UTC","session":"unused"}\n',
  "wrong field type": '{"timeZone":17}\n',
  "invalid zone": '{"timeZone":"Mars/Olympus"}\n',
  "UTC offset in place of a zone": '{"timeZone":"+05:45"}\n',
  "invalid UTF-8": Buffer.from([0x7b, 0xff, 0x7d, 0x0a]),
  "oversized incomplete frame": " ".repeat(4096),
  "oversized complete frame": " ".repeat(4096) + '{"timeZone":"UTC"}\n',
})) {
  unix(`${kind} drops the stream and clears the previous zone`, async () => {
    await using resident = await bridge()
    using receiver = connect(resident)
    const peer = await receiver.peer
    await sendZone(peer, "Asia/Tokyo")

    const closed = once(peer, "close", { signal: AbortSignal.timeout(2_000) })
    peer.write(frame)
    await closed
    expect(viewerTimeZone()).toBeUndefined()
  })
}

unix("a stream that never sends its first complete frame is replaced after five seconds", async () => {
  jest.useFakeTimers()
  await using resident = await bridge()
  using receiver = connect(resident)
  const peer = await receiver.peer
  const closed = once(peer, "close")

  jest.advanceTimersByTime(5_000)

  await closed
  expect(viewerTimeZone()).toBeUndefined()
  jest.advanceTimersByTime(5_000)
  const replacement = subscriber(resident.server)
  await sendZone(await replacement, "Asia/Tokyo")
})

unix("freshness expires twenty seconds after the last valid sample", async () => {
  jest.useFakeTimers()
  await using resident = await bridge()
  using receiver = connect(resident)
  const peer = await receiver.peer
  await sendZone(peer, "Asia/Tokyo")

  jest.advanceTimersByTime(19_999)
  expect(viewerTimeZone()).toBe("Asia/Tokyo")
  jest.advanceTimersByTime(1)
  expect(viewerTimeZone()).toBeUndefined()
})

unix("disposing clears the zone immediately and never reconnects", async () => {
  jest.useFakeTimers()
  await using resident = await bridge()
  using receiver = connect(resident)
  const peer = await receiver.peer
  await sendZone(peer, "Asia/Tokyo")
  const closed = once(peer, "close")
  peer.write('{"timeZone":"America/New_York"}\n')

  receiver.stop()

  expect(viewerTimeZone()).toBeUndefined()
  await closed
  const abort = new AbortController()
  const reconnected = once(resident.server, "connection", { signal: abort.signal })
  jest.advanceTimersByTime(30_000)
  jest.useRealTimers()
  const timeout = setTimeout(() => abort.abort(), 50)
  try {
    await expect(reconnected).rejects.toMatchObject({ name: "AbortError" })
  } finally {
    clearTimeout(timeout)
  }
  expect(viewerTimeZone()).toBeUndefined()
})

unix("an active timezone stream does not keep the Bun process alive", async () => {
  await using resident = await bridge()
  const connected = subscriber(resident.server)
  const child = Bun.spawn({
    cmd: [Bun.which("bun") ?? process.execPath, "-e", `
      import { createRoot, createComputed } from "solid-js"
      import { startViewerTimeZoneReceiver } from "./src/util/viewer-time-zone-receiver"
      import { viewerTimeZone } from "./src/util/viewer-time-zone"
      const gate = setTimeout(() => process.exit(77), 2000)
      startViewerTimeZoneReceiver()
      createRoot(() => createComputed(() => {
        if (viewerTimeZone() !== "Asia/Tokyo") return
        console.log("sample applied")
        clearTimeout(gate)
      }))
    `],
    env: { ...process.env, ...resident.env },
    stdout: "pipe",
    stderr: "inherit",
    signal: AbortSignal.timeout(3_000),
  })
  const peer = await connected
  peer.write('{"timeZone":"Asia/Tokyo"}\n')

  expect(await child.exited).toBe(0)
  expect(await Bun.readableStreamToText(child.stdout)).toBe("sample applied\n")
})
