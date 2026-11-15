import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { eq } from "drizzle-orm"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { LSP } from "@/lsp/lsp"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionArchive } from "@/session/archive"
import { SessionSummary } from "@/session/summary"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      SessionProjector.node,
      Session.node,
      SessionStatus.node,
      Database.node,
      FSUtil.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
      [
        MCP.node,
        Layer.mock(MCP.Service, {
          tools: () => Effect.succeed({}),
          instructions: () => Effect.succeed([]),
          clients: () => Effect.succeed({}),
        }),
      ],
      [
        LSP.node,
        Layer.mock(LSP.Service, {
          init: () => Effect.void,
          diagnostics: () => Effect.succeed({}),
          hasClients: () => Effect.succeed(false),
        }),
      ],
      [
        SessionSummary.node,
        Layer.succeed(
          SessionSummary.Service,
          SessionSummary.Service.of({
            summarize: () => Effect.void,
            diff: () => Effect.succeed([]),
            computeDiff: () => Effect.succeed([]),
          }),
        ),
      ],
    ],
  ),
)

const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }
const by = { kind: "ai" as const, machine: "m4max", sessionId: "ses_replacement", tool: "repair" }
const archivedAt = 1794614400000
const setup = Effect.fn("archive.setup")(function* () {
  const { directory } = yield* TestInstance
  const llm = yield* TestLLMServer
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(directory, "opencode.json"),
    JSON.stringify({
      ...testProviderConfig(llm.url),
      command: { work: { template: "Do $ARGUMENTS" } },
    }),
  )
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({
    title: "Archive",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
  const archived = { at: archivedAt, note: "Replaced by the repaired copy", by }
  const metadata = {
    custom: { keep: true },
    vibeterm: {
      other: "keep",
      archive: {
        sessionId: chat.id,
        archived,
        announcedAt: archivedAt,
        extra: "keep",
      },
    },
  }
  const { db } = yield* Database.Service
  // Vibeterm archives without an engine event, after a caller may already have read the session.
  yield* db
    .update(SessionTable)
    .set({ time_archived: archivedAt, metadata })
    .where(eq(SessionTable.id, chat.id))
    .run()
    .pipe(Effect.orDie)
  return { chat, sessions, llm, metadata, prompt: yield* SessionPrompt.Service }
})

const text = (sessionID: SessionID) => ({
  sessionID,
  model,
  agent: "build",
  parts: [{ type: "text" as const, text: "keep my work" }],
})

it.instance(
  "refuses a freshly archived prompt without storing a message or starting a loop",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      yield* ctx.llm.text("must not run")
      const exit = yield* ctx.prompt.prompt(text(ctx.chat.id)).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit))
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "SessionArchivedError",
          data: { sessionID: ctx.chat.id, archivedAt, note: ctx.metadata.vibeterm.archive.archived.note, by },
        })
      expect(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).toEqual([])
      expect(yield* ctx.llm.calls).toBe(0)
      expect((yield* (yield* SessionStatus.Service).get(ctx.chat.id)).type).toBe("idle")
    }),
  { git: true },
)

it.instance(
  "stores a noReply note while leaving the session archived and starting no turn",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      const note = yield* ctx.prompt.prompt({ ...text(ctx.chat.id), noReply: true })
      expect(note.info.role).toBe("user")
      expect((yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).map((msg) => msg.info.id)).toEqual([
        note.info.id,
      ])
      expect((yield* ctx.sessions.get(ctx.chat.id)).time.archived).toBe(archivedAt)
      expect(yield* ctx.llm.calls).toBe(0)
    }),
  { git: true },
)

it.instance(
  "unarchive before a prompt preserves unrelated metadata and then runs the turn",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      yield* ctx.llm.text("sent once")
      const before = Date.now()
      const result = yield* ctx.prompt.prompt({ ...text(ctx.chat.id), unarchive: true })
      const session = yield* ctx.sessions.get(ctx.chat.id)
      expect(session.time.archived).toBeUndefined()
      expect(session.metadata).toMatchObject({
        custom: { keep: true },
        vibeterm: {
          other: "keep",
          archive: {
            sessionId: ctx.chat.id,
            archived: ctx.metadata.vibeterm.archive.archived,
            extra: "keep",
            unarchived: { by: { kind: "user", machine: process.env.VIBETERM_MACHINE_NAME ?? null, client: "api" } },
          },
        },
      })
      expect(session.metadata?.vibeterm.archive.announcedAt).toBeUndefined()
      expect(session.metadata?.vibeterm.archive.unarchived.at).toBeGreaterThanOrEqual(before)
      expect(session.metadata?.vibeterm.archive.unarchived.at).toBeLessThanOrEqual(Date.now())
      expect(result.info.role).toBe("assistant")
      expect(yield* ctx.llm.calls).toBe(1)
    }),
  { git: true },
)

it.instance(
  "ignores archive notes copied from another session",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      yield* ctx.sessions.setMetadata({
        sessionID: ctx.chat.id,
        metadata: {
          vibeterm: {
            archive: {
              ...ctx.metadata.vibeterm.archive,
              sessionId: "ses_foreign",
            },
          },
        },
      })
      yield* ctx.llm.text("must not run")
      const exit = yield* ctx.prompt.prompt(text(ctx.chat.id)).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(SessionArchive.Error)
        if (error instanceof SessionArchive.Error) expect(error.data).toEqual({ sessionID: ctx.chat.id, archivedAt })
      }
    }),
  { git: true },
)

for (const kind of ["command", "shell"] as const) {
  it.instance(
    `refuses an archived ${kind} before it stores or executes work`,
    () =>
      Effect.gen(function* () {
        const ctx = yield* setup()
        yield* ctx.llm.text("must not run")
        const exit: Exit.Exit<unknown, unknown> =
          kind === "command"
            ? yield* ctx.prompt
                .command({ sessionID: ctx.chat.id, command: "work", arguments: "nothing", model: "test/test-model" })
                .pipe(Effect.exit)
            : yield* ctx.prompt
                .shell({ sessionID: ctx.chat.id, command: "printf must-not-run", agent: "build", model })
                .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SessionArchivedError" })
        expect(yield* ctx.sessions.messages({ sessionID: ctx.chat.id })).toEqual([])
        expect(yield* ctx.llm.calls).toBe(0)
      }),
    { git: true },
  )
}

it.instance(
  "archiving a running turn does not block its internal continuation",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup()
      yield* ctx.sessions.setArchived({ sessionID: ctx.chat.id })
      const gate = yield* Deferred.make<void>()
      yield* ctx.llm.push(
        reply()
          .wait(Effect.runPromise(Deferred.await(gate)))
          .tool("bash", { command: "printf continued", description: "continue" }),
      )
      yield* ctx.llm.text("finished")
      const turn = yield* ctx.prompt.prompt(text(ctx.chat.id)).pipe(Effect.forkChild)
      yield* ctx.llm.wait(1)
      yield* ctx.sessions.setArchived({ sessionID: ctx.chat.id, time: archivedAt })
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(turn)
      expect(yield* ctx.llm.calls).toBe(2)
      expect((yield* ctx.sessions.get(ctx.chat.id)).time.archived).toBe(archivedAt)
    }),
  { git: true, config: { permission: { "*": "allow" } } },
  30_000,
)
