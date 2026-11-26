import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const worker = fileURLToPath(new URL("./fixture/meridian-attribution.ts", import.meta.url))
const build = "2.1.0-vt+fixture"
const chat = "/trusted/v1/chat/completions"
const messages = "/trusted/v1/messages"
const responses = "/trusted/v1/responses"
const fallback = "/ws-fallback/v1/responses"
const direct = "/direct/v1/chat/completions"
const compact = `${responses}/compact`

const fixture = () => {
  const seen: Array<{
    readonly path: string
    readonly upgrade: string | null
    readonly client: string | null
    readonly purpose: string | null
    readonly session: string | null
    readonly affinity: string | null
    readonly source: string | null
    readonly device: string | null
  }> = []
  const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "fixture-checkpoint" }
  const eventStream = (data: unknown) =>
    new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`, {
      headers: { "content-type": "text/event-stream" },
    })
  const server = Bun.serve<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, current) {
      const path = new URL(request.url).pathname
      const upgrade = request.headers.get("upgrade")
      seen.push({
        path,
        upgrade,
        client: request.headers.get("x-meridian-client"),
        purpose: request.headers.get("x-meridian-purpose"),
        session: request.headers.get("x-meridian-session"),
        affinity: request.headers.get("x-opencode-session"),
        source: request.headers.get("x-meridian-source"),
        device: request.headers.get("x-meridian-device"),
      })
      if (path === "/trusted-redirect/v1/chat/completions")
        return new Response(null, { status: 307, headers: { location: direct } })
      if (path === "/direct-redirect/v1/chat/completions")
        return new Response(null, { status: 307, headers: { location: chat } })
      if (path === compact) return Response.json({ object: "response.compaction", output: [checkpoint] })
      if (path === responses && upgrade === "websocket" && current.upgrade(request)) return
      if (path === fallback) {
        if (upgrade === "websocket") return new Response(null, { status: 503 })
        return eventStream({ type: "response.completed", response: { id: "resp_http", output: [] } })
      }
      if (path === responses)
        return eventStream({ type: "response.completed", response: { id: "resp_fixture", output: [checkpoint] } })
      if (path === messages || path === "/messages") {
        const events = [
          {
            type: "message_start",
            message: {
              id: "msg_fixture",
              type: "message",
              role: "assistant",
              model: "fixture",
              content: [],
              usage: { input_tokens: 2, output_tokens: 0 },
            },
          },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 1 },
          },
          { type: "message_stop" },
        ]
        return new Response(
          events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
          {
            headers: { "content-type": "text/event-stream" },
          },
        )
      }
      return eventStream({
        id: "completion",
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture",
        choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }],
      })
    },
    websocket: {
      message(socket) {
        socket.send(JSON.stringify({ type: "response.created", response: { id: "resp_ws" } }))
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_ws", output: [] } }))
      },
    },
  })

  const endpoint = (path: string) => new URL(path, server.url).href
  const run = async (mode: string, allowlist: string, version = build, environment?: Record<string, string>) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", worker, server.url.href, mode, version], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
      env: {
        PATH: process.env["PATH"],
        SYSTEMROOT: process.env["SYSTEMROOT"],
        VIBETERM_MERIDIAN_ATTRIBUTION_ENDPOINTS: allowlist,
        ...environment,
      },
      timeout: 15_000,
    })
    const [error, code] = await Promise.all([child.stderr.text(), child.exited])
    expect(error).toBe("")
    expect(code).toBe(0)
  }
  return { seen, endpoint, run, [Symbol.asyncDispose]: async () => void (await server.stop(true)) }
}

test("native session producers use their own purposes and preserve Meridian affinity", async () => {
  await using proxy = fixture()
  await proxy.run("tagged-calls", JSON.stringify([proxy.endpoint(chat)]))
  expect(proxy.seen.map((entry) => entry.purpose)).toEqual([
    "chat",
    "title",
    "compaction",
    "subagent",
    "helper",
    "helper",
  ])
  expect(proxy.seen.map((entry) => entry.client)).toEqual(Array.from({ length: 6 }, () => `opencode/${build}`))
  expect(proxy.seen.map((entry) => entry.session)).toEqual(Array.from({ length: 6 }, () => null))
  expect(proxy.seen.slice(0, 5).map((entry) => entry.affinity)).toEqual(Array.from({ length: 5 }, () => "ses_fixture"))
  expect(proxy.seen.at(-1)?.affinity).toMatch(/^ses_/)
  expect(proxy.seen.map((entry) => entry.source)).toEqual(Array.from({ length: 6 }, () => "legacy"))
})

test.each([
  ["direct", direct],
  ["hook-rewrite", direct],
  ["custom-request-fetch", chat],
  ["custom-host-fetch", chat],
  ["endpoint", compact],
] as const)("does not attach producer attribution on the %s path", async (mode, path) => {
  await using proxy = fixture()
  await proxy.run(mode, JSON.stringify([proxy.endpoint(chat), proxy.endpoint(responses)]))
  expect(proxy.seen).toMatchObject([{ path, client: null, purpose: null, session: null }])
})

test.each(["websocket", "websocket-fallback"] as const)(
  "omits attribution on the upgrade and tags only an actual HTTP fallback (%s)",
  async (mode) => {
    await using proxy = fixture()
    const path = mode === "websocket" ? responses : fallback
    await proxy.run(mode, JSON.stringify([proxy.endpoint(path)]))
    const upgrade = { path, upgrade: "websocket", client: null, purpose: null }
    expect(proxy.seen).toMatchObject(
      mode === "websocket"
        ? [upgrade]
        : [upgrade, { path, upgrade: null, client: `opencode/${build}`, purpose: "chat" }],
    )
  },
)

test("tags trigger compaction when its native transport sends the Responses POST", async () => {
  await using proxy = fixture()
  await proxy.run("trigger", JSON.stringify([proxy.endpoint(responses)]))
  expect(proxy.seen).toMatchObject([{ path: responses, client: `opencode/${build}`, purpose: "compaction" }])
})

test("tags the bare /messages route an Anthropic base without /v1 posts to", async () => {
  await using proxy = fixture()
  await proxy.run("bare-messages", JSON.stringify([proxy.endpoint("/messages"), proxy.endpoint(messages)]))
  expect(proxy.seen).toMatchObject([{ path: "/messages", client: `opencode/${build}`, purpose: "chat" }])
})

test.each([
  { device: "desktop", sent: "desktop" },
  { device: "Desktop.local", sent: null },
  { device: "", sent: null },
] as const)("sends the launcher's machine short name $device as x-meridian-device only when it is valid", async ({ device, sent }) => {
  await using proxy = fixture()
  await proxy.run("messages", JSON.stringify([proxy.endpoint(messages)]), build, { VIBETERM_MERIDIAN_ATTRIBUTION_DEVICE: device })
  expect(proxy.seen).toMatchObject([{ path: messages, client: `opencode/${build}`, device: sent }])
})

test("tags the native Anthropic Messages route used by Meridian", async () => {
  await using proxy = fixture()
  await proxy.run("messages", JSON.stringify([proxy.endpoint(messages)]))
  expect(proxy.seen).toMatchObject([{ path: messages, client: `opencode/${build}`, purpose: "chat" }])
})

test.each(["ambient", "exact bypass", "non-ASCII separator", "lowercase wins", "quoted-empty lowercase"] as const)(
  "preserves cleartext proxy routing without leaking attribution (%s)",
  async (scenario) => {
    await using target = fixture()
    await using intermediary = fixture()
    const url = target.endpoint(chat)
    const bypass = scenario === "exact bypass" || scenario === "quoted-empty lowercase"
    await target.run("plain", JSON.stringify([url]), build, {
      HTTP_PROXY: intermediary.endpoint("/"),
      ...(scenario === "exact bypass" ? { no_proxy: new URL(url).host } : {}),
      ...(scenario === "non-ASCII separator" ? { NO_PROXY: "\u00a0*" } : {}),
      ...(scenario === "lowercase wins" ? { no_proxy: "localhost", NO_PROXY: "*" } : {}),
      ...(scenario === "quoted-empty lowercase" ? { no_proxy: '""', NO_PROXY: "*" } : {}),
    })
    expect(intermediary.seen.map((entry) => [entry.client, entry.purpose])).toEqual(bypass ? [] : [[null, null]])
    expect(target.seen.map((entry) => [entry.client, entry.purpose])).toEqual(
      bypass ? [[`opencode/${build}`, "chat"]] : [],
    )
  },
)

test.each(["trusted-redirect", "direct-redirect"] as const)(
  "only rejects redirects on an attributed initial POST (%s)",
  async (mode) => {
    await using proxy = fixture()
    const trusted = "/trusted-redirect/v1/chat/completions"
    await proxy.run(mode, JSON.stringify([proxy.endpoint(trusted), proxy.endpoint(chat)]))
    expect(proxy.seen).toMatchObject(
      mode === "trusted-redirect"
        ? [{ path: trusted, client: `opencode/${build}`, purpose: "chat" }]
        : [
            { path: "/direct-redirect/v1/chat/completions", client: null, purpose: null },
            { path: chat, client: null, purpose: null },
          ],
    )
  },
)

test.each([
  { name: "empty allowlist", allow: () => "", version: build },
  {
    name: "invalid member beside a valid entry",
    allow: (url: string) => JSON.stringify([url, `${url}?`]),
    version: build,
  },
  {
    name: "noncanonical IPv4 member beside a valid entry",
    allow: (url: string) => JSON.stringify([url, url.replace("127.0.0.1", "127.1")]),
    version: build,
  },
  { name: "invalid build", allow: (url: string) => JSON.stringify([url]), version: "bad build" },
] as const)("leaves a matching path untagged with $name", async (setting) => {
  await using proxy = fixture()
  await proxy.run("plain", setting.allow(proxy.endpoint(chat)), setting.version)
  expect(proxy.seen).toMatchObject([{ path: chat, client: null, purpose: null }])
})
