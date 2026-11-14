import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Database } from "bun:sqlite"
import { Event } from "@opencode/schema/event"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import path from "node:path"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const RecoveryResponse = Schema.Struct({ data: Session.Recovery })
const CreatedResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const setup = (boot: ServerFetch.BootOptions = {}) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const filename = path.join(tmp.path, "recovery.db")
    const options = {
      app: { version: "recovery-test" },
      database: { path: filename },
      events: { persist: false },
      config: { project: false, claude: false, content: "{}" },
      fs: { filewatcher: false, fff: false },
      models: { fetch: false },
    }
    const first = yield* ServerFetch.make(options, boot)
    const second = yield* ServerFetch.make(options)
    const request = (handler: typeof first) => (method: string, route: string, body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(new URL(route, "http://recovery.local"), {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    const one = request(first)
    const two = request(second)
    const created = yield* one("POST", "/api/session", { title: "Recovery fixture", location: { directory: tmp.path } })
    expect(created.status).toBe(200)
    const session = Schema.decodeUnknownSync(CreatedResponse)(yield* Effect.promise(() => created.json())).data
    const route = `/api/session/${session.id}`
    const observe = () =>
      one("GET", `/api/experimental/session/${session.id}/recovery`).pipe(
        Effect.flatMap((response) => Effect.promise(() => response.json())),
        Effect.map(Schema.decodeUnknownSync(RecoveryResponse)),
        Effect.map((response) => response.data),
      )
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new Database(filename, { readonly: true })),
      (db) => Effect.sync(() => db.close()),
    )
    return { one, two, route, observe, db, session, handler: first }
  })

it.live("HTTP recovery guards retain typed refusal fields and support bodyless unguarded interruption", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const initial = yield* fixture.observe()
    expect(initial).toMatchObject({
      throughSeq: -1,
      assistantMessageID: null,
      idleMessageID: null,
      executionID: null,
      executionClaim: null,
      localActive: false,
      pendingInput: false,
    })
    const ordinary = yield* fixture.one("POST", `${fixture.route}/interrupt`)
    expect(ordinary.status).toBe(200)
    expect(yield* Effect.promise(() => ordinary.json())).toEqual({ interrupted: false })
    const empty = yield* fixture.one("POST", `${fixture.route}/interrupt?resume=true`, {})
    expect(empty.status).toBe(200)
    expect(yield* Effect.promise(() => empty.json())).toEqual({ interrupted: false })
    const client = OpenCode.make({
      baseUrl: "http://recovery.local",
      fetch: Object.assign(
        (input: string | URL | Request, init?: RequestInit) => fixture.handler(new Request(input, init)),
        { preconnect: fetch.preconnect },
      ),
    })
    expect(
      yield* Effect.promise(() => client.session.interrupt({ sessionID: fixture.session.id, resume: true })),
    ).toEqual({ interrupted: false })
    expect(
      yield* Effect.promise(() => client.experimental.session.recovery({ sessionID: fixture.session.id })),
    ).toEqual(initial)

    const refused = yield* fixture.one("POST", `${fixture.route}/interrupt?resume=true`, {
      experimental: { expected: { executionID: Event.ID.create(), inputRevision: initial.inputRevision } },
    })

    expect(refused.status).toBe(409)
    expect(yield* Effect.promise(() => refused.json())).toEqual({
      _tag: "Session.InterruptGuardError",
      accepted: false,
      interrupted: false,
      reason: "execution-changed",
      sessionID: fixture.session.id,
    })
    expect(yield* fixture.observe()).toEqual(initial)
    for (const expected of [{ executionID: Event.ID.create() }, { inputRevision: initial.inputRevision }]) {
      expect((yield* fixture.one("POST", `${fixture.route}/interrupt`, { experimental: { expected } })).status).toBe(
        400,
      )
    }
  }),
)

for (const promoted of [false, true]) {
  it.live(
    `conditional admission reconciles an ID ${promoted ? "promoted" : "admitted"} on another connection during preparation`,
    () =>
      Effect.gen(function* () {
        const context = yield* Layer.build(LayerNode.compile(PluginHooks.node))
        const hooks = Context.get(context, PluginHooks.Service)
        const prepared = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        yield* hooks.register("session", "prompt", () =>
          Deferred.succeed(prepared, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        const fixture = yield* setup({
          overrides: [PluginHooks.node.replace(Layer.succeed(PluginHooks.Service, hooks))],
        })
        const expected = yield* fixture.observe()
        const id = SessionMessage.ID.create()
        const pending = yield* fixture
          .one("POST", `${fixture.route}/prompt`, {
            id,
            text: "losing payload",
            resume: false,
            experimental: { expected },
          })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(prepared)
        expect(
          (yield* fixture.two("POST", `${fixture.route}/prompt`, { id, text: "first admission", resume: false }))
            .status,
        ).toBe(200)
        if (promoted) {
          const seq = Schema.decodeUnknownSync(Schema.Struct({ seq: Schema.Int }))(
            fixture.db.query("SELECT seq FROM event_sequence WHERE aggregate_id = ?").get(fixture.session.id),
          ).seq
          expect(
            (yield* fixture.two("POST", "/api/experimental/event/replay", {
              event: {
                id: Event.ID.create(),
                type: "session.inbox.delivered.1",
                seq: seq + 1,
                created: 1,
                aggregateID: fixture.session.id,
                data: { sessionID: fixture.session.id, inboxID: id },
              },
            })).status,
          ).toBe(204)
        }

        yield* Deferred.succeed(release, undefined)
        const response = yield* Fiber.join(pending)

        expect(response.status).toBe(200)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          data: { id, payload: { text: "first admission" } },
        })
      }),
    // Cold boots and closes two complete server graphs over one file-backed database.
    { timeout: 15_000 },
  )
}

it.live("two database connections accept only one conditional prompt for the same idle snapshot", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const expected = yield* fixture.observe()
    const responses = yield* Effect.all(
      [fixture.one, fixture.two].map((request) =>
        request("POST", `${fixture.route}/prompt`, {
          id: SessionMessage.ID.create(),
          text: "winner",
          resume: false,
          experimental: { expected },
        }),
      ),
      { concurrency: 2 },
    )

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const refused = responses.find((response) => response.status === 409)
    if (!refused) throw new Error("Expected one refusal")
    expect(yield* Effect.promise(() => refused.json())).toMatchObject({
      _tag: "Session.PromptGuardError",
      accepted: false,
      reason: "not-idle",
      sessionID: fixture.session.id,
    })
    expect(
      fixture.db.query("SELECT count(*) AS total FROM session_inbox WHERE session_id = ?").get(fixture.session.id),
    ).toEqual({ total: 1 })
    expect(fixture.db.query("SELECT count(*) AS total FROM event").get()).toEqual({ total: 0 })
    expect((yield* fixture.observe()).pendingInput).toBe(true)
  }),
)

it.live("sequence-only persistence detects admit then cancel despite empty inbox and unchanged history", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const expected = yield* fixture.observe()
    const id = SessionMessage.ID.create()
    expect((yield* fixture.one("POST", `${fixture.route}/prompt`, { id, text: "cancel", resume: false })).status).toBe(
      200,
    )
    expect((yield* fixture.one("DELETE", `${fixture.route}/inbox/${id}`)).status).toBe(204)

    const response = yield* fixture.two("POST", `${fixture.route}/prompt`, {
      id,
      text: "stale retry",
      resume: false,
      experimental: { expected },
    })

    expect(response.status).toBe(409)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "Session.PromptGuardError",
      accepted: false,
      reason: "input-changed",
    })
    const current = yield* fixture.observe()
    expect(current.pendingInput).toBe(false)
    expect(current.throughSeq).toBe(expected.throughSeq)
    expect(current.inputRevision).not.toEqual(expected.inputRevision)
    expect(fixture.db.query("SELECT count(*) AS total FROM event").get()).toEqual({ total: 0 })
  }),
)
