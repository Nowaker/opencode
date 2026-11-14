import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionTitle } from "@opencode/core/session/title"
import { Effect } from "effect"
import { decodeBody, it, setup } from "./fixture/prompt-text-parts"

it.live("keeps first-message text on the first user row while every native request excludes hidden hook streams", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const state = { prepared: 0 }
    yield* s.hooks.register("session", "prompt", (event) =>
      Effect.sync(() => {
        event.textParts = [
          ...(state.prepared === 0 ? [{ type: "text" as const, position: "before" as const, text: "FIRST" }] : []),
          { type: "text", position: "before", text: "BEFORE" },
          {
            type: "text",
            position: "before",
            text: "STDERR",
            ignored: true,
            metadata: { aiHook: { stream: "stderr", exitCode: 7, durationMs: 12, timedOut: true } },
          },
          { type: "text", position: "after", text: "AFTER" },
          {
            type: "text",
            position: "after",
            text: "HIDDEN",
            ignored: true,
            metadata: { aiHook: { stream: "stdout", exitCode: 0, durationMs: 3 } },
          },
        ]
        state.prepared++
      }),
    )
    const first = yield* s.sessions.prompt({ sessionID: s.session.id, text: "USER_1", resume: false })
    yield* s.sessions.resume(s.session.id)
    const second = yield* s.sessions.prompt({ sessionID: s.session.id, text: "USER_2", resume: false })
    yield* s.sessions.resume(s.session.id)
    const users = (yield* s.sessions.messages({ sessionID: s.session.id, order: "asc" })).filter(
      (message) => message.type === "user",
    )
    expect(
      users.map((message) => ({
        id: message.id,
        text: message.text,
        parts: message.textParts?.map((part) => part.text),
      })),
    ).toEqual([
      { id: first.id, text: "USER_1", parts: ["FIRST", "BEFORE", "STDERR", "AFTER", "HIDDEN"] },
      { id: second.id, text: "USER_2", parts: ["BEFORE", "STDERR", "AFTER", "HIDDEN"] },
    ])
    expect(users[0]?.textParts?.[2]?.metadata).toEqual({
      aiHook: { stream: "stderr", exitCode: 7, durationMs: 12, timedOut: true },
    })
    expect(s.kinds).toEqual(["primary", "primary"])
    const text = (body: string) =>
      decodeBody(body)
        .messages.filter((message) => message.role === "user")
        .map((message) => message.content)
    expect(text(s.received[0] ?? "")).toEqual(["FIRSTBEFOREUSER_1AFTER"])
    expect(text(s.received[1] ?? "")).toEqual(["FIRSTBEFOREUSER_1AFTER", "BEFOREUSER_2AFTER"])
    for (const body of s.received) {
      expect(body).not.toContain("STDERR")
      expect(body).not.toContain("HIDDEN")
    }
  }),
)

it.live("uses ordered visible parts for the initial native title without flattening the stored main text", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const session = yield* s.sessions.create({ location: s.session.location, model: s.session.model })
    expect(SessionTitle.isUntitled(session)).toBe(true)
    yield* s.hooks.register("session", "prompt", (event) =>
      Effect.sync(() => {
        event.textParts = [
          { type: "text", position: "after", text: "AFTER" },
          { type: "text", position: "before", text: "BEFORE" },
          { type: "text", position: "before", text: "HIDDEN", ignored: true },
        ]
      }),
    )
    yield* s.sessions.prompt({ sessionID: session.id, text: "USER", resume: false })
    const bus = yield* Bus.Service
    yield* SessionInbox.promote(s.db, bus, session.id, "steer")
    yield* SessionTitle.Service.use((title) => title.generate(session.id)).pipe(Effect.provide(s.layer))
    expect(s.kinds).toEqual(["title"])
    expect(s.received[0]).toContain("BEFORE\\nUSER\\nAFTER")
    expect(s.received[0]).not.toContain("HIDDEN")
    expect(
      (yield* s.sessions.messages({ sessionID: session.id })).find((message) => message.type === "user")?.text,
    ).toBe("USER")
  }),
)

it.live("keeps prompts without text parts unchanged at native admission and provider dispatch", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const input = yield* s.sessions.prompt({ sessionID: s.session.id, text: "PLAIN", resume: false })
    expect(input.payload).toEqual({ text: "PLAIN" })
    yield* s.sessions.resume(s.session.id)
    expect(decodeBody(s.received[0] ?? "").messages.filter((message) => message.role === "user")).toEqual([
      { role: "user", content: "PLAIN" },
    ])
  }),
)
