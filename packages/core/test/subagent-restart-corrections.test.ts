import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { TestLLM } from "@opencode/ai/testing"
import { Job } from "@opencode/core/job"
import { JobTable } from "@opencode/core/job/sql"
import { Session } from "@opencode/core/session"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable } from "@opencode/core/session/sql"
import { SubagentGroup } from "@opencode/core/session/subagent-group"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionEvent } from "@opencode/core/session/event"
import { it, setup } from "./fixture/subagent-options"

for (const missing of [false, true]) {
  for (const suspended of [false, true]) {
    it.live(
      `R2 wakes an idle group parent and respects suspended recovery (missing=${missing}, suspended=${suspended})`,
      () =>
        Effect.gen(function* () {
          const s = yield* setup
          const token = yield* SubagentGroup.register(s.db, {
            parentSessionID: s.parent.id,
            group: { id: "wake", index: 0, total: 1 },
            description: "Recovered group",
            agent: "reviewer",
          })
          if (missing) {
            const child = Session.ID.create()
            yield* SubagentGroup.update(s.db, token, { status: "running", childSessionID: child })
            yield* s.db
              .insert(JobTable)
              .values({
                notification_id: token.generation,
                id: child,
                session_id: s.parent.id,
                child_session_id: child,
                kind: "subagent",
                status: "running",
                recovery: {
                  kind: "subagent",
                  parentSessionID: s.parent.id,
                  childSessionID: child,
                  agent: "reviewer",
                  description: "Missing child",
                  group: token,
                },
              })
              .run()
          }
          if (!missing)
            yield* SubagentGroup.update(s.db, token, { status: "completed", output: "finished before crash" })
          if (suspended) {
            const store = yield* SessionStore.Service
            yield* store.claim(s.parent.id)
          }
          yield* SessionRestart.Service.use((restart) => restart.resumeSuspendedSessions).pipe(
            Effect.provide(SessionRestart.layer({ maxAttempts: 0 })),
          )
          if (!suspended) {
            yield* s.llm.wait(1).pipe(Effect.timeout("5 seconds"))
            yield* s.sessions.wait(s.parent.id)
            expect(
              (yield* s.sessions.context(s.parent.id)).filter((message) => message.type === "synthetic"),
            ).toMatchObject([{ metadata: { source: "subagent-group" } }])
          }
          if (suspended) {
            expect(yield* s.llm.requests()).toEqual([])
            expect(yield* s.sessions.inbox(s.parent.id)).toMatchObject([
              { id: token.notificationID, type: "synthetic" },
            ])
            expect(
              (yield* s.db.select().from(SessionTable).where(eq(SessionTable.id, s.parent.id)).get())?.resume_attempts,
            ).toBe(0)
            expect((yield* s.sessions.get(s.parent.id)).outcome).toBe("failed")
          }
          expect((yield* SubagentGroup.get(s.db, s.parent.id, token.id))?.delivered).toBe(true)
        }),
    )
  }
}

it.live("F2 preserves a group launched by an idle parent awakened during restart recovery", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const childRunning = yield* Deferred.make<void>()
    const finishChild = yield* Deferred.make<void>()
    const parentReplies = { count: 0 }
    yield* s.llm.serve((request) => {
      const child = request.messages.some(
        (message) =>
          message.role === "user" &&
          message.content.some(
            (part) =>
              part.type === "text" && part.text === "You are a subagent spawned by another session.\nfresh-group-task",
          ),
      )
      if (child)
        return Stream.fromEffect(
          Deferred.succeed(childRunning, undefined).pipe(Effect.andThen(Deferred.await(finishChild))),
        ).pipe(Stream.flatMap(() => Stream.fromIterable(TestLLM.text("fresh child result", "fresh-child"))))
      if (parentReplies.count++ === 0)
        return TestLLM.toolCall("launch-fresh-group", "subagent", {
          agent: "reviewer",
          description: "Fresh group",
          prompt: "fresh-group-task",
          background: true,
          notice: { group: { id: "fresh", index: 0, total: 1 } },
        })
      return TestLLM.text("parent idle", "parent")
    })
    const previousChild = yield* s.sessions.create({ parentID: s.parent.id, model: s.model })
    const previousNotice = SessionMessage.ID.create()
    yield* s.db
      .insert(JobTable)
      .values({
        notification_id: previousNotice,
        id: previousChild.id,
        session_id: s.parent.id,
        child_session_id: previousChild.id,
        kind: "subagent",
        status: "completed",
        output: "recovered result",
        recovery: {
          kind: "subagent",
          parentSessionID: s.parent.id,
          childSessionID: previousChild.id,
          agent: "reviewer",
          description: "Previous child",
        },
      })
      .run()
    yield* SessionRestart.Service.use((restart) => restart.resumeSuspendedSessions).pipe(
      Effect.provide(SessionRestart.layer()),
      Effect.provideService(Job.Service, {
        ...s.jobs,
        completeBackground: (id) =>
          id === previousNotice
            ? Deferred.await(childRunning).pipe(Effect.andThen(s.jobs.completeBackground(id)))
            : s.jobs.completeBackground(id),
      }),
    )
    const fresh = yield* SubagentGroup.get(s.db, s.parent.id, "fresh")
    expect(fresh?.slots).toMatchObject([{ status: "running" }])
    expect(fresh?.delivered).toBe(false)
    const child = fresh?.slots[0]?.childSessionID
    if (!child) return yield* Effect.die("The awakened parent did not launch its child")
    expect((yield* s.jobs.get(child))?.status).toBe("running")
    const completion = yield* s.bus.subscribe(SessionEvent.InboxEnqueued).pipe(
      Stream.filter((event) => event.data.inboxID === fresh.notificationID),
      Stream.take(1),
      Stream.runCollect,
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Deferred.succeed(finishChild, undefined)
    yield* Fiber.join(completion)
    expect((yield* SubagentGroup.get(s.db, s.parent.id, "fresh"))?.slots).toMatchObject([
      { status: "completed", output: "fresh child result" },
    ])
  }),
)
