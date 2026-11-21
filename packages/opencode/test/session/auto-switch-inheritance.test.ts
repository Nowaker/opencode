import { expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { AutoSwitch } from "@/session/auto-switch"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "../server/httpapi-layer"

const sessionLayer = LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node]))
const it = testEffect(sessionLayer)
const api = testEffect(Layer.merge(sessionLayer, httpApiLayer))

type PreferenceWrite = Parameters<Session.Interface["updateAutoSwitch"]>[0]
const savePreference = Effect.fnUntraced(function* (
  input: Omit<PreferenceWrite, "current" | "episode"> & Partial<Pick<PreferenceWrite, "episode">>,
) {
  const sessions = yield* Session.Service
  expect(yield* sessions.updateAutoSwitch({ ...input, episode: input.episode, current: () => Effect.succeed(true) })).toBe(
    true,
  )
})

it.instance("leaves a child on its own defaults when its coordinator parent was disabled by a rule", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const parent = yield* sessions.create({ title: "[coordinator] dispatch work" })
    yield* Effect.gen(function* () {
      expect(yield* AutoSwitch.read(sessions, parent.id)).toMatchObject({
        preference: "inherit",
        enabled: false,
        reason: "rule-off",
      })

      const child = yield* sessions.create({ parentID: parent.id, title: "Child's own title" })

      expect((yield* sessions.get(child.id)).metadata?.vibeterm?.autoSwitch).toBeUndefined()
      expect(yield* AutoSwitch.read(sessions, child.id)).toMatchObject({
        preference: "inherit",
        enabled: true,
        revision: 0,
      })
    }).pipe(
      Effect.provideService(AutoSwitch.Owner, () => parent.id),
      Effect.provideService(AutoSwitch.Policy, (input) => {
        const coordinator = input.title.startsWith("[coordinator]")
        return {
          enabled: !coordinator,
          reason: coordinator ? "rule-off" : "default-on",
          alternates: [],
          policyRevision: "test",
        }
      }),
    )
  }),
)

for (const fixture of [
  { preference: "off", returnPreference: "inherit", expected: { preference: "off" } },
  { preference: "on", returnPreference: "off", expected: { preference: "on", returnPreference: "off" } },
  { preference: "inherit", returnPreference: "on", expected: { preference: "inherit", returnPreference: "on" } },
] as const) {
  it.instance(`stores the child snapshot at creation for ${fixture.preference}/${fixture.returnPreference}`, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const parent = yield* sessions.create()
      yield* savePreference({ sessionID: parent.id, preference: "off", revision: 0 })
      yield* savePreference({
        sessionID: parent.id,
        preference: fixture.preference,
        returnPreference: fixture.returnPreference,
        revision: 1,
        episode: {
          sessionId: parent.id,
          turnID: "parent-turn",
          step: 0,
          state: "active",
          returnPending: true,
          at: 1,
          source: { agent: "build", providerID: "anthropic", modelID: "claude-opus-5-5", variant: "high" },
          target: { agent: "build", providerID: "openai", modelID: "gpt-6.2-sol", variant: "xhigh" },
        },
      })

      const child = yield* sessions.create({ parentID: parent.id, metadata: { vibeterm: { notes: "keep" } } })

      const expected = { notes: "keep", autoSwitch: { sessionId: child.id, revision: 1, ...fixture.expected } }
      expect(child.parentID).toBe(parent.id)
      expect(child.metadata?.vibeterm).toEqual(expected)
      expect((yield* sessions.get(child.id)).metadata?.vibeterm).toEqual(expected)
      const created = yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, child.id)).get()
      expect(created?.type).toBe("session.created.1")
      expect(Schema.decodeUnknownSync(Session.Event.Created.data)(created?.data).info.metadata?.vibeterm).toEqual(
        expected,
      )
    }),
  )
}

it.instance("a later parent update affects only newly created children", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const parent = yield* sessions.create()
    yield* savePreference({ sessionID: parent.id, preference: "off", returnPreference: "on", revision: 0 })
    const first = yield* sessions.create({ parentID: parent.id })

    yield* savePreference({ sessionID: parent.id, preference: "on", returnPreference: "off", revision: 1 })
    const second = yield* sessions.create({ parentID: parent.id })

    expect((yield* sessions.get(first.id)).metadata?.vibeterm?.autoSwitch).toEqual({
      sessionId: first.id,
      revision: 1,
      preference: "off",
      returnPreference: "on",
    })
    expect(second.metadata?.vibeterm?.autoSwitch).toEqual({
      sessionId: second.id,
      revision: 1,
      preference: "on",
      returnPreference: "off",
    })
  }),
)

it.instance("does not create a journal for missing, inherited, malformed, or mismatched parent preferences", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const database = yield* Database.Service
    const missing = SessionID.descending()
    const parent = yield* sessions.create()
    const records = [
      { sessionId: parent.id, revision: 3, preference: "inherit", returnPreference: "inherit" },
      { sessionId: parent.id, revision: 3, preference: "off", returnPreference: "invalid" },
      { sessionId: missing, revision: 3, preference: "off", returnPreference: "on" },
    ]

    const orphan = yield* sessions.create({ parentID: missing })
    expect(orphan.parentID).toBe(missing)
    expect(orphan.metadata?.vibeterm?.autoSwitch).toBeUndefined()
    for (const autoSwitch of records) {
      yield* database.db
        .update(SessionTable)
        .set({ metadata: { vibeterm: { autoSwitch } } })
        .where(eq(SessionTable.id, parent.id))
        .run()
      const child = yield* sessions.create({ parentID: parent.id })
      expect(child.metadata?.vibeterm?.autoSwitch).toBeUndefined()
    }
  }),
)

api.instance("public create and fork-as-child snapshot the declared parent, not the fork source", () =>
  Effect.gen(function* () {
    const directory = (yield* TestInstance).directory
    const sessions = yield* Session.Service
    const parent = yield* sessions.create()
    const source = yield* sessions.create()
    yield* savePreference({ sessionID: parent.id, preference: "off", returnPreference: "on", revision: 0 })
    yield* savePreference({ sessionID: source.id, preference: "on", returnPreference: "off", revision: 0 })

    for (const path of ["/session", `/session/${source.id}/fork`]) {
      const response = yield* requestInDirectory(path, directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentID: parent.id }),
      })
      expect(response.status).toBe(200)
      const child = Schema.decodeUnknownSync(Session.Info)(yield* response.json)
      expect(child.parentID).toBe(parent.id)
      expect(child.metadata?.vibeterm?.autoSwitch).toEqual({
        sessionId: child.id,
        revision: 1,
        preference: "off",
        returnPreference: "on",
      })
    }

    const rootFork = yield* sessions.fork({ sessionID: source.id })
    expect(rootFork.parentID).toBeUndefined()
    expect(rootFork.metadata?.vibeterm?.autoSwitch).toBeUndefined()
  }),
)
