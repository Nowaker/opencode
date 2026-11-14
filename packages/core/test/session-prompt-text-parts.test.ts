import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { EventTable } from "@opencode/core/event/sql"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { SessionTitle } from "@opencode/core/session/title"
import { SessionMessageTable, SessionPartTable } from "@opencode/core/session/sql"
import { Skill } from "@opencode/core/skill"
import { AbsolutePath } from "@opencode/schema/schema"
import { TextPart } from "@opencode/schema/prompt"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { eq } from "drizzle-orm"
import { decodeBody, it, setup } from "./fixture/prompt-text-parts"

const extras: TextPart[] = [
  { type: "text", position: "after", text: "AFTER_A" },
  { type: "text", position: "before", text: "BEFORE_A" },
  { type: "text", position: "before", text: "BEFORE_B", ignored: false },
  { type: "text", position: "after", text: "AFTER_B" },
  {
    type: "text",
    position: "before",
    text: "STDERR",
    ignored: true,
    metadata: {
      aiHook: {
        kind: "prepend",
        mode: "any",
        script: "a.sh",
        stream: "stderr",
        exitCode: 1,
        durationMs: 10,
        timedOut: true,
      },
    },
  },
  {
    type: "text",
    position: "after",
    text: "HIDDEN",
    ignored: true,
    metadata: {
      aiHook: { kind: "execute", mode: "any", script: "b.sh", stream: "stdout", exitCode: 0, durationMs: 2 },
    },
  },
]
const assertVisible = (body: string, main = "USER_1") => {
  const positions = ["BEFORE_A", "BEFORE_B", main, "AFTER_A", "AFTER_B"].map((text) => body.indexOf(text))
  expect(positions.every((position) => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
  expect(body).not.toContain("STDERR")
  expect(body).not.toContain("HIDDEN")
  expect(body).not.toContain("aiHook")
}

it.live(
  "awaits ordered prompt hooks and retains the first same-message payload through admission and promotion retries",
  () =>
    Effect.gen(function* () {
      const s = yield* setup
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const prepared: string[] = []
      const registry = yield* Skill.Service.pipe(Effect.provide(s.layer))
      yield* registry.transform((editor) => {
        for (const name of ["skill-A", "skill-B"])
          editor.add({
            id: Skill.ID.make(name),
            name: Skill.Name.make(name),
            path: AbsolutePath.make(`/native-${name}`),
            content: name,
          })
      })
      yield* s.hooks.register("session", "prompt", (event) =>
        Effect.gen(function* () {
          expect(event.textParts).toEqual([])
          prepared.push(event.prompt.text)
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          event.textParts = structuredClone(extras.slice(0, 2))
          event.prompt.text = "INTERMEDIATE"
        }),
      )
      yield* s.hooks.register("session", "prompt", (event) =>
        Effect.sync(() => {
          expect(event.textParts).toEqual(extras.slice(0, 2))
          expect(event.prompt.text).toBe("INTERMEDIATE")
          event.prompt.text = "USER_1"
          event.textParts?.push(...structuredClone(extras.slice(2)))
        }),
      )
      const id = SessionMessage.ID.create()
      const agents = [{ name: "build", mention: { start: 0, end: 4, text: "USER" } }]
      const files = [
        { uri: "data:text/plain;base64,RklMRQ==", name: "file.txt", mention: { start: 5, end: 6, text: "1" } },
      ]
      const skills = ["skill-B", "skill-A"].map((name) => ({
        id: Skill.ID.make(name),
        mention: { start: 0, end: 4, text: "USER" },
      }))
      const pending = yield* s.sessions
        .prompt({ sessionID: s.session.id, id, text: "typed", files, agents, skills, resume: false })
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(entered)
      expect(yield* s.sessions.inbox(s.session.id)).toEqual([])
      yield* Deferred.succeed(release, undefined)
      const admitted = yield* Fiber.join(pending)
      expect(admitted.payload).toMatchObject({
        text: "USER_1",
        textParts: extras,
        agents,
        files: [{ name: "file.txt", mention: files[0]?.mention }],
      })
      expect(admitted.payload.skills?.map((skill) => ({ id: skill.id, mention: skill.mention }))).toEqual(skills)
      expect(yield* s.sessions.prompt({ sessionID: s.session.id, id, text: "RETRY", resume: false })).toEqual(admitted)
      yield* s.sessions.resume(s.session.id)
      const rows = yield* s.db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, id))
        .all()
        .pipe(Effect.orDie)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.data).toMatchObject({ text: "USER_1", textParts: extras, agents })
      expect(
        yield* s.db.select().from(SessionPartTable).where(eq(SessionPartTable.message_id, id)).all().pipe(Effect.orDie),
      ).toEqual([])
      const retried = yield* s.sessions.prompt({ sessionID: s.session.id, id, text: "RETRY_PROMOTED", resume: false })
      expect(retried.payload).toEqual(admitted.payload)
      expect(prepared).toEqual(["typed"])
      expect((yield* s.sessions.context(s.session.id)).find((message) => message.id === id)).toMatchObject({
        text: "USER_1",
        textParts: extras,
      })
      assertVisible(s.received[0] ?? "")
      expect((s.received[0] ?? "").indexOf("# Skill: skill-B")).toBeLessThan(
        (s.received[0] ?? "").indexOf("# Skill: skill-A"),
      )
      expect(decodeBody(s.received[0] ?? "").messages.filter((message) => message.role === "user")).toHaveLength(1)
    }),
)

it.live(
  "omits ignored extras across primary, initial and regenerated title, generation, compaction and later checkpoint requests",
  () =>
    Effect.gen(function* () {
      const s = yield* setup
      yield* s.hooks.register("session", "prompt", (event) =>
        Effect.sync(() => {
          event.textParts = structuredClone(extras)
        }),
      )
      yield* s.sessions.prompt({ sessionID: s.session.id, text: "USER_1", resume: false })
      yield* s.sessions.resume(s.session.id)
      yield* SessionTitle.Service.use((title) => title.generate(s.session.id)).pipe(Effect.provide(s.layer))
      yield* s.sessions.generate({ sessionID: s.session.id, prompt: "GENERATE" })
      yield* s.sessions.prompt({ sessionID: s.session.id, text: "USER_2", resume: false })
      yield* s.sessions.resume(s.session.id)
      yield* s.sessions.compact({ sessionID: s.session.id })
      yield* s.sessions.resume(s.session.id)
      const compacted = yield* s.sessions.context(s.session.id)
      expect(compacted.filter((message) => message.type === "compaction")).toMatchObject([{ status: "completed" }])
      yield* s.sessions.generate({ sessionID: s.session.id, prompt: "LATER" })
      expect(s.kinds).toEqual(["primary", "title", "generate", "primary", "compaction", "generate"])
      for (const body of s.received.slice(0, -1)) assertVisible(body)
      assertVisible(s.received.at(-1) ?? "", "USER_2")
      expect(s.received.at(-1)).toContain("recent-context")
      expect(JSON.stringify(compacted)).not.toContain("HIDDEN")
      expect(JSON.stringify(compacted)).not.toContain("STDERR")
    }),
)

for (const [label, metadata] of [
  ...[undefined, () => "function", 1n, NaN, Infinity, new Date(0), new Map()].map(
    (value) => [`${typeof value}:${String(value)}`, { value }] as const,
  ),
  ["root Date", new Date(0)],
  ["root Map", new Map([["stream", "stderr"]])],
] as const) {
  it.live(`rejects non-JSON hook metadata before admission (${label})`, () =>
    Effect.gen(function* () {
      const s = yield* setup
      yield* s.hooks.register("session", "prompt", (event) =>
        Effect.sync(() => {
          Object.assign(event, {
            textParts: [{ type: "text", position: "before", text: "INVALID", metadata }],
          })
        }),
      )
      const result = yield* s.sessions
        .prompt({ sessionID: s.session.id, text: "USER_1", resume: false })
        .pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("JSON")
      expect(yield* s.sessions.inbox(s.session.id)).toEqual([])
      expect(yield* s.sessions.messages({ sessionID: s.session.id })).toEqual([])
      expect(s.received).toEqual([])
    }),
  )
}

it.live("preserves full text parts through native replay, fork, export and import codecs", () =>
  Effect.gen(function* () {
    const s = yield* setup
    yield* s.hooks.register("session", "prompt", (event) =>
      Effect.sync(() => {
        event.textParts = structuredClone(extras)
      }),
    )
    const input = yield* s.sessions.prompt({ sessionID: s.session.id, text: "USER_1", resume: false })
    yield* s.sessions.resume(s.session.id)
    const transfer = yield* SessionTransfer.Service
    const exported = yield* transfer.export({ sessionID: s.session.id })
    expect(exported.messages.find((message) => message.id === input.id)).toMatchObject({ textParts: extras })
    const child = yield* s.sessions.fork({ sessionID: s.session.id })
    expect(
      (yield* s.sessions.messages({ sessionID: child.id })).find((message) => message.type === "user"),
    ).toMatchObject({ textParts: extras })
    const imported = yield* transfer.import({
      data: {
        info: { ...exported.info, id: Session.ID.create() },
        messages: exported.messages.map((message) => ({ ...message, id: SessionMessage.ID.create() })),
      },
      location: s.session.location,
    })
    expect(
      (yield* s.sessions.messages({ sessionID: imported.id })).find((message) => message.type === "user"),
    ).toMatchObject({ textParts: extras })
    const bus = yield* Bus.Service
    const events = yield* s.db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, s.session.id))
      .orderBy(EventTable.seq)
      .all()
      .pipe(Effect.orDie)
    yield* s.sessions.remove(s.session.id)
    for (const event of events)
      yield* bus.replay({
        id: event.id,
        created: event.created,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      })
    expect(
      (yield* s.sessions.messages({ sessionID: s.session.id })).find((message) => message.id === input.id),
    ).toMatchObject({ textParts: extras })
  }),
)
