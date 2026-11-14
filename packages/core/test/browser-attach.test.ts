import { expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import type { Permission } from "@opencode/schema/permission"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionContext } from "@opencode/core/session/context"
import { SessionMessage } from "@opencode/core/session/message"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// The browser plugin's `session.permissions` writes, as the test orders them.
const writes: {
  /**
   * While set, a revoke reads the session, then waits until a grant has written; that grant waits until the revoke has
   * read. This is the interleaving that loses a replacement's grant to its predecessor's stale revoke.
   */
  race?: { readonly revokeRead: Deferred.Deferred<void>; readonly granted: Deferred.Deferred<void> }
  /** Completes when a revoke write finishes. */
  revoked: Deferred.Deferred<void>
} = { revoked: Deferred.makeUnsafe() }

const isGrant = (permissions: Permission.Ruleset) =>
  permissions.some((rule) => rule.action === "browser.attach" && rule.effect === "allow")

const orderedWrites = Session.node.replace(
  Session.node.mapLayer((base) =>
    Layer.effect(
      Session.Service,
      Effect.map(Session.Service, (sessions) =>
        Session.Service.of({
          ...sessions,
          setPermissions: (input) => {
            const race = writes.race
            if (isGrant(input.permissions))
              return race
                ? Deferred.await(race.revokeRead).pipe(
                    Effect.andThen(sessions.setPermissions(input)),
                    Effect.ensuring(Deferred.succeed(race.granted, undefined)),
                  )
                : sessions.setPermissions(input)
            const revoked = writes.revoked
            return (
              race
                ? Deferred.succeed(race.revokeRead, undefined).pipe(
                    Effect.andThen(Deferred.await(race.granted)),
                    Effect.andThen(sessions.setPermissions(input)),
                  )
                : sessions.setPermissions(input)
            ).pipe(Effect.ensuring(Deferred.succeed(revoked, undefined)))
          },
        }),
      ),
    ).pipe(Layer.provide(base)),
  ),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Session.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    orderedWrites,
  ]),
)

const user = { action: "browser", resource: "*", effect: "allow" } as const
const allows = [
  { action: "browser.attach", resource: "*", effect: "allow" },
  { action: "skill", resource: "browser", effect: "allow" },
] as const

const setup = Effect.gen(function* () {
  writes.race = undefined
  writes.revoked = Deferred.makeUnsafe()
  const dir = yield* tmpdirScoped()
  const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
  const locations = yield* LocationServiceMap.Service
  const context = yield* locations.contextEffect(ref).pipe(Effect.scoped)
  yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
  const sessions = yield* Session.Service
  const session = yield* sessions.create({ location: ref, permissions: [user] })
  const rpc = Context.get(context, Rpc.Service).client(Browser.Definition)
  const handshakes = new Map<string, Deferred.Deferred<void>>()
  const handshake = (connectionID: string) => {
    const existing = handshakes.get(connectionID)
    if (existing) return existing
    const created = Deferred.makeUnsafe<void>()
    handshakes.set(connectionID, created)
    return created
  }
  yield* rpc.events.subscribe("control").pipe(
    Stream.runForEach((event) =>
      event.data.type === "attached" ? Deferred.succeed(handshake(event.data.connectionID), undefined) : Effect.void,
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
  return {
    ref,
    locations,
    sessions,
    session,
    rpc,
    select: Context.get(context, SessionContext.Service).select(session.id),
    attach: (connectionID: string) =>
      rpc.attach({ sessionID: session.id, connectionID, version: 4 }).pipe(Effect.forkScoped),
    attached: (connectionID: string) => Deferred.await(handshake(connectionID)).pipe(Effect.timeout("10 seconds")),
    permissions: Effect.map(sessions.get(session.id), (info) => info.permissions ?? []),
  }
})

it.live("a replaced attachment's revoke never removes its replacement's grant", () =>
  Effect.gen(function* () {
    const browser = yield* setup
    const first = yield* browser.attach("conn_1")
    yield* browser.attached("conn_1")
    expect(yield* browser.permissions).toEqual([user, ...allows])

    const race = { revokeRead: Deferred.makeUnsafe<void>(), granted: Deferred.makeUnsafe<void>() }
    writes.race = race
    const second = yield* browser.attach("conn_2")
    expect(yield* Fiber.join(first)).toBe("replaced")
    yield* browser.attached("conn_2")
    // A revoke for conn_1, if one ran, was held until conn_2's grant wrote; let it land before reading.
    if (yield* Deferred.isDone(race.revokeRead)) yield* Deferred.await(writes.revoked)
    expect(yield* browser.permissions).toEqual([user, ...allows])

    writes.race = undefined
    writes.revoked = Deferred.makeUnsafe()
    yield* Fiber.interrupt(second)
    yield* Deferred.await(writes.revoked).pipe(Effect.timeout("10 seconds"))
    expect(yield* browser.permissions).toEqual([user])
  }),
)

it.live("disposing the plugin revokes the browser rules before the location finishes closing", () =>
  Effect.gen(function* () {
    const browser = yield* setup
    yield* browser.attach("conn_1")
    yield* browser.attached("conn_1")
    expect(yield* browser.permissions).toEqual([user, ...allows])

    yield* browser.locations.invalidate(browser.ref)
    expect(yield* browser.permissions).toEqual([user])
  }),
)

it.live("only an attachment exposes and runs built-in browser tools, preserving generic browser grants", () =>
  Effect.gen(function* () {
    const browser = yield* setup
    yield* browser.sessions.setPermissions({
      sessionID: browser.session.id,
      permissions: [user, { action: "execute", resource: "*", effect: "deny" }],
    })
    const before = yield* browser.select
    expect(before.tools.definitions.filter((tool) => tool.name.startsWith("browser_"))).toEqual([])

    const attachment = yield* browser.attach("conn_tools")
    yield* browser.attached("conn_tools")
    const selected = yield* browser.select
    expect(
      selected.tools.definitions.filter((tool) => tool.name.startsWith("browser_")).map((tool) => tool.name),
    ).toEqual(Browser.Operations.map((operation) => `browser_${operation.name.replaceAll(".", "_")}`).toSorted())
    const state = { tabs: [], focusedTabID: null }
    yield* browser.rpc.state({ sessionID: browser.session.id, connectionID: "conn_tools", state })
    yield* browser.rpc.events.subscribe("control").pipe(
      Stream.runForEach((event) => {
        if (event.data.type !== "command") return Effect.void
        const request = { sessionID: browser.session.id, ...event.data }
        return browser.rpc.command(request).pipe(
          Effect.flatMap((command) => {
            expect(command.action).toEqual({ type: "tabs.list" })
            return browser.rpc.result({ ...request, outcome: { type: "success", result: { value: state, files: [] } } })
          }),
        )
      }),
      Effect.forkScoped({ startImmediately: true }),
    )

    const result = yield* selected.tools.execute({
      sessionID: browser.session.id,
      agent: selected.agent.id,
      messageID: SessionMessage.ID.create(),
      call: { type: "tool-call", id: "browser-tabs", name: "browser_tabs_list", input: {} },
    })
    expect(result.output).toEqual(state)

    writes.revoked = Deferred.makeUnsafe()
    yield* Fiber.interrupt(attachment)
    yield* Deferred.await(writes.revoked).pipe(Effect.timeout("10 seconds"))
    const after = yield* browser.select
    expect(after.tools.definitions.filter((tool) => tool.name.startsWith("browser_"))).toEqual([])
    expect(after.session.permissions).toEqual([user, { action: "execute", resource: "*", effect: "deny" }])
  }),
)
