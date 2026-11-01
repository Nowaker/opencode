import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node])))

const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") }

const user = Effect.fn("test.user")(function* (sessionID: SessionID, text: string) {
  const sessions = yield* Session.Service
  const message = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model,
  })
  yield* sessions.updatePart({ id: PartID.ascending(), messageID: message.id, sessionID, type: "text", text })
  return message
})

const assistant = Effect.fn("test.assistant")(function* (sessionID: SessionID, parentID: MessageID, done: boolean) {
  const sessions = yield* Session.Service
  const id = MessageID.ascending()
  yield* sessions.updateMessage({
    id,
    sessionID,
    role: "assistant",
    time: done ? { created: Date.now(), completed: Date.now() } : { created: Date.now() },
    parentID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(done && { finish: "stop" }),
  } as unknown as SessionV1.Info)
  return id
})

const part = Effect.fn("test.part")(function* (
  sessionID: SessionID,
  messageID: MessageID,
  value: Record<string, unknown>,
) {
  const sessions = yield* Session.Service
  yield* sessions.updatePart({ id: PartID.ascending(), messageID, sessionID, ...value } as SessionV1.Part)
})

// A session caught mid-turn: a settled exchange, then a streaming answer with a running tool, a tool whose
// call is still arriving, a finished tool and unfinished text, then a prompt queued behind it.
const midTurn = Effect.fn("test.midTurn")(function* () {
  const sessions = yield* Session.Service
  const source = yield* sessions.create({})
  const first = yield* user(source.id, "first")
  yield* part(source.id, yield* assistant(source.id, first.id, true), { type: "text", text: "first answer" })
  const second = yield* user(source.id, "second")
  const streaming = yield* assistant(source.id, second.id, false)
  yield* part(source.id, streaming, { type: "text", text: "working", time: { start: 5 } })
  yield* part(source.id, streaming, {
    type: "tool",
    callID: "running",
    tool: "bash",
    state: { status: "running", input: { command: "make" }, metadata: { output: "half" }, time: { start: 6 } },
  })
  yield* part(source.id, streaming, {
    type: "tool",
    callID: "pending",
    tool: "read",
    state: { status: "pending", input: {}, raw: "{" },
  })
  yield* part(source.id, streaming, {
    type: "tool",
    callID: "done",
    tool: "glob",
    state: {
      status: "completed",
      input: {},
      output: "a.ts",
      title: "glob",
      metadata: {},
      time: { start: 3, end: 4 },
    },
  })
  const queued = yield* user(source.id, "third")
  return { source, first, second, queued }
})

const texts = (messages: SessionV1.WithParts[]) =>
  messages.map((message) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""))

describe("session fork", () => {
  it.instance("settle copies the streaming answer completed, its unfinished tools interrupted", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const turn = yield* midTurn()
      const fork = yield* sessions.fork({ sessionID: turn.source.id, unsettled: "settle" })
      const messages = yield* sessions.messages({ sessionID: fork.id })
      expect(texts(messages)).toEqual(["first", "first answer", "second", "working", "third"])

      const copy = messages[3]
      expect(copy.info.role === "assistant" && copy.info.time.completed).toBeGreaterThan(0)
      expect(copy.info.role === "assistant" && copy.info.parentID).toBe(messages[2].info.id)
      const tools = copy.parts.filter((part): part is SessionV1.ToolPart => part.type === "tool")
      expect(tools.map((tool) => [tool.callID, tool.state.status])).toEqual([
        ["running", "error"],
        ["pending", "error"],
        ["done", "completed"],
      ])
      for (const tool of tools.slice(0, 2)) {
        if (tool.state.status !== "error") throw new Error("expected an error state")
        expect(tool.state.error).toContain("the command executed, its result is unknown")
        expect(tool.state.metadata).toMatchObject({ interrupted: true, forked: true })
        expect(tool.state.time.end).toBeGreaterThanOrEqual(tool.state.time.start)
      }
      expect(tools[0].state.status === "error" && tools[0].state.metadata?.output).toBe("half")
      expect(tools[0].state.status === "error" && tools[0].state.time.start).toBe(6)
      const text = copy.parts.find((part) => part.type === "text")
      expect(text?.type === "text" && text.time?.end).toBeGreaterThan(0)

      const original = (yield* sessions.messages({ sessionID: turn.source.id }))[3]
      expect(original.info.role === "assistant" && original.info.time.completed).toBeUndefined()
      expect(original.parts.find((part) => part.type === "tool")).toMatchObject({ state: { status: "running" } })
    }),
  )

  it.instance("exclude leaves the streaming answer out and keeps the settled history around it", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const turn = yield* midTurn()
      const fork = yield* sessions.fork({ sessionID: turn.source.id, unsettled: "exclude" })
      const messages = yield* sessions.messages({ sessionID: fork.id })
      expect(texts(messages)).toEqual(["first", "first answer", "second", "third"])
      expect(messages.every((message) => message.info.role !== "assistant" || message.info.time.completed)).toBe(true)
    }),
  )

  it.instance("before the last prompt, settles what precedes it and copies nothing after", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const turn = yield* midTurn()
      const fork = yield* sessions.fork({ sessionID: turn.source.id, messageID: turn.queued.id, unsettled: "settle" })
      const messages = yield* sessions.messages({ sessionID: fork.id })
      expect(texts(messages)).toEqual(["first", "first answer", "second", "working"])
      expect(messages.flatMap((message) => message.parts).some((part) => part.type === "tool" && part.state.status === "running")).toBe(false)
    }),
  )

  it.instance("without unsettled, copies the streaming answer as it is", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const turn = yield* midTurn()
      const fork = yield* sessions.fork({ sessionID: turn.source.id })
      const copy = (yield* sessions.messages({ sessionID: fork.id }))[3]
      expect(copy.info.role === "assistant" && copy.info.time.completed).toBeUndefined()
      expect(copy.parts.find((part) => part.type === "tool")).toMatchObject({ state: { status: "running" } })
    }),
  )

  it.instance("creates the fork under a given ID and refuses one already taken", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const turn = yield* midTurn()
      const id = SessionID.descending()
      const fork = yield* sessions.fork({ sessionID: turn.source.id, id, unsettled: "exclude" })
      expect(fork.id).toBe(id)
      expect((yield* sessions.get(id)).title).toBe(`${turn.source.title} (fork #1)`)
      const again = yield* Effect.exit(sessions.fork({ sessionID: turn.source.id, id }))
      expect(Exit.isFailure(again)).toBe(true)
      expect((yield* sessions.messages({ sessionID: id })).length).toBe(4)
    }),
  )
})
