import { expect, test } from "bun:test"

const moduleURL = new URL("../../src/provider/meridian-attribution.ts", import.meta.url).href

async function dispatch(input: {
  readonly target: string
  readonly endpoints?: string
  readonly sessionID?: string
  readonly method?: "POST" | "GET"
  readonly headers?: Record<string, string>
  readonly proxy?: string
  readonly proxyEnv?: Record<string, string>
}) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import { MeridianAttribution } from ${JSON.stringify(moduleURL)}
    const input = ${JSON.stringify(input)}
    const attribution = MeridianAttribution.request({
      purpose: "title", sessionID: input.sessionID, version: "1.19.5-vt-42-abc+fixture",
    })
    const send = attribution ? MeridianAttribution.wrapFetch(fetch, attribution) : fetch
    const result = await send(new Request(input.target, { method: input.method ?? "POST", headers: input.headers }),
      input.proxy ? { proxy: input.proxy } : undefined)
    await result.body?.cancel()
  `], {
    env: {
      ...input.proxyEnv,
      ...(input.endpoints === undefined ? {} : { VIBETERM_MERIDIAN_ATTRIBUTION_ENDPOINTS: input.endpoints }),
    },
    stdout: "ignore",
    stderr: "pipe",
  })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  return { code, stderr }
}

function receiver(response: (request: Request) => Response = () => new Response(null, { status: 204 })) {
  const seen: { readonly client: string | null; readonly purpose: string | null; readonly session: string | null }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seen.push({
        client: request.headers.get("x-meridian-client"),
        purpose: request.headers.get("x-meridian-purpose"),
        session: request.headers.get("x-meridian-session"),
      })
      return response(request)
    },
  })
  return { server, seen, [Symbol.asyncDispose]: () => server.stop(true) }
}

const sessionCases: readonly { resource: string; headers: Record<string, string>; expected: string | null }[] = [
  { resource: "/mounted/v1/messages", headers: {}, expected: "ses_title" },
  { resource: "/v1/messages", headers: { "X-OpenCode-Session": "ses_adapter", "x-meridian-session": "ses_inherited" }, expected: null },
  { resource: "/v1/messages", headers: { "x-session-affinity": "ses_adapter" }, expected: null },
  { resource: "/v1/chat/completions", headers: { "X-Session-ID": "ses_adapter" }, expected: null },
  { resource: "/v1/responses", headers: { "x-opencode-session-id": "ses_unrecognized" }, expected: "ses_title" },
]

test.each(sessionCases)(
  "attributes an exact POST to $resource without replacing a recognized session mapping",
  async ({ resource, headers, expected }) => {
    await using target = receiver()
    const endpoint = new URL(resource, target.server.url).href
    expect(await dispatch({ target: endpoint, endpoints: JSON.stringify([endpoint]), headers, sessionID: "ses_title" })).toEqual({
      code: 0,
      stderr: "",
    })
    expect(target.seen).toEqual([{ client: "opencode/1.19.5-vt-42-abc+fixture", purpose: "title", session: expected }])
  },
)

test("attributes the bare /messages path an Anthropic base without /v1 posts to", async () => {
  await using target = receiver()
  const endpoint = new URL("/messages", target.server.url).href
  const endpoints = JSON.stringify(["http://meridian-proxy.localhost:3450/messages", endpoint, "http://127.0.0.1:3457/v1/responses"])
  const result = await dispatch({ target: endpoint, endpoints, headers: { "x-session-affinity": "ses_adapter" } })
  expect(result).toEqual({ code: 0, stderr: "" })
  expect(target.seen).toEqual([{ client: "opencode/1.19.5-vt-42-abc+fixture", purpose: "title", session: null }])
})

test("does not send an inherited or invalid fallback session when the trusted request has no adapter mapping", async () => {
  await using target = receiver()
  const endpoint = new URL("/v1/messages", target.server.url).href
  const result = await dispatch({
    target: endpoint, endpoints: JSON.stringify([endpoint]), sessionID: "has whitespace",
    headers: { "x-meridian-session": "ses_inherited" },
  })
  expect(result.code).toBe(0)
  expect(target.seen).toEqual([{ client: "opencode/1.19.5-vt-42-abc+fixture", purpose: "title", session: null }])
})

test.each(["no opt-in", "wrong path", "different port", "GET", "IPv4 alias", "bad entry", "empty query"] as const)(
  "leaves a request unattributed for %s",
  async (scenario) => {
    await using target = receiver()
    await using other = receiver()
    const endpoint = new URL("/v1/messages", target.server.url).href
    const actual = scenario === "wrong path" ? `${endpoint}-lookalike` : endpoint
    const trusted = scenario === "different port" ? new URL("/v1/messages", other.server.url).href : endpoint
    const endpoints = scenario === "no opt-in" ? undefined : JSON.stringify(
      scenario === "bad entry" ? [trusted, "http://meridian.example/v1/messages"] :
      scenario === "IPv4 alias" ? [trusted.replace("127.0.0.1", "127.1")] :
      scenario === "empty query" ? [`${trusted}?`] : [trusted],
    )
    expect(await dispatch({ target: actual, endpoints, method: scenario === "GET" ? "GET" : "POST" })).toEqual({
      code: 0,
      stderr: "",
    })
    expect(target.seen).toEqual([{ client: null, purpose: null, session: null }])
    expect(other.seen).toEqual([])
  },
)

test.each([true, false])("redirects only with no attribution (opted in: %s)", async (optedIn) => {
  await using other = receiver()
  await using target = receiver(() => Response.redirect(new URL("/v1/messages", other.server.url), 307))
  const endpoint = new URL("/v1/messages", target.server.url).href
  const result = await dispatch({ target: endpoint, endpoints: optedIn ? JSON.stringify([endpoint]) : undefined })
  expect(target.seen.map((entry) => entry.purpose)).toEqual([optedIn ? "title" : null])
  if (optedIn) {
    expect(result.code).toBe(1)
    expect(other.seen).toEqual([])
    return
  }
  expect(result.code).toBe(0)
  expect(other.seen).toEqual([{ client: null, purpose: null, session: null }])
})

test.each(["ambient", "lowercase no_proxy wins", "non-ASCII separator", "explicit", "exact bypass", "wildcard bypass"] as const)(
  "keeps attribution off the cleartext proxy hop: %s",
  async (scenario) => {
    await using target = receiver()
    await using proxy = receiver()
    const endpoint = new URL("/v1/messages", target.server.url).href
    const bypasses = scenario === "exact bypass" || scenario === "wildcard bypass"
    const noProxy = scenario === "exact bypass" ? target.server.url.host : "*"
    const result = await dispatch({
      target: endpoint,
      endpoints: JSON.stringify([endpoint]),
      sessionID: "ses_title",
      proxy: scenario === "explicit" ? proxy.server.url.href : undefined,
      proxyEnv: {
        ...(scenario === "explicit" ? {} : { HTTP_PROXY: proxy.server.url.href }),
        ...(bypasses ? { NO_PROXY: noProxy } : {}),
        ...(scenario === "lowercase no_proxy wins" ? { no_proxy: "localhost", NO_PROXY: "*" } : {}),
        ...(scenario === "non-ASCII separator" ? { NO_PROXY: "\u00a0*" } : {}),
      },
    })
    expect(result).toEqual({ code: 0, stderr: "" })
    expect(proxy.seen).toEqual(bypasses ? [] : [{ client: null, purpose: null, session: null }])
    expect(target.seen).toEqual(bypasses
      ? [{ client: "opencode/1.19.5-vt-42-abc+fixture", purpose: "title", session: "ses_title" }]
      : [])
  },
)

// 2026-11-25: desktop's Claude provider points at Meridian with a base that has no path, so no Claude request was tagged.
test.each([
  { base: "http://127.0.0.1:3450", sdk: "@ai-sdk/anthropic", expected: true },
  { base: "http://127.0.0.1:3450/", sdk: "@ai-sdk/anthropic", expected: true },
  { base: "http://127.0.0.1:3457/v1", sdk: "@ai-sdk/openai", expected: true },
  { base: "http://127.0.0.1:3457/v1/", sdk: "@ai-sdk/openai", expected: true },
  { base: "http://127.0.0.1:3459", sdk: "@ai-sdk/anthropic", expected: false },
])("matches $base for $sdk against the trusted list: $expected", async ({ base, sdk, expected }) => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import { MeridianAttribution } from ${JSON.stringify(moduleURL)}
    process.stdout.write(String(MeridianAttribution.matchesBase(${JSON.stringify(base)}, ${JSON.stringify(sdk)})))
  `], {
    env: {
      VIBETERM_MERIDIAN_ATTRIBUTION_ENDPOINTS: JSON.stringify([
        "http://127.0.0.1:3450/messages",
        "http://127.0.0.1:3457/v1/responses",
      ]),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()])
  expect({ code, stdout }).toEqual({ code: 0, stdout: String(expected) })
})
