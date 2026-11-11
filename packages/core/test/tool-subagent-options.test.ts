import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { TestLLM } from "@opencode/ai/testing"
import { Money } from "@opencode/schema/money"
import { Agent } from "@opencode/core/agent"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SubagentCompletion } from "@opencode/core/session/subagent-completion"
import { SubagentGroup } from "@opencode/core/session/subagent-group"
import { SessionBackground } from "@opencode/core/session/background"
import { SessionStore } from "@opencode/core/session/store"
import { SessionMessageTable } from "@opencode/core/session/sql"
import { childID, it, setup } from "./fixture/subagent-options"

describe("native subagent options", () => {
  it.live("forks and resumes the parent's own primary agent without permitting ordinary primary children", () =>
    Effect.gen(function* () {
      const s = yield* setup
      yield* s.sessions.synthetic({ sessionID: s.parent.id, ignored: true, text: "parent history" })
      expect(yield* s.call({ agent: "build" })).toMatchObject({ status: "error" })
      const first = yield* s.call({ agent: "build", fork: true })
      const id = childID(first.metadata)
      expect(yield* s.sessions.get(id)).toMatchObject({
        parentID: s.parent.id,
        agent: "build",
        fork: { sessionID: s.parent.id },
      })
      yield* s.llm.always(TestLLM.text("continued fork", "followup"))
      const resumed = yield* s.call({ agent: "build", sessionID: id, prompt: "continue" })
      expect(resumed.metadata).toEqual({ sessionID: id, status: "completed" })
      expect(resumed.content).toEqual([
        { type: "text", text: `<subagent sessionID="${id}" state="completed">\ncontinued fork\n</subagent>` },
      ])
      const ordinary = yield* s.sessions.create({
        parentID: s.parent.id,
        agent: Agent.ID.make("build"),
        model: s.model,
      })
      expect(yield* s.call({ agent: "build", sessionID: ordinary.id })).toMatchObject({ status: "error" })
    }),
  )

  it.live("forks only settled current context, awaits progress before prompting, and returns only child output", () =>
    Effect.gen(function* () {
      const s = yield* setup
      yield* s.llm.always(TestLLM.text("parent history", "parent"))
      yield* s.sessions.prompt({ sessionID: s.parent.id, text: "parent request" })
      yield* s.sessions.wait(s.parent.id)
      const active = SessionMessage.ID.create()
      yield* s.bus.publish(SessionEvent.Step.Started, {
        sessionID: s.parent.id,
        assistantMessageID: active,
        agent: Agent.ID.make("build"),
        model: s.model,
        started: 1,
      })
      yield* s.bus.publish(SessionEvent.Text.Started, {
        sessionID: s.parent.id,
        assistantMessageID: active,
        ordinal: 0,
      })
      yield* s.bus.publish(SessionEvent.Text.Ended, {
        sessionID: s.parent.id,
        assistantMessageID: active,
        ordinal: 0,
        text: "unsettled parent tail",
      })
      yield* s.llm.always(TestLLM.text("fork response", "fork"))
      const result = yield* s.call({ fork: true }, (update) =>
        Effect.gen(function* () {
          const id = childID(update)
          expect(yield* s.sessions.inbox(id)).toEqual([])
          expect((yield* s.sessions.messages({ sessionID: id })).filter((m) => m.type === "assistant")).toHaveLength(1)
        }).pipe(Effect.orDie),
      )
      const child = yield* s.sessions.get(childID(result.metadata))
      expect(child).toMatchObject({
        parentID: s.parent.id,
        title: "Review fixture",
        agent: "reviewer",
        model: { id: "child" },
        fork: { sessionID: s.parent.id },
      })
      expect(result.content).toEqual([
        { type: "text", text: `<subagent sessionID="${child.id}" state="completed">\nfork response\n</subagent>` },
      ])
      const text = JSON.stringify(yield* s.sessions.context(child.id))
      expect(text).toContain("parent history")
      expect(text).not.toContain("unsettled parent tail")
      expect((yield* s.sessions.inbox(s.parent.id)).filter((item) => item.type === "synthetic")).toEqual([])
      expect(yield* s.call({ fork: true, sessionID: child.id })).toMatchObject({ status: "error" })
    }),
  )

  it.live("does not return copied parent text when a fork produces no text", () =>
    Effect.gen(function* () {
      const s = yield* setup
      yield* s.llm.always(TestLLM.text("copied parent answer", "parent"))
      yield* s.sessions.prompt({ sessionID: s.parent.id, text: "parent request" })
      yield* s.sessions.wait(s.parent.id)
      yield* s.llm.always(TestLLM.stop())
      const result = yield* s.call({ fork: true })
      expect(result.content).toEqual([
        {
          type: "text",
          text: `<subagent sessionID="${childID(result.metadata)}" state="completed">\n${SubagentCompletion.NO_TEXT}\n</subagent>`,
        },
      ])
    }),
  )

  it.live("makes the compacted context a hard fork history boundary", () =>
    Effect.gen(function* () {
      const s = yield* setup
      yield* s.llm.always(TestLLM.text("archived parent answer", "old"))
      yield* s.sessions.prompt({ sessionID: s.parent.id, text: "archived request" })
      yield* s.sessions.wait(s.parent.id)
      yield* s.bus.publish(SessionEvent.Compaction.Started, { sessionID: s.parent.id, reason: "manual" })
      yield* s.bus.publish(SessionEvent.Compaction.Ended, {
        sessionID: s.parent.id,
        reason: "manual",
        text: "current summary",
        cost: Money.USD.zero,
      })
      const oldUser = (yield* s.sessions.messages({ sessionID: s.parent.id })).find(
        (message) => message.type === "user",
      )
      const compacted = yield* s.db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, s.parent.id), eq(SessionMessageTable.type, "compaction")))
        .get()
      if (!oldUser || !compacted) return yield* Effect.die("Missing retained compaction fixture")
      yield* s.db
        .update(SessionMessageTable)
        .set({ data: { ...compacted.data, metadata: { keepID: oldUser.id } } })
        .where(eq(SessionMessageTable.id, compacted.id))
        .run()
      yield* s.bus.publish(SessionEvent.Compaction.Started, { sessionID: s.parent.id, reason: "manual" })
      yield* s.llm.always(TestLLM.text("child response", "child"))
      const result = yield* s.call({ fork: true })
      const messages = yield* s.sessions.messages({ sessionID: childID(result.metadata) })
      expect(JSON.stringify(messages)).toContain("current summary")
      expect(messages.filter((m) => m.type === "user").map((m) => m.text)).toEqual([
        "You are a subagent spawned by another session.\nreview",
      ])
      expect(messages.find((m) => m.type === "compaction")?.metadata?.recent).toContain("archived parent answer")
      expect(messages.filter((m) => m.type === "compaction")).toMatchObject([{ status: "completed" }])
    }),
  )

  it.live("suppresses live and recovered completion notices with none", () =>
    Effect.gen(function* () {
      const s = yield* setup
      const gate = yield* s.llm.gate()
      const result = yield* s.call({ background: true, notice: "none" })
      const id = childID(result.metadata)
      yield* gate.started
      expect((yield* s.call({ sessionID: id, background: true })).metadata).toEqual({
        sessionID: id,
        status: "running",
      })
      yield* gate.release
      yield* s.jobs.wait({ id })
      const restart = yield* SessionRestart.Service
      yield* restart.resumeSuspendedSessions
      yield* s.sessions.wait(s.parent.id)
      expect((yield* s.sessions.context(s.parent.id)).filter((item) => item.type === "synthetic")).toEqual([])
      expect(yield* s.jobs.pendingBackground).toEqual([])
    }),
  )

  for (const background of [false, true])
    it.live(`waits for all fixed slots after a fast first child and a model rejection (background=${background})`, () =>
      Effect.gen(function* () {
        const s = yield* setup
        const notice = yield* s.notice
        const first = yield* s.call({ background, notice: { group: { id: "review", index: 0, total: 2 } } })
        expect(first.status).toBe("completed")
        if (background) {
          yield* s.jobs.wait({ id: childID(first.metadata) })
          yield* s.jobs.pendingBackground.pipe(
            Effect.repeat({ until: (pending) => pending.length === 0 }),
            Effect.timeout("5 seconds"),
          )
        }
        expect((yield* s.sessions.inbox(s.parent.id)).filter((item) => item.type === "synthetic")).toEqual([])
        const store = yield* SessionStore.Service
        const outstanding = yield* SessionBackground.outstanding(
          { ...s.jobs, groups: SubagentGroup.pending(s.db) },
          store,
          s.parent.id,
        )
        expect(outstanding).toContainEqual({
          kind: "subagent-group",
          sessionID: s.parent.id,
          id: "review",
          total: 2,
          pending: 1,
        })
        expect(
          yield* s.call({ model: "test/missing", notice: { group: { id: "review", index: 1, total: 2 } } }),
        ).toMatchObject({ status: "error" })
        const events = Array.from(yield* Fiber.join(notice))
        expect(events).toHaveLength(1)
        expect(events[0]?.data.item).toMatchObject({
          type: "synthetic",
          payload: { metadata: { source: "subagent-group", groupID: "review", total: 2 } },
        })
        yield* s.sessions.wait(s.parent.id)
        expect((yield* s.sessions.context(s.parent.id)).filter((m) => m.type === "synthetic")).toHaveLength(1)
        expect(yield* s.call({ notice: { group: { id: "review", index: 1, total: 2 } } })).toMatchObject({
          status: "error",
        })
      }),
    )

  it.live("settles a denied permission slot and a cancelled child in one group notice", () =>
    Effect.gen(function* () {
      const s = yield* setup
      const notice = yield* s.notice
      const gate = yield* s.llm.gate()
      const launched = yield* s.call({ background: true, notice: { group: { id: "cancel", index: 0, total: 2 } } })
      yield* gate.started
      yield* s.sessions.setPermissions({
        sessionID: s.parent.id,
        permissions: [{ action: "subagent", resource: "reviewer", effect: "deny" }],
      })
      yield* s.call({ notice: { group: { id: "cancel", index: 1, total: 2 } } }).pipe(Effect.exit)
      yield* s.jobs.cancel(childID(launched.metadata))
      yield* gate.release
      yield* Fiber.join(notice)
      yield* s.llm.wait(2)
      yield* s.sessions.wait(s.parent.id)
      const state = yield* SubagentGroup.get(s.db, s.parent.id, "cancel")
      expect(state?.slots.map((slot) => slot.status).toSorted()).toEqual(["cancelled", "error"])
      expect((yield* s.sessions.context(s.parent.id)).filter((m) => m.type === "synthetic")).toHaveLength(1)
    }),
  )

  it.live("settles invocation cancellation while progress is still preparing the child", () =>
    Effect.gen(function* () {
      const s = yield* setup
      const notice = yield* s.notice
      const preparing = yield* Deferred.make<void>()
      const call = yield* s
        .call({ notice: { group: { id: "prelaunch", index: 0, total: 1 } } }, () =>
          Deferred.succeed(preparing, undefined).pipe(Effect.andThen(Effect.never)),
        )
        .pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Deferred.await(preparing)
      yield* Fiber.interrupt(call)
      yield* Fiber.join(notice)
      expect((yield* SubagentGroup.get(s.db, s.parent.id, "prelaunch"))?.slots).toMatchObject([{ status: "cancelled" }])
      const child = (yield* s.sessions.list({ parentID: s.parent.id })).data[0]
      if (!child) return yield* Effect.die("Missing prepared child")
      expect(yield* s.sessions.inbox(child.id)).toEqual([])
      expect((yield* s.jobs.backgroundJobs).filter((job) => job.sessionID === s.parent.id)).toEqual([])
    }),
  )

  it.live("delivers the same group id independently for two calling parents", () =>
    Effect.gen(function* () {
      const first = yield* setup
      const second = yield* setup
      const a = yield* first.notice
      const b = yield* second.notice
      yield* Effect.all(
        [
          first.call({ notice: { group: { id: "shared", index: 0, total: 1 } } }),
          second.call({ notice: { group: { id: "shared", index: 0, total: 1 } } }),
        ],
        { concurrency: "unbounded" },
      )
      const notices = yield* Effect.all([Fiber.join(a), Fiber.join(b)])
      expect(notices.map((events) => Array.from(events).map((event) => event.data.sessionID))).toEqual([
        [first.parent.id],
        [second.parent.id],
      ])
      const ids = yield* Effect.all([
        SubagentGroup.get(first.db, first.parent.id, "shared"),
        SubagentGroup.get(second.db, second.parent.id, "shared"),
      ])
      expect(ids[0]?.notificationID).not.toBe(ids[1]?.notificationID)
    }),
  )

  it.effect("hands off a foreground wait on the caller clock without interrupting the child", () =>
    Effect.gen(function* () {
      const s = yield* setup
      const notice = yield* s.notice
      const gate = yield* s.llm.gate()
      const progress = yield* Deferred.make<SessionMessage.ID>()
      const call = yield* s
        .call({ foregroundHandoffMs: 100 }, () =>
          Deferred.succeed(progress, SessionMessage.ID.create()).pipe(Effect.asVoid),
        )
        .pipe(Effect.forkScoped({ startImmediately: true }))
      yield* gate.started
      yield* Deferred.await(progress)
      yield* Effect.yieldNow
      yield* TestClock.adjust(100)
      const result = yield* Fiber.join(call)
      const id = childID(result.metadata)
      expect(result.metadata).toEqual({ sessionID: id, status: "running" })
      expect((yield* s.jobs.get(id))?.status).toBe("running")
      yield* gate.release
      yield* Fiber.join(notice)
      yield* s.llm.wait(2)
      yield* s.sessions.wait(s.parent.id)
      expect((yield* s.sessions.context(s.parent.id)).filter((m) => m.type === "synthetic")).toMatchObject([
        { metadata: { source: "subagent", childID: id, state: "completed" } },
      ])
    }),
  )

  for (const foregroundHandoffMs of [undefined, 0])
    it.effect(`keeps the foreground wait when handoff is ${foregroundHandoffMs}`, () =>
      Effect.gen(function* () {
        const s = yield* setup
        const gate = yield* s.llm.gate()
        const returned: string[] = []
        const running = yield* s.call(foregroundHandoffMs === undefined ? {} : { foregroundHandoffMs }).pipe(
          Effect.tap(() => Effect.sync(() => returned.push("returned"))),
          Effect.forkScoped({ startImmediately: true }),
        )
        yield* gate.started
        yield* TestClock.adjust(1000)
        expect(returned).toEqual([])
        yield* gate.release
        const result = yield* Fiber.join(running)
        expect(result.metadata).toEqual({ sessionID: childID(result.metadata), status: "completed" })
        expect((yield* s.sessions.inbox(s.parent.id)).filter((item) => item.type === "synthetic")).toEqual([])
      }),
    )
})
