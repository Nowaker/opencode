import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Logger } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import fs from "fs/promises"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Snapshot } from "@/snapshot"
import { Session } from "@/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionStatus } from "../../src/session/status"
import { MessageID } from "../../src/session/schema"
import { SessionSummary } from "../../src/session/summary"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { provideTmpdirServer } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { raw, reply, TestLLMServer } from "../lib/llm-server"

// Each entry holds one upcoming Snapshot.track() call (in call order) until the deferred is resolved, so a test
// can keep a snapshot "slow" for exactly as long as it needs. Undefined entries let that call through.
const holds: Array<Deferred.Deferred<void> | undefined> = []
const releases: Array<Deferred.Deferred<void>> = []

// A failing test must still let go of the snapshots it holds, or the aborted turn waits for them forever.
const releaseAll = Effect.suspend(() =>
  Effect.forEach(releases.splice(0), (release) => Deferred.succeed(release, undefined), { discard: true }),
)

const realSnapshot = Snapshot.node.implementation as Layer.Layer<
  Snapshot.Service,
  never,
  FSUtil.Service | AppProcess.Service | Config.Service
>
const heldSnapshot = LayerNode.make({
  service: Snapshot.Service,
  layer: Layer.effect(
    Snapshot.Service,
    Effect.gen(function* () {
      const real = yield* Snapshot.Service
      return Snapshot.Service.of({
        ...real,
        track: (sessionID) =>
          Effect.gen(function* () {
            const hold = holds.shift()
            if (hold) yield* Deferred.await(hold)
            return yield* real.track(sessionID)
          }),
      })
    }),
  ).pipe(Layer.provide(realSnapshot)),
  deps: [FSUtil.node, AppProcess.node, Config.node],
})

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      SessionRevert.node,
      Session.node,
      SessionProjector.node,
      SessionSummary.node,
      SessionStatus.node,
      Snapshot.node,
      Database.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
    [
      [Snapshot.node, heldSnapshot],
      [MCP.node, mcp],
      [LSP.node, lsp],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
    ],
  ),
)

const providerCfg = (url: string) => ({
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: url },
    },
  },
})

// One streamed response that calls several tools at once (the shared reply() helper only supports one).
function toolCalls(calls: Array<[name: string, input: unknown]>, firstID = 1) {
  const chunk = (delta: Record<string, unknown>, finish?: string) => ({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }],
  })
  return raw({
    head: [chunk({ role: "assistant" })],
    tail: [
      ...calls.flatMap(([name, input], index) => [
        chunk({
          tool_calls: [{ index, id: `call_${firstID + index}`, type: "function", function: { name, arguments: "" } }],
        }),
        chunk({ tool_calls: [{ index, function: { arguments: JSON.stringify(input) } }] }),
      ]),
      chunk({}, "tool_calls"),
    ],
  })
}

const asks = (text: string) => (hit: { body: unknown }) => JSON.stringify(hit.body).includes(text)
const turn = (text: string) => (hit: { body: unknown }) => asks(text)(hit) && !asks("Generate a title")(hit)

const startSession = Effect.fn("AsyncSnapshotTest.startSession")(function* (text: string) {
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const session = yield* sessions.create({
    title: "async snapshot test",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
  yield* prompt.prompt({ sessionID: session.id, agent: "build", noReply: true, parts: [{ type: "text", text }] })
  return session
})

const allParts = Effect.fn("AsyncSnapshotTest.allParts")(function* (sessionID: Session.Info["id"]) {
  const sessions = yield* Session.Service
  return (yield* sessions.messages({ sessionID }).pipe(Effect.orDie)).flatMap((message) => message.parts)
})

const toolPart = (parts: SessionV1.Part[], tool: string) =>
  parts.find((part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === tool)

const exists = (file: string) =>
  Effect.promise(() =>
    fs
      .access(file)
      .then(() => true)
      .catch(() => false),
  )

it.live("write-capable tools wait for the turn snapshot; the model request and read-only tools do not", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ dir, llm }) {
      const prompt = yield* SessionPrompt.Service
      const snapshot = yield* Snapshot.Service
      const notes = path.join(dir, "notes.txt")
      const created = path.join(dir, "created.txt")
      yield* Effect.promise(() => Bun.write(notes, "notes\n"))
      holds.length = 0
      const before = yield* snapshot.track()

      const release = yield* Deferred.make<void>()
      releases.push(release)
      holds.push(release)
      yield* llm.pushMatch(
        asks("run both tools"),
        toolCalls([
          ["read", { filePath: notes }],
          ["bash", { command: `echo created > ${created}` }],
        ]),
      )
      yield* llm.textMatch(asks("call_2"), "done")

      const session = yield* startSession("run both tools")
      const loop = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)

      yield* pollWithTimeout(
        llm.hits.pipe(Effect.map((hits) => (hits.some(turn("run both tools")) ? true : undefined))),
        "the model request was not sent while the snapshot was pending",
      )
      expect(yield* Deferred.isDone(release)).toBe(false)

      yield* pollWithTimeout(
        allParts(session.id).pipe(
          Effect.map((parts) =>
            toolPart(parts, "read")?.state.status === "completed" && toolPart(parts, "bash")?.state.status === "running"
              ? true
              : undefined,
          ),
        ),
        "the read-only tool did not finish while the snapshot was pending",
      )
      expect(yield* exists(created)).toBe(false)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(loop)

      const parts = yield* allParts(session.id)
      expect(yield* exists(created)).toBe(true)
      expect(toolPart(parts, "bash")?.state.status).toBe("completed")
      expect(parts.find((part) => part.type === "step-start")).toMatchObject({ snapshot: before })
      expect(parts.filter((part) => part.type === "patch").flatMap((part) => part.files)).toEqual([created])
    }, Effect.ensuring(releaseAll)),
    { git: true, config: providerCfg },
  ),
)

it.live("snapshots recorded off the critical path give the same diffs, patches and undo as synchronous ones", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ dir, llm }) {
      const prompt = yield* SessionPrompt.Service
      const revert = yield* SessionRevert.Service
      const summary = yield* SessionSummary.Service
      const snapshot = yield* Snapshot.Service
      const edited = path.join(dir, "edited.txt")
      const created = path.join(dir, "created.txt")
      yield* Effect.promise(() => Bun.write(edited, "one\ntwo\n"))
      holds.length = 0
      const before = yield* snapshot.track()

      // Step one only reads. Its "after" snapshot and the next step's "before" snapshot are both held, so the
      // second model request must go out while they are pending and step two's writes must wait for them.
      const release = yield* Deferred.make<void>()
      releases.push(release)
      holds.push(undefined, release, release)
      yield* llm.pushMatch(asks("change the files"), toolCalls([["read", { filePath: edited }]]))
      yield* llm.pushMatch(
        asks("call_1"),
        toolCalls(
          [
            ["edit", { filePath: edited, oldString: "two", newString: "three" }],
            ["bash", { command: `echo created > ${created}` }],
          ],
          2,
        ),
      )
      yield* llm.textMatch(asks("call_3"), "done")

      const session = yield* startSession("change the files")
      const loop = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)

      yield* pollWithTimeout(
        llm.hits.pipe(Effect.map((hits) => (hits.filter(turn("change the files")).length >= 2 ? true : undefined))),
        "the next model request waited for the previous step's snapshot",
      )
      yield* pollWithTimeout(
        allParts(session.id).pipe(
          Effect.map((parts) =>
            toolPart(parts, "edit")?.state.status === "running" && toolPart(parts, "bash")?.state.status === "running"
              ? true
              : undefined,
          ),
        ),
        "step two never called its tools",
      )
      expect(yield* Deferred.isDone(release)).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(edited).text())).toBe("one\ntwo\n")
      expect(yield* exists(created)).toBe(false)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(loop)
      const after = yield* snapshot.track()
      expect(after).not.toBe(before)

      // Synchronous snapshots would record these same tree hashes, so they would produce the same diffs.
      const sessions = yield* Session.Service
      const messages = (yield* sessions.messages({ sessionID: session.id }).pipe(Effect.orDie)).filter(
        (message) => message.info.role === "assistant",
      )
      const steps = messages.map((message) => ({
        start: message.parts.find((part) => part.type === "step-start"),
        finish: message.parts.find((part) => part.type === "step-finish"),
        patches: message.parts.filter((part) => part.type === "patch"),
      }))
      expect(steps.map((step) => [step.start?.snapshot, step.finish?.snapshot])).toEqual([
        [before, before],
        [before, after],
        [after, after],
      ])
      expect(
        steps.map((step) => step.patches.flatMap((patch) => patch.files).toSorted((a, b) => a.localeCompare(b))),
      ).toEqual([[], [created, edited].toSorted((a, b) => a.localeCompare(b)), []])
      expect(messages[1]?.parts.at(-1)?.type).toBe("patch")

      const user = (yield* sessions.messages({ sessionID: session.id }).pipe(Effect.orDie)).find(
        (message) => message.info.role === "user",
      )
      if (!user) throw new Error("Expected user message")
      const expected = yield* snapshot.diffFull(before ?? "", after ?? "")
      const diffs = yield* pollWithTimeout(
        summary
          .diff({ sessionID: session.id, messageID: user.info.id })
          .pipe(Effect.map((items) => (items.length === expected.length ? items : undefined))),
        "the turn summary was not written",
      )
      expect(diffs).toEqual(expected)
      expect(diffs.map((item) => item.file ?? "").toSorted((a, b) => a.localeCompare(b))).toEqual([
        "created.txt",
        "edited.txt",
      ])

      yield* revert.revert({ sessionID: session.id, messageID: user.info.id })
      expect(yield* Effect.promise(() => Bun.file(edited).text())).toBe("one\ntwo\n")
      expect(yield* exists(created)).toBe(false)
      yield* revert.unrevert({ sessionID: session.id })
      expect(yield* Effect.promise(() => Bun.file(edited).text())).toBe("one\nthree\n")
      expect(yield* exists(created)).toBe(true)
    }, Effect.ensuring(releaseAll)),
    { git: true, config: providerCfg },
  ),
)

it.live("aborting while the turn snapshot is pending leaves consistent parts and runs no write", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ dir, llm }) {
      const prompt = yield* SessionPrompt.Service
      const status = yield* SessionStatus.Service
      const snapshot = yield* Snapshot.Service
      const created = path.join(dir, "created.txt")
      holds.length = 0
      const before = yield* snapshot.track()

      const release = yield* Deferred.make<void>()
      releases.push(release)
      holds.push(release)
      yield* llm.pushMatch(
        asks("abort me"),
        reply()
          .tool("bash", { command: `echo created > ${created}` })
          .hang(),
      )

      const session = yield* startSession("abort me")
      const loop = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)
      yield* pollWithTimeout(
        allParts(session.id).pipe(
          Effect.map((parts) => (toolPart(parts, "bash")?.state.status === "running" ? true : undefined)),
        ),
        "the write-capable tool was never called",
      )

      const cancel = yield* prompt.cancel(session.id).pipe(Effect.forkChild)
      yield* pollWithTimeout(
        allParts(session.id).pipe(
          Effect.map((parts) => (toolPart(parts, "bash")?.state.status === "error" ? true : undefined)),
        ),
        "the abort did not reach the processor",
      )
      // The abort waits for the pending snapshot so the parts it belongs to are complete.
      expect(cancel.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(cancel)
      yield* Fiber.await(loop)

      const parts = yield* allParts(session.id)
      expect(yield* exists(created)).toBe(false)
      expect(parts.filter((part) => part.type === "step-start")).toEqual([
        expect.objectContaining({ snapshot: before }),
      ])
      expect(parts.some((part) => part.type === "patch")).toBe(false)
      expect((yield* status.get(session.id)).type).toBe("idle")
    }, Effect.ensuring(releaseAll)),
    { git: true, config: providerCfg },
  ),
)

/*
 * A run whose turn has ended still finishes its snapshots before it lets go of the session. A prompt stored in that
 * window joins the run, which has already read history for the last time. Holding the step's closing snapshot keeps
 * the run there: the turn has ended (its "exiting loop" is logged) and the run has not been released.
 */
const sendAsRunFinishes = (input: {
  queued_prompts: "next_step" | "turn_end"
  send: (
    sessionID: Session.Info["id"],
  ) => Effect.Effect<{ id: MessageID; fiber: Fiber.Fiber<SessionV1.WithParts, unknown> }, never, SessionPrompt.Service>
}) =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      holds.length = 0
      const release = yield* Deferred.make<void>()
      releases.push(release)
      holds.push(undefined, release, release)
      yield* llm.textMatch(asks("late words"), "late answer")
      yield* llm.textMatch(asks("first question"), "first answer")

      let exits = 0
      const capture = Logger.make((options) => {
        const message = Array.isArray(options.message) ? options.message[0] : options.message
        if (message === "exiting loop") exits++
      })
      const session = yield* startSession("first question")
      const loop = yield* prompt
        .loop({ sessionID: session.id })
        .pipe(Effect.provideService(Logger.CurrentLoggers, new Set([capture])), Effect.forkChild)
      yield* pollWithTimeout(
        Effect.sync(() => (exits > 0 ? true : undefined)),
        "the turn did not end",
      )
      expect(loop.pollUnsafe()).toBeUndefined()

      const sent = yield* input.send(session.id)
      yield* pollWithTimeout(
        sessions.messages({ sessionID: session.id }).pipe(
          Effect.orDie,
          Effect.map((msgs) => (msgs.some((msg) => msg.info.id === sent.id) ? true : undefined)),
        ),
        "the late input was not stored",
      )
      yield* Deferred.succeed(release, undefined)
      const result = yield* Fiber.join(loop)
      const late = yield* Fiber.join(sent.fiber)
      return {
        result,
        lateID: sent.id,
        late,
        turns: (yield* llm.hits).filter((hit) => !asks("Generate a title")(hit)).length,
        messages: (yield* sessions.messages({ sessionID: session.id }).pipe(Effect.orDie)).map((msg) => msg.info),
      }
    }, Effect.ensuring(releaseAll)),
    { git: true, config: (url) => ({ ...providerCfg(url), queued_prompts: input.queued_prompts }) },
  )

const sendLate = (noReply: boolean) => (sessionID: Session.Info["id"]) =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const id = MessageID.ascending()
    const fiber = yield* prompt
      .prompt({ sessionID, messageID: id, agent: "build", noReply, parts: [{ type: "text", text: "late words" }] })
      .pipe(Effect.forkChild)
    return { id, fiber }
  })

for (const queued_prompts of ["next_step", "turn_end"] as const) {
  it.live(`with queued_prompts ${queued_prompts}, a prompt stored as the run finishes its ended turn is answered`, () =>
    Effect.gen(function* () {
      const run = yield* sendAsRunFinishes({ queued_prompts, send: sendLate(false) })

      expect(run.turns).toBe(2)
      const answer = run.messages.at(-1)
      expect(answer?.role === "assistant" ? answer.parentID : undefined).toBe(run.lateID)
      expect(run.late.info.id).toBe(answer!.id)
      expect(run.result.info.id).toBe(answer!.id)
    }),
  )
}

it.live("a note without a reply stored as the run finishes its ended turn starts no turn", () =>
  Effect.gen(function* () {
    const run = yield* sendAsRunFinishes({ queued_prompts: "next_step", send: sendLate(true) })

    expect(run.turns).toBe(1)
    expect(run.messages.at(-1)?.role).toBe("user")
  }),
)
