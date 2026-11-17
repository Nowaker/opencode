import assert from "node:assert/strict"
import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { ModelsDev } from "@opencode/core/models-dev"
import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionInboxTable, SessionMessageTable } from "@opencode/core/session/sql"
import { Agent } from "@opencode/schema/agent"
import { Location } from "@opencode/schema/location"
import { Model } from "@opencode/schema/model"
import { PromptInput } from "@opencode/schema/prompt-input"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { TextareaRenderable, type KeyEvent } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Schema } from "effect"
import { createEffect } from "solid-js"
import { tempGlobalLayer } from "../../../core/test/fixture/global"
import { promptLocationNode } from "../../../core/test/fixture/prompt-location"
import { testEffect } from "../../../core/test/lib/effect"
import { globalProjectNode } from "../../../core/test/lib/project"
import { useLocal } from "../../src/context/local"
import { StartupComposer } from "../../src/startup/composer"
import { composerEditor, mountComposer } from "../fixture/composer"
import { directory, json, worktree } from "../fixture/tui-client"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Session.node]), [
    Global.node.replace(tempGlobalLayer),
    Bus.node.replace(Bus.configured({ persist: true })),
    ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
    Project.node.replace(globalProjectNode),
    LocationServiceMap.node.replace(promptLocationNode),
    SessionExecution.node.replace(SessionExecution.noopLayer),
  ]),
)

it.live("one final-editor Enter during cold catalog hydration eventually admits the handed-off draft once", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const database = yield* Database.Service
    const sessionID = Session.ID.make("ses_observation_a")
    const info = Schema.encodeSync(Session.Info)(
      yield* sessions.create({
        id: sessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
        title: "Catalog submit",
        agent: Agent.ID.make("build"),
        model: { providerID: Provider.ID.make("provider"), id: Model.ID.make("model") },
      }),
    )
    const terminal = yield* Effect.acquireRelease(
      Effect.promise(() => createTestRenderer({ width: 100, height: 35, kittyKeyboard: true })),
      (setup) =>
        Effect.promise(async () => {
          if (!setup.renderer.isDestroyed) await setup.dispose()
        }),
    )
    yield* Effect.promise(() => terminal.renderer.setupTerminal())
    const startup = StartupComposer.create(terminal.renderer, {
      route: "session",
      snapshot: { text: "", caret: 0, anchor: 0, touched: false, submit: false },
      resume: () => {},
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => startup.dispose()))
    yield* Effect.promise(async () => {
      await terminal.renderOnce()
      const early = terminal.renderer.currentFocusedEditor
      assert.ok(early instanceof TextareaRenderable)
      expect(early.id).toBe("startup-composer-input")
      terminal.renderer.stdin.emit("data", Buffer.from("w15-draft-12345678\x1b[D\x1b[D\x1b[1;2D\x1b[1;2D"))
      expect({ caret: early.cursorOffset, range: early.getSelection(), text: early.getSelectedText() }).toEqual({
        caret: 14,
        range: { start: 14, end: 16 },
        text: "56",
      })

      const catalog = Promise.withResolvers<void>()
      const requested = new Set<string>()
      const requestedBoth = Promise.withResolvers<void>()
      const receipt = Promise.withResolvers<void>()
      const prompt = Schema.Struct({
        ...PromptInput.Prompt.fields,
        id: Schema.optional(SessionMessage.ID),
        delivery: Schema.optional(SessionInbox.Delivery),
        resume: Schema.optional(Schema.Boolean),
      })
      const invocations: Request[] = []
      const calls: (typeof prompt.Type)[] = []
      const admissions: Promise<SessionInbox.User>[] = []
      const location = { directory, project: { id: info.projectID, directory: worktree, canonical: worktree } }
      const mounted = Promise.withResolvers<ReturnType<typeof useLocal>>()
      const preferences = Promise.withResolvers<void>()
      const hydrated = Promise.withResolvers<void>()
      try {
        await using setup = await mountComposer({
          setup: terminal,
          startup,
          args: { sessionID },
          config: { animations: false, tabs: { mode: "off" } },
          fetch: async (url, request) => {
            if (url.pathname === `/api/session/${sessionID}`) return json({ data: info })
            if (url.pathname === "/api/agent" || url.pathname === "/api/model") {
              requested.add(url.pathname)
              if (requested.size === 2) requestedBoth.resolve()
              await catalog.promise
              return json({
                location,
                data:
                  url.pathname === "/api/agent"
                    ? [{ id: "build", mode: "primary", hidden: false, permissions: [] }]
                    : [{ id: "model", providerID: "provider", name: "Model", variants: [] }],
              })
            }
            if (url.pathname === "/api/provider")
              return json({ location, data: [{ id: "provider", name: "Provider" }] })
            if (url.pathname !== `/api/session/${sessionID}/prompt`) return undefined
            invocations.push(request)
            const body = Schema.decodeUnknownSync(prompt)(await request.json())
            calls.push(body)
            const admitted = Effect.runPromise(sessions.prompt({ sessionID, ...body }))
            admissions.push(admitted)
            const item = await admitted
            receipt.resolve()
            return json({ data: Schema.encodeSync(SessionInbox.User)(item) })
          },
        })
        using _releaseCatalog = { [Symbol.dispose]: () => catalog.resolve() }
        setup.context.ui.slot({
          append: "app",
          render: () => {
            const local = useLocal()
            mounted.resolve(local)
            createEffect(() => {
              if (local.model.ready) preferences.resolve()
            })
            createEffect(() => {
              if (local.model.catalogReady && local.agent.current() && local.model.available()) hydrated.resolve()
            })
            return null
          },
        })
        const local = await mounted.promise
        await requestedBoth.promise
        await preferences.promise
        await setup.waitForFrame(() => {
          const editor = setup.renderer.currentFocusedEditor
          return (
            setup.composer.current().status === "ready" &&
            editor instanceof TextareaRenderable &&
            editor.id !== "startup-composer-input" &&
            editor.focused &&
            editor.width > 0 &&
            editor.height > 0
          )
        })
        expect(setup.composer.current()).toMatchObject({
          kind: "final",
          sessionID,
          draft: { text: "w15-draft-12345678", caret: 14, selection: { anchor: 16, focus: 14 } },
        })
        const editor = composerEditor(setup)
        const guards = () => ({
          composer: setup.composer.current(),
          startupActive: startup.active(),
          focused: editor.focused,
          currentEditor: setup.renderer.currentFocusedEditor === editor,
          width: editor.width,
          height: editor.height,
          preferencesReady: local.model.ready,
          catalogReady: local.model.catalogReady,
          agent: local.agent.current()?.id,
          selection: local.model.selection(),
          modelAvailable: local.model.available(),
          agents: local.agent.list().map((item) => item.id),
          submitReachable: setup.context.keymap.commands().some((item) => item.id === "prompt.submit"),
        })
        const entered = Promise.withResolvers<{ readonly event: KeyEvent; readonly guards: ReturnType<typeof guards> }>()
        const observeEnter = (event: KeyEvent) => {
          if (event.name === "return") entered.resolve({ event, guards: guards() })
        }
        setup.renderer.keyInput.prependListener("keypress", observeEnter)
        try {
          setup.renderer.stdin.emit("data", Buffer.from("y\r"))
          const before = await entered.promise
          expect(before.event.defaultPrevented).toBe(true)
          expect(before.guards).toMatchObject({
            composer: { kind: "final", sessionID, draft: { text: "w15-draft-1234y78", caret: 15 } },
            startupActive: false,
            focused: true,
            currentEditor: true,
            preferencesReady: true,
            catalogReady: false,
            agent: undefined,
            selection: undefined,
            modelAvailable: false,
            agents: [],
            submitReachable: true,
          })
          catalog.resolve()
          await hydrated.promise
          // Await a real admission receipt; absence expires into the count assertion below, never a zero predicate.
          const observedReceipt = await Effect.runPromise(
            Effect.promise(() => receipt.promise).pipe(Effect.timeoutOption("2 seconds")),
          )
          await Promise.all(admissions)
          const events = await Effect.runPromise(database.db.select().from(EventTable).all())
          const inbox = await Effect.runPromise(database.db.select().from(SessionInboxTable).all())
          const messages = await Effect.runPromise(database.db.select().from(SessionMessageTable).all())
          const counts = {
            promptApiInvocations: invocations.length,
            durableInboxEnqueues: events.filter(
              (item) => item.aggregate_id === sessionID && item.type === "session.inbox.enqueued.1",
            ).length,
            pendingDurableUsers: inbox.filter((item) => item.session_id === sessionID && item.type === "user").length,
            deliveredUsers: messages.filter((item) => item.session_id === sessionID && item.type === "user").length,
          }
          expect(
            counts.durableInboxEnqueues,
            JSON.stringify({ before: before.guards, after: guards(), observedReceipt, counts }),
          ).toBe(1)
          expect(counts).toEqual({
            promptApiInvocations: 1,
            durableInboxEnqueues: 1,
            pendingDurableUsers: 1,
            deliveredUsers: 0,
          })
          expect(calls).toMatchObject([{ text: "w15-draft-1234y78" }])
        } finally {
          setup.renderer.keyInput.off("keypress", observeEnter)
          catalog.resolve()
        }
      } finally {
        catalog.resolve()
      }
    })
  }),
)
