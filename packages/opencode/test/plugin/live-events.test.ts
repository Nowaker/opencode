import { expect } from "bun:test"
import { Cause, Effect } from "effect"
import { mkdir, symlink } from "node:fs/promises"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Npm } from "@opencode-ai/core/npm"
import { Account } from "@/account/account"
import { Auth } from "@/auth"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Server } from "@/server/server"
import { disposeInstance } from "@/effect/instance-registry"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([
  Plugin.node, Session.node, SessionStatus.node, SessionProjector.node, CrossSpawnSpawner.node, Database.node,
]), [
  [Auth.node, AuthTest.empty], [Account.node, AccountTest.empty], [Npm.node, NpmTest.noop],
  [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true, experimentalEventSystem: true })],
]))

for (const spelling of ["symlink", "foreign", "missing"] as const) {
  it.instance(`a plugin live attachment resolves a stored ${spelling} project directory before checking ownership`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const directory = path.join(instance.directory, "projects")
      switch (spelling) {
        case "symlink": yield* Effect.promise(() => symlink(instance.directory, directory, "dir")); break
        case "foreign": yield* Effect.promise(() => mkdir(directory)); break
        case "missing": break
        default: throw new Error(spelling satisfies never)
      }
      const file = path.join(instance.directory, "directory-plugin.ts")
      yield* Effect.promise(() => Bun.write(file, [
        "export default async (input) => ({",
        '  "experimental.chat.system.transform": async (request, output) => {',
        "    const attachment = await input.liveEvents.open({ sessionID: request.sessionID })",
        "    try { output.system.push(JSON.stringify((await attachment.frames.getReader().read()).value)) }",
        "    finally { attachment.close() }",
        "  },",
        "})",
      ].join("\n")))
      yield* Effect.promise(() => Bun.write(path.join(instance.directory, "opencode.json"), JSON.stringify({
        plugin: [pathToFileURL(file).href],
      })))
      const session = yield* Session.Service
      const database = yield* Database.Service
      const plugin = yield* Plugin.Service
      const chat = yield* session.create()
      yield* database.db.update(SessionTable).set({ directory }).where(eq(SessionTable.id, chat.id))
      const output = { system: [] as string[] }
      const result = yield* plugin.trigger("experimental.chat.system.transform", {
        sessionID: chat.id, model: { providerID: ProviderV2.ID.anthropic, modelID: ModelV2.ID.make("test") },
      }, output).pipe(Effect.exit)
      switch (result._tag) {
        case "Success":
          expect(spelling).toBe("symlink")
          expect(JSON.parse(output.system[0])).toMatchObject({
            type: "vibeterm.stream.snapshot", properties: { sessionID: chat.id, messages: [] },
          })
          break
        case "Failure":
          expect(spelling).not.toBe("symlink")
          expect(Cause.squash(result.cause)).toMatchObject({
            name: "LiveEventsDirectoryError", status: spelling === "missing" ? 404 : 409,
          })
          break
        default: throw new Error(result satisfies never)
      }
    }),
  )
}

it.instance("a loaded plugin opens the captured instance capability and receives live frames without starting an HTTP listener", () =>
  Effect.gen(function* () {
    const existingServer = Server.url
    const instance = yield* TestInstance
    const file = path.join(instance.directory, "plugin.ts")
    yield* Effect.promise(() => Bun.write(file, [
      "export default async (input) => {",
      "  let attachment, reader",
      "  return {",
      '    "experimental.chat.system.transform": async (request, output) => {',
      "      if (!reader) {",
      "        attachment = await input.liveEvents.open({ sessionID: request.sessionID })",
      "        reader = attachment.frames.getReader()",
      "      }",
      "      output.system.push(JSON.stringify((await reader.read()).value))",
      "    },",
      "    dispose() { attachment?.close() },",
      "  }",
      "}",
    ].join("\n")))
    yield* Effect.promise(() => Bun.write(path.join(instance.directory, "opencode.json"), JSON.stringify({
      plugin: [pathToFileURL(file).href],
    })))
    const session = yield* Session.Service
    const status = yield* SessionStatus.Service
    const plugin = yield* Plugin.Service
    const chat = yield* session.create()
    yield* status.set(chat.id, { type: "busy" })
    const request = { sessionID: chat.id, model: { providerID: ProviderV2.ID.anthropic, modelID: ModelV2.ID.make("test") } }
    const initial = { system: [] as string[] }
    yield* plugin.trigger("experimental.chat.system.transform", request, initial)
    expect(JSON.parse(initial.system[0])).toMatchObject({
      type: "vibeterm.stream.snapshot", properties: { sessionID: chat.id, sequence: 0, status: { type: "busy" }, messages: [] },
    })
    yield* status.set(chat.id, { type: "idle" })
    const next = { system: [] as string[] }
    yield* plugin.trigger("experimental.chat.system.transform", request, next)
    expect(JSON.parse(next.system[0])).toMatchObject({
      type: "vibeterm.stream.event", properties: { sequence: 1, event: {
        type: "session.status", properties: { sessionID: chat.id, status: { type: "idle" } },
      } },
    })
    expect(Server.url).toBe(existingServer)
  }),
)

it.instance("disposing the plugin instance ends a live attachment even when its plugin has no disposal hook", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const file = path.join(instance.directory, "lifetime-plugin.ts")
    yield* Effect.promise(() => Bun.write(file, [
      "let reader, generation = 0",
      "export default async (input) => { generation++; return ({",
      '  "experimental.chat.system.transform": async (request, output) => {',
      "    output.system.push(String(generation))",
      "    if (!reader) reader = (await input.liveEvents.open({ sessionID: request.sessionID })).frames.getReader()",
      "    output.system.push(JSON.stringify(await reader.read()))",
      "  },",
      "}) }",
    ].join("\n")))
    yield* Effect.promise(() => Bun.write(path.join(instance.directory, "opencode.json"), JSON.stringify({
      plugin: [pathToFileURL(file).href],
    })))
    const session = yield* Session.Service
    const status = yield* SessionStatus.Service
    const plugin = yield* Plugin.Service
    const chat = yield* session.create()
    const request = { sessionID: chat.id, model: { providerID: ProviderV2.ID.anthropic, modelID: ModelV2.ID.make("test") } }
    yield* plugin.trigger("experimental.chat.system.transform", request, { system: [] as string[] })
    yield* Effect.promise(() => disposeInstance(instance.directory))
    yield* status.set(chat.id, { type: "busy" })
    const output = { system: [] as string[] }
    const result = yield* plugin.trigger("experimental.chat.system.transform", request, output).pipe(Effect.exit)
    expect(output.system[0]).toBe("2")
    switch (result._tag) {
      case "Success": expect(JSON.parse(output.system[1])).toEqual({ done: true }); break
      case "Failure": expect(Cause.squash(result.cause)).toMatchObject({ name: "AbortError" }); break
      default: throw new Error(result satisfies never)
    }
  }),
)
