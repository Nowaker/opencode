import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect, Option, Schema, Stream } from "effect"
import { decode } from "effect/unstable/encoding/Sse"
import path from "node:path"
import type { rpc } from "@/cli/tui/worker"
import { Server } from "@/server/server"
import { isLocalWorkspaceRoute } from "@/server/shared/workspace-routing"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { isRecord } from "@/util/record"
import { Rpc } from "@/util/rpc"
import { tmpdir } from "../fixture/fixture"
import { it, pollWithTimeout } from "../lib/effect"

const eventType = "vibeterm.session.cybersec_preservation.updated"
const inherited = { preference: "inherit", revision: 0 } as const
const EventFrame = Schema.Struct({
  type: Schema.String,
  properties: Schema.optionalKey(Schema.Unknown),
  data: Schema.optionalKey(Schema.Unknown),
})
const GlobalFrame = Schema.Struct({ directory: Schema.optional(Schema.String), payload: EventFrame })
const readFrame = Schema.decodeUnknownSync(Schema.fromJsonString(EventFrame))
const readGlobalFrame = Schema.decodeUnknownSync(Schema.fromJsonString(GlobalFrame))
const readSessionInfo = Schema.decodeUnknownOption(Session.Info)

it.effect("documents the preservation notice on legacy streams and not on v2", () =>
  Effect.gen(function* () {
    const suffix = "VibetermSessionCybersec_preservationUpdated"
    const schemas = (yield* Effect.promise(Server.openapi)).components?.schemas
    expect(JSON.stringify(schemas?.Event)).toContain(`Event${suffix}`)
    expect(JSON.stringify(schemas?.[`Event${suffix}`])).toContain(eventType)
    expect(schemas?.V2Event).toBeDefined()
    expect(JSON.stringify(schemas?.V2Event)).not.toContain(suffix)
  }),
)

const preservation = (id: SessionID) => `/session/${id}/cybersec-preservation`
const sandbox = () => tmpdir({ git: true, config: { formatter: false, lsp: false } })

function json(method: "POST" | "PUT" | "PATCH", body: object): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
}

const responseJSON = Effect.fnUntraced(function* (response: Response) {
  expect(response.status).toBe(200)
  const body: unknown = yield* Effect.promise(() => response.json())
  return body
})

const nativeWorker = Effect.fnUntraced(function* () {
  // The catch-all UI route could proxy a missing API route to the public UI.
  const spec = yield* Effect.promise(Server.openapi)
  const route = spec.paths["/session/{sessionID}/cybersec-preservation"]
  expect(route?.get?.responses["200"]).toBeDefined()
  expect(route?.put?.responses["200"]).toBeDefined()
  expect(route?.put?.requestBody?.required).toBe(true)

  const tmp = yield* Effect.acquireRelease(Effect.promise(sandbox), (dir) =>
    Effect.promise(() => dir[Symbol.asyncDispose]()),
  )
  const databasePath = path.join(tmp.path, "sessions.db")
  const policy = path.join(tmp.path, "auto-switch-policy.mjs")
  yield* Effect.promise(() => Bun.write(policy, `
    export function readAutoSwitchPolicy() {
      return { enabled: true, reason: "default-on", alternates: [], policyRevision: "test" }
    }
  `))
  const worker = yield* Effect.acquireRelease(
    Effect.sync(() => new Worker(new URL("../../src/cli/tui/worker.ts", import.meta.url), {
      env: { ...process.env, OPENCODE_DB: databasePath, VIBETERM_AUTO_SWITCH_POLICY_MODULE: policy },
    })),
    (worker) => Effect.sync(() => worker.terminate()),
  )
  const rpcClient = Rpc.client<typeof rpc>(worker)
  const baseUrl = yield* Effect.promise(async () =>
    (await rpcClient.call("server", { hostname: "127.0.0.1", port: 0 })).url,
  )
  const client = createOpencodeClient({ baseUrl, directory: tmp.path })

  const request = (pathname: string, init?: RequestInit, directory = tmp.path) => Effect.promise((signal) => {
    const headers = new Headers(init?.headers)
    headers.set("x-opencode-directory", directory)
    return fetch(new URL(pathname, baseUrl), { ...init, headers, signal, redirect: "error" })
  })
  const create = Effect.fnUntraced(function* (input: NonNullable<Session.CreateInput> = {}, directory = tmp.path) {
    const response = yield* request("/session", json("POST", input), directory)
    return Schema.decodeUnknownSync(Session.Info)(yield* responseJSON(response))
  })
  const get = (id: SessionID) => request(preservation(id)).pipe(Effect.flatMap(responseJSON))
  const put = (id: SessionID, preference: "inherit" | "on" | "off") =>
    request(preservation(id), json("PUT", { preference })).pipe(Effect.flatMap(responseJSON))
  const bind = (id: SessionID) => Effect.promise(() => rpcClient.call("bindAutoSwitchOwner", { sessionID: id }))
  return { request, create, get, put, bind, client, databasePath, directory: tmp.path }
})

it.live("limits preservation GET and PUT to the native owner tree and validates target and preference", () =>
  Effect.gen(function* () {
    const worker = yield* nativeWorker()
    const root = yield* worker.create()
    const other = yield* worker.create()
    expect(yield* responseJSON(yield* worker.request("/global/health"))).toMatchObject({ cybersecPreservation: 1 })

    expect((yield* worker.request(preservation(root.id))).status).toBe(503)
    expect((yield* worker.request(preservation(root.id), json("PUT", { preference: "on" }))).status).toBe(503)
    expect(yield* worker.bind(root.id)).toBe(true)

    expect(yield* worker.get(root.id)).toEqual(inherited)
    expect((yield* worker.request(preservation(other.id))).status).toBe(503)
    expect((yield* worker.request(preservation(other.id), json("PUT", { preference: "on" }))).status).toBe(503)
    const missing = SessionID.descending()
    expect((yield* worker.request(preservation(missing))).status).toBe(404)
    expect((yield* worker.request(preservation(missing), json("PUT", { preference: "on" }))).status).toBe(404)
    for (const payload of [{}, { preference: true }, { preference: "invalid" }]) {
      expect((yield* worker.request(preservation(root.id), json("PUT", payload))).status).toBe(400)
    }
    const patched = yield* worker.request(`/session/${root.id}`, json("PATCH", {
      metadata: { vibeterm: { cybersecPreservation: { sessionId: root.id, preference: "on", revision: 1 } } },
    }))
    expect(patched.status).toBe(200)
    expect(yield* worker.get(root.id)).toEqual(inherited)

    const child = yield* worker.create({ parentID: root.id })
    expect(yield* worker.get(child.id)).toEqual(inherited)
    const descendant = yield* worker.create({ parentID: child.id })
    yield* Effect.sync(() => {
      // Only direct storage can represent a copied record after generic writes protect the field.
      using db = new Database(worker.databasePath, { create: false })
      const cybersecPreservation = { sessionId: child.id, preference: "on", revision: 9 }
      expect(db.run("UPDATE session SET metadata = ? WHERE id = ?", [
        JSON.stringify({ vibeterm: { cybersecPreservation } }), descendant.id,
      ]).changes).toBe(1)
    })

    expect(yield* worker.get(descendant.id)).toEqual(inherited)
    expect(yield* worker.put(descendant.id, "off")).toEqual({ preference: "off", revision: 1 })
    expect(yield* worker.get(descendant.id)).toEqual({ preference: "off", revision: 1 })
    const archived = yield* worker.request(`/session/${descendant.id}`, json("PATCH", { time: { archived: Date.now() } }))
    expect(archived.status).toBe(200)
    expect((yield* worker.request(preservation(descendant.id))).status).toBe(503)
    expect((yield* worker.request(preservation(descendant.id), json("PUT", { preference: "on" }))).status).toBe(503)

    yield* Effect.acquireRelease(
      Effect.promise(async () => (await worker.client.global.quiescence.acquire({ throwOnError: true })).data),
      (capability) => Effect.promise(() => worker.client.global.quiescence.release(
        { ownerQuiescenceCapability: capability }, { throwOnError: true },
      )),
    )
    expect((yield* worker.request(preservation(root.id))).status).toBe(503)
    expect((yield* worker.request(preservation(root.id), json("PUT", { preference: "on" }))).status).toBe(503)
  }),
  25_000,
)

it.live("keeps owner reads and writes on the control plane", () =>
  Effect.sync(() => {
    const route = preservation(SessionID.descending())
    expect(isLocalWorkspaceRoute("GET", route)).toBe(true)
    expect(isLocalWorkspaceRoute("PUT", route)).toBe(true)
    expect(isLocalWorkspaceRoute("PUT", `${route}/extra`)).toBe(false)
  }),
)

it.live("publishes one scoped preservation notification after each committed owner change", () =>
  Effect.gen(function* () {
    const worker = yield* nativeWorker()
    const root = yield* worker.create()
    expect(yield* worker.bind(root.id)).toBe(true)
    const foreign = yield* Effect.acquireRelease(Effect.promise(sandbox), (dir) =>
      Effect.promise(() => dir[Symbol.asyncDispose]()),
    )
    const local = yield* openEvents(yield* worker.request("/event"), false)
    const elsewhere = yield* openEvents(yield* worker.request("/event", undefined, foreign.path), false)
    const global = yield* openEvents(yield* worker.request("/global/event"), true)
    const v2 = yield* openEvents(yield* worker.request("/api/event"), false)

    // The global stream sends server.connected before installing its listener. Fence on a real event.
    const readyTitle = "preservation stream readiness"
    yield* pollWithTimeout(Effect.gen(function* () {
      if ([global, v2].every((frames) => frames.some((frame) => frame.type === "session.created" &&
        sessionInfo(frame)?.title === readyTitle))) return true
      yield* worker.create({ title: readyTitle })
    }), "global or v2 SSE did not receive the readiness session")

    expect(yield* worker.put(root.id, "on")).toEqual({ preference: "on", revision: 1 })
    using db = new Database(worker.databasePath, { readonly: true })
    const sequence = db.query<{ seq: number }, [SessionID]>("SELECT seq FROM event_sequence WHERE aggregate_id = ?")
    const beforeRepeat = sequence.get(root.id)
    expect(beforeRepeat).not.toBeNull()
    expect(yield* worker.put(root.id, "on")).toEqual({ preference: "on", revision: 1 })
    expect(sequence.get(root.id)).toEqual(beforeRepeat)

    const genericMetadata = { other: "retained", vibeterm: { notes: "keep" } }
    const patched = yield* worker.request(`/session/${root.id}`, json("PATCH", {
      metadata: {
        ...genericMetadata,
        vibeterm: { ...genericMetadata.vibeterm, cybersecPreservation: { sessionId: root.id, preference: "off", revision: 99 } },
      },
    }))
    const session = Schema.decodeUnknownSync(Session.Info)(yield* responseJSON(patched))
    expect(session.metadata).toMatchObject(genericMetadata)
    expect(yield* worker.get(root.id)).toEqual({ preference: "on", revision: 1 })

    const beforeSwitch = yield* Effect.promise(() =>
      worker.client.session.autoSwitch.status({ sessionID: root.id }, { throwOnError: true }),
    )
    const ownerEpoch = beforeSwitch.data.ownerEpoch
    if (ownerEpoch === null) throw new Error("native worker did not issue an auto-switch owner epoch")
    const switched = yield* Effect.promise(() => worker.client.session.autoSwitch.update({
      sessionID: root.id,
      autoSwitchMutation: { action: "set-preference", preference: "off", ownerEpoch, revision: 0 },
    }, { throwOnError: true }))
    expect(switched.data).toMatchObject({ preference: "off", revision: 1 })
    expect(yield* worker.get(root.id)).toEqual({ preference: "on", revision: 1 })

    expect(yield* worker.put(root.id, "inherit")).toEqual({ preference: "inherit", revision: 2 })
    expect(yield* worker.get(root.id)).toEqual({ preference: "inherit", revision: 2 })
    const updated = yield* worker.request(`/session/${root.id}`)
    expect((yield* responseJSON(updated))).toMatchObject({
      metadata: { ...genericMetadata, vibeterm: { ...genericMetadata.vibeterm, autoSwitch: { preference: "off", revision: 1 } } },
    })

    // A subsequent session event fences the negative checks without sleeping for a quiet period.
    const end = yield* worker.create({ parentID: root.id })
    expect(yield* worker.get(end.id)).toEqual(inherited)
    const foreignEnd = yield* worker.create({}, foreign.path)
    const localFrames = yield* throughSessionCreation(local, end.id)
    const globalFrames = yield* throughSessionCreation(global, end.id)
    const foreignFrames = yield* throughSessionCreation(elsewhere, foreignEnd.id)
    const expected = [1, 2].map((revision) => ({ version: 1, sessionID: root.id, revision }))
    for (const frames of [localFrames, globalFrames]) {
      expect(frames.filter((frame) => frame.type === eventType).map((frame) => frame.properties)).toEqual(expected)
      for (const event of expected) {
        const commit = frames.findIndex((frame) => {
          if (frame.type !== "session.updated") return false
          const info = sessionInfo(frame)
          return info?.id === root.id && info.metadata?.vibeterm?.cybersecPreservation?.revision === event.revision
        })
        const notice = frames.findIndex((frame) => frame.type === eventType && isRecord(frame.properties) &&
          frame.properties.revision === event.revision)
        expect(commit).toBeGreaterThanOrEqual(0)
        expect(notice).toBeGreaterThan(commit)
      }
    }
    expect(globalFrames.filter((frame) => frame.type === eventType).map((frame) => frame.directory)).toEqual([
      worker.directory, worker.directory,
    ])
    expect(foreignFrames.filter((frame) => frame.type === eventType)).toEqual([])
    expect((yield* throughSessionCreation(v2, end.id)).filter((frame) => frame.type === eventType)).toEqual([])
  }),
  25_000,
)

type ObservedFrame = typeof EventFrame.Type & { readonly directory?: string }

const openEvents = Effect.fnUntraced(function* (response: Response, global: boolean) {
  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  const body = response.body
  if (!body) throw new Error("SSE response has no body")
  const frames: ObservedFrame[] = []
  yield* Stream.fromReadableStream({ evaluate: () => body, onError: (error) => error }).pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(decode()),
    Stream.runForEach((event) => Effect.sync(() => {
      if (!global) {
        frames.push(readFrame(event.data))
        return
      }
      const envelope = readGlobalFrame(event.data)
      frames.push({ ...envelope.payload, ...(envelope.directory && { directory: envelope.directory }) })
    })),
    Effect.forkScoped,
  )
  return frames
})

function sessionInfo(frame: ObservedFrame) {
  const properties = frame.properties ?? frame.data
  if (isRecord(properties)) return Option.getOrUndefined(readSessionInfo(properties.info))
}

function throughSessionCreation(frames: readonly ObservedFrame[], id: SessionID) {
  return pollWithTimeout(Effect.sync(() => {
    const end = frames.findIndex((frame) => frame.type === "session.created" && sessionInfo(frame)?.id === id)
    return end >= 0 ? frames.slice(0, end) : undefined
  }), `SSE did not reach session.created for ${id}`)
}
