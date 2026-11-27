import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect, Fiber, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import path from "node:path"
import { MessageID } from "../../../src/session/schema"
import { cliIt } from "../../lib/cli-process"
import { pollWithTimeout } from "../../lib/effect"
import { reply } from "../../lib/llm-server"
import { testProviderConfig } from "../../lib/test-provider"

const decodeSession = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))
const decodeHistory = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  info: Schema.Struct({ id: Schema.String, role: Schema.String, promptOrigin: Schema.optional(Schema.Unknown) }),
})))

cliIt.live("attributes only the selected v1 prompt through tool steps, queued input and database reopen", ({ home, llm, opencode }) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const dbPath = path.join(home, "meridian-prompt-origin.db")
    const env = {
      OPENCODE_DB: dbPath,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        ...testProviderConfig(llm.url),
        model: "test/test-model",
        enabled_providers: ["test"],
        queued_prompts: "turn_end",
      }),
      VIBETERM_MERIDIAN_ATTRIBUTION_ENDPOINTS: JSON.stringify([new URL("/v1/chat/completions", llm.url).href]),
    }
    const post = (base: string, route: string, body: object) => client.execute(
      HttpClientRequest.post(new URL(route, base)).pipe(HttpClientRequest.bodyJsonUnsafe(body)),
    )
    const work = (text: string, extra: object = {}) => ({ ...extra, parts: [{ type: "text", text }] })
    const helper = { client: "oh-my-openagent", version: "5.0.0+helper", purpose: "helper" }
    const subagent = { client: "oh-my-openagent", version: "5.0.0-subagent", purpose: "subagent" }
    const review = { client: "oh-my-openagent", version: "v".repeat(64), purpose: "review" }
    const step = Promise.withResolvers<void>()
    yield* llm.push(reply().tool("todowrite", { todos: [] }).wait(step.promise))
    yield* llm.text("fixture tool continuation")
    yield* llm.text("fixture human response")
    yield* llm.error(429, { error: { message: "fixture retry" } })
    yield* llm.text("fixture async response")

    const routes = yield* Effect.scoped(Effect.gen(function* () {
      const server = yield* opencode.serve({ hostname: "127.0.0.1", env })
      const created = yield* post(server.url, "/session", {})
      expect(created.status).toBe(200)
      const session = decodeSession(yield* created.json)
      const base = `/session/${session.id}`
      const sync = `${base}/message`
      const async = `${base}/prompt_async`
      const pending = yield* post(server.url, sync, work("fixture helper prompt", { promptOrigin: helper })).pipe(
        Effect.tap((response) => response.json),
        Effect.forkChild,
      )
      yield* pollWithTimeout(
        llm.hits.pipe(Effect.map((hits) => hits.find((hit) => Array.isArray(hit.body.tools) && hit.body.tools.length > 0))),
        "the held helper tool request never reached the receiver",
      )

      const notice = yield* post(server.url, async, {
        noReply: true,
        promptOrigin: { ...subagent },
        parts: [{ type: "text", text: "fixture reader notice", ignored: true }],
      })
      expect(notice.status).toBe(204)
      const queued = yield* post(server.url, async, work("fixture human prompt", { promptOrigin: { ...helper, version: "bad\nvalue" } }))
      expect(queued.status).toBe(204)
      step.resolve()
      expect((yield* Fiber.join(pending)).status).toBe(200)
      yield* llm.wait(4)

      const attributed = yield* post(server.url, async, work("fixture async prompt", { promptOrigin: subagent }))
      expect(attributed.status).toBe(204)
      yield* llm.wait(6)
      const deferred = yield* post(server.url, async, work("fixture review prompt", { noReply: true, promptOrigin: review }))
      expect(deferred.status).toBe(204)
      return { id: session.id, base, sync }
    }))

    const restarted = yield* opencode.serve({ hostname: "127.0.0.1", env })
    const history = yield* client.get(new URL(routes.sync, restarted.url))
    const origins = decodeHistory(yield* history.json).filter((row) => row.info.role === "user")
      .map((row) => row.info.promptOrigin ?? null)
    const sent = yield* post(restarted.url, `${routes.base}/send-now`, {})
    expect(sent.status).toBe(200)
    yield* llm.wait(7)

    const rows = (yield* llm.hits).map((hit): {
      readonly path: string
      readonly client: string
      readonly purpose: string
      readonly affinity: string
      readonly fallbackSession: string | null
    } => ({
      path: hit.url.pathname,
      client: hit.headers["x-meridian-client"],
      purpose: hit.headers["x-meridian-purpose"],
      affinity: hit.headers["x-session-affinity"],
      fallbackSession: hit.headers["x-meridian-session"] ?? null,
    }))
    using db = new Database(dbPath, { readonly: true })
    const stored = db.query<{ origin: string | null }, [string]>(
      "SELECT json_extract(data, '$.promptOrigin') AS origin FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY id",
    ).all(routes.id).map((row) => row.origin ? JSON.parse(row.origin) : null)
    if (process.env.OPENCODE_TEST_PROMPT_ORIGIN_EVIDENCE === "1") {
      console.info(JSON.stringify({ receiver: rows, persisted: stored, reopened: origins }))
    }
    const row = (client: string, purpose: string) => ({
      path: "/v1/chat/completions", client, purpose, affinity: routes.id, fallbackSession: null,
    })
    expect(rows.filter((hit) => hit.purpose === "title")).toEqual([row("opencode/local", "title")])
    expect(rows.filter((hit) => hit.purpose !== "title")).toEqual([
      row("oh-my-openagent/5.0.0+helper", "helper"),
      row("oh-my-openagent/5.0.0+helper", "helper"),
      row("opencode/local", "chat"),
      row("oh-my-openagent/5.0.0-subagent", "subagent"),
      row("oh-my-openagent/5.0.0-subagent", "subagent"),
      row(`oh-my-openagent/${review.version}`, "review"),
    ])
    expect(stored).toEqual([helper, null, null, subagent, review])
    expect(origins).toEqual(stored)
  }),
  60_000,
)

cliIt.live("public part edits cannot reassign a stored compaction continuation owner", ({ home, llm, opencode }) =>
  Effect.gen(function* () {
    const dbPath = path.join(home, "compaction-owner.db")
    const env = {
      OPENCODE_DB: dbPath,
      OPENCODE_DISABLE_AUTOCOMPACT: "0",
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        ...testProviderConfig(llm.url),
        model: "test/test-model",
        enabled_providers: ["test"],
      }),
    }
    yield* llm.text("fixture earlier answer")
    yield* llm.error(400, { type: "error", error: { code: "context_length_exceeded" } })
    yield* llm.text("fixture compaction summary")
    yield* llm.text("fixture replay answer")

    const edited = yield* Effect.scoped(Effect.gen(function* () {
      const server = yield* opencode.serve({ hostname: "127.0.0.1", env })
      const api = createOpencodeClient({ baseUrl: server.url, directory: home })
      return yield* Effect.promise(async () => {
        const call = { throwOnError: true, signal: AbortSignal.timeout(20_000) } as const
        const created = await api.session.create({ title: "Compaction owner" }, call)
        const sessionID = created.data.id
        const earlier = await api.session.prompt({ sessionID, parts: [{ type: "text", text: "fixture earlier prompt" }] }, call)
        const original = MessageID.ascending()
        await api.session.prompt({
          sessionID,
          messageID: original,
          promptOrigin: { client: "oh-my-openagent", version: "5.0.0+fixture", purpose: "helper" },
          parts: [{ type: "text", text: "fixture original work" }],
        }, call)
        const all = await api.session.messages({ sessionID }, call)
        const marker = all.data.flatMap(({ parts }) => parts)
          .find((part) => part.type === "compaction" && part.continuation_message_id === original)
        if (!marker || marker.type !== "compaction") throw new Error("Expected the engine-created marker for the submitted work")
        const params = { sessionID, messageID: marker.messageID, partID: marker.id }
        const updated = await api.part.update({
          ...params,
          part: { ...marker, overflow: false, continuation_message_id: earlier.data.info.parentID },
        }, call)
        return { params, marker, original, updated: updated.data, earlier: earlier.data.info.parentID }
      })
    }))

    const restarted = yield* opencode.serve({ hostname: "127.0.0.1", env })
    const api = createOpencodeClient({ baseUrl: restarted.url, directory: home })
    const call = { throwOnError: true, signal: AbortSignal.timeout(20_000) } as const
    const reopened = yield* Effect.promise(() => api.session.message(edited.params, call))
    const marker = reopened.data.parts.find((part) => part.id === edited.marker.id)
    if (process.env.OPENCODE_TEST_PROMPT_ORIGIN_EVIDENCE === "1") {
      console.info(JSON.stringify({ original: edited.original, attempted: edited.earlier, updated: edited.updated, reopened: marker }))
    }
    expect({ edited: edited.updated, reopened: marker }).toEqual({
      edited: { ...edited.marker, overflow: false, continuation_message_id: edited.original },
      reopened: { ...edited.marker, overflow: false, continuation_message_id: edited.original },
    })

    yield* Effect.promise(async () => {
      const { params } = edited
      const wrong = { ...params, messageID: edited.earlier }
      const replacement = { ...params, id: params.partID, type: "text", text: "not a compaction marker" } as const
      const seeded = await api.part.update({
        ...wrong,
        partID: "prt_client_created",
        part: { ...edited.marker, id: "prt_client_created", messageID: wrong.messageID },
      }, call)
      expect(seeded.data).toMatchObject({ type: "compaction" })
      expect(seeded.data).not.toHaveProperty("continuation_message_id")
      expect((await api.part.update({ ...params, part: replacement })).response.status).toBe(400)
      expect((await api.part.update({ ...wrong, part: { ...replacement, messageID: wrong.messageID } })).response.status).toBe(400)
      expect((await api.part.delete(wrong)).response.status).toBe(400)
      expect((await api.part.delete(params)).response.status).toBe(400)
      const stored = await api.session.message(params, call)
      expect(stored.data.parts.find((part) => part.id === params.partID)).toEqual(marker)
    })
  }),
  90_000,
)
