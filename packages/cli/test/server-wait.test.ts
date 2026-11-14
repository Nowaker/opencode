import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { it } from "../../core/test/lib/effect"
import { waitForServer } from "../src/services/server-wait"
import { OPENCODE_VERSION } from "../src/version"

const endpoint = { url: "http://127.0.0.1:43210/owner" }
const health = { version: OPENCODE_VERSION, pid: 1, urls: [], paths: { tmp: "/var/tmp" } }
const session = {
  id: "ses_reserved",
  projectID: "project",
  location: { directory: "/project" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
}

function transport(handle: (request: Request, signal: AbortSignal) => Response | Promise<Response>): typeof fetch {
  return Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      return Promise.resolve(handle(request, init?.signal ?? request.signal))
    },
    {
      preconnect: fetch.preconnect,
    },
  )
}

it.effect(
  "startup waits for the exact prefixed owner and reserved session without creating anything",
  Effect.gen(function* () {
    const paths: string[] = []
    const wire = transport((request) => {
      paths.push(`${request.method} ${request.url}`)
      if (paths.length === 1) throw Object.assign(new Error("not listening"), { code: "ECONNREFUSED" })
      if (paths.length === 2)
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) })
      if (paths.length === 3) return new Response("starting", { status: 503 })
      if (paths.length === 4) return Response.json(health)
      if (paths.length === 5)
        return Response.json(
          { _tag: "SessionNotFoundError", sessionID: session.id, message: "reserved" },
          { status: 404 },
        )
      return Response.json({ data: session })
    })
    const fiber = yield* waitForServer(endpoint, 1000, session.id).pipe(
      Effect.provideService(FetchHttpClient.Fetch, wire),
      Effect.forkChild({ startImmediately: true }),
    )
    yield* TestClock.adjust(400)
    expect((yield* Fiber.join(fiber)).version).toBe(OPENCODE_VERSION)
    expect(paths).toEqual([
      `GET ${endpoint.url}/api/info`,
      `GET ${endpoint.url}/api/info`,
      `GET ${endpoint.url}/api/info`,
      `GET ${endpoint.url}/api/info`,
      `GET ${endpoint.url}/api/session/${session.id}`,
      `GET ${endpoint.url}/api/session/${session.id}`,
    ])
  }),
)

it.effect(
  "one total deadline includes info retries and cancels a pending reserved-session request",
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>()
    let attempts = 0
    let aborted = false
    const wire = transport((request, signal) => {
      if (new URL(request.url).pathname.endsWith("/info")) {
        attempts++
        return attempts === 1 ? new Response("starting", { status: 503 }) : Response.json(health)
      }
      Deferred.doneUnsafe(arrived, Effect.void)
      return new Promise<Response>((_, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(signal.reason)
          },
          { once: true },
        ),
      )
    })
    const fiber = yield* waitForServer(endpoint, 1000, session.id).pipe(
      Effect.provideService(FetchHttpClient.Fetch, wire),
      Effect.forkChild({ startImmediately: true }),
    )
    yield* TestClock.adjust(100)
    yield* Deferred.await(arrived)
    yield* TestClock.adjust(899)
    expect(fiber.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust(1)
    const exit = fiber.pollUnsafe()
    expect(exit).toBeDefined()
    if (exit === undefined) return yield* Fiber.interrupt(fiber)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("ServerWaitTimeout")
    expect(aborted).toBe(true)
    expect(attempts).toBe(2)
  }),
)

for (const refusal of [
  {
    name: "authentication",
    response: () => Response.json({ _tag: "UnauthorizedError", message: "password required" }, { status: 401 }),
  },
  { name: "protocol", response: () => Response.json({}) },
  { name: "forbidden", response: () => new Response("forbidden", { status: 403 }) },
]) {
  it.effect(
    `${refusal.name} refusal ends without retry`,
    Effect.gen(function* () {
      let attempts = 0
      const wire = transport(() => {
        attempts++
        return refusal.response()
      })
      const result = yield* waitForServer(endpoint, 1000).pipe(
        Effect.provideService(FetchHttpClient.Fetch, wire),
        Effect.exit,
      )
      expect(Exit.isFailure(result)).toBe(true)
      expect(attempts).toBe(1)
    }),
  )
}

it.live(
  "startup refuses an owner redirect without contacting another engine",
  Effect.gen(function* () {
    let alternateRequests = 0
    const alternate = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        alternateRequests++
        return Response.json(health)
      },
    })
    const owner = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.redirect(new URL("/api/info", alternate.url), 302),
    })
    try {
      const result = yield* waitForServer({ url: owner.url.toString() }, 1000).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect(alternateRequests).toBe(0)
    } finally {
      yield* Effect.promise(() => owner.stop(true))
      yield* Effect.promise(() => alternate.stop(true))
    }
  }),
)

it.effect(
  "interruption aborts the owned info request and leaves no retry",
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>()
    let aborted = false
    let attempts = 0
    const wire = transport((request, signal) => {
      attempts++
      Deferred.doneUnsafe(arrived, Effect.void)
      return new Promise<Response>((_, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(signal.reason)
          },
          { once: true },
        ),
      )
    })
    const fiber = yield* waitForServer(endpoint, 1000).pipe(
      Effect.provideService(FetchHttpClient.Fetch, wire),
      Effect.forkChild({ startImmediately: true }),
    )
    yield* Deferred.await(arrived)
    yield* Fiber.interrupt(fiber)
    yield* TestClock.adjust(2000)
    expect(aborted).toBe(true)
    expect(attempts).toBe(1)
  }),
)
