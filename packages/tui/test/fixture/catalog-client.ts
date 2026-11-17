import type { SessionInboxInfo, SessionInfo } from "@opencode/client"
import { PromptInput } from "@opencode/schema/prompt-input"
import { Delivery } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect, Schema } from "effect"
import { agent, model, session } from "./local"
import { directory, json, worktree, type FetchHandler } from "./tui-client"

export type CatalogOutcome = "ready" | "empty-model" | "empty-agent" | "error-model" | "error-agent"
export type CatalogDefault = "cli" | "configured" | "recent"

export function awaitSignal<Value>(signal: Promise<Value>) {
  return Effect.runPromise(Effect.promise(() => signal).pipe(Effect.timeout("2 seconds")))
}

export function catalogClient(input: {
  readonly source?: CatalogDefault
  readonly rejectPrompt?: boolean
  readonly gate?: "models" | "metadata"
} = {}) {
  const gate = Promise.withResolvers<void>()
  const requested = new Set<string>()
  const requestedBoth = Promise.withResolvers<void>()
  const received = Promise.withResolvers<void>()
  const state: { outcome: CatalogOutcome; capture?: () => string } = { outcome: "ready" }
  const catalog = { models: [model("decoy"), model("intended", ["low", "high"]), model("alternate", ["low", "high"])] }
  const selected = { providerID: "provider", id: "intended", variant: "low" }
  const sessions = new Map<string, SessionInfo>([
    ["ses_observation_a", session("ses_observation_a", selected, "plan")],
    ["ses_observation_b", { ...session("ses_observation_b", selected, "plan"), location: { directory: `${directory}/other` } }],
  ])
  const modelRef = Schema.Struct({ providerID: Schema.String, id: Schema.String, variant: Schema.optional(Schema.String) })
  const prompt = Schema.Struct({
    ...PromptInput.Prompt.fields,
    id: Schema.optional(SessionMessage.ID),
    delivery: Schema.optional(Delivery),
  })
  const create = Schema.Struct({
    id: Schema.String,
    agent: Schema.String,
    model: modelRef,
    location: Schema.Struct({ directory: Schema.String }),
  })
  const prompts: { readonly sessionID: string; readonly text: string; readonly frame: string | undefined }[] = []
  const creationRequests: (typeof create.Type)[] = []
  const modelRequests: (typeof modelRef.Type)[] = []
  const writes: Request[] = []
  const fetch: FetchHandler = async (url, request) => {
    const location = {
      directory: url.searchParams.get("location[directory]") ?? directory,
      project: { id: "proj_test", directory: worktree, canonical: worktree },
    }
    if (url.pathname === "/api/fs/find") return json({ location, data: [] })
    if (url.pathname === "/api/config") {
      if (input.gate === "metadata") await gate.promise
      switch (input.source) {
        case "configured":
          return json([
            { type: "document", info: { model: { providerID: "provider", model: "intended", variant: "low" } } },
          ])
        case "cli":
          return json([{ type: "document", info: { model: "provider/alternate" } }])
        case "recent":
        case undefined:
          return json([])
        default: {
          const exhaustive: never = input.source
          throw new Error(`Unexpected model source ${exhaustive}`)
        }
      }
    }
    if (url.pathname === "/api/provider") {
      if (input.gate === "metadata") await gate.promise
      return json({ location, data: [{ id: "provider", name: "Provider" }] })
    }
    if (url.pathname === "/api/agent" || url.pathname === "/api/model") {
      requested.add(url.pathname)
      if (requested.size === 2) requestedBoth.resolve()
      if (input.gate !== "metadata") await gate.promise
      switch (state.outcome) {
        case "error-model":
          if (url.pathname === "/api/model") return json({ message: "Model catalog unavailable" }, { status: 500 })
          break
        case "error-agent":
          if (url.pathname === "/api/agent") return json({ message: "Agent catalog unavailable" }, { status: 500 })
          break
        case "empty-model":
          if (url.pathname === "/api/model") return json({ location, data: [] })
          break
        case "empty-agent":
          if (url.pathname === "/api/agent") return json({ location, data: [] })
          break
        case "ready":
          break
        default: {
          const exhaustive: never = state.outcome
          throw new Error(`Unexpected catalog outcome ${exhaustive}`)
        }
      }
      if (url.pathname === "/api/agent") return json({ location, data: [agent("build"), agent("plan")] })
      return json({ location, data: catalog.models })
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/session")) writes.push(request)
    if (url.pathname === "/api/session" && request.method === "POST") {
      const body = Schema.decodeUnknownSync(create)(await request.json())
      creationRequests.push(body)
      const info = { ...session(body.id, body.model, body.agent), location: body.location }
      sessions.set(info.id, info)
      return json({ data: info })
    }
    const sessionID = url.pathname.match(/^\/api\/session\/([^/]+)(?:\/|$)/)?.[1]
    if (!sessionID) return undefined
    const info = sessions.get(sessionID)
    if (url.pathname === `/api/session/${sessionID}` && info) return json({ data: info })
    if (url.pathname.endsWith("/model") && request.method === "POST") {
      const body = Schema.decodeUnknownSync(Schema.Struct({ model: modelRef }))(await request.json())
      modelRequests.push(body.model)
      if (info) sessions.set(sessionID, { ...info, model: body.model })
      return new Response(null, { status: 204 })
    }
    if (url.pathname.endsWith("/agent") && request.method === "POST") {
      const body = Schema.decodeUnknownSync(Schema.Struct({ agent: Schema.String }))(await request.json())
      if (info) sessions.set(sessionID, { ...info, agent: body.agent })
      return new Response(null, { status: 204 })
    }
    if (url.pathname.endsWith("/prompt") && request.method === "POST") {
      const body = Schema.decodeUnknownSync(prompt)(await request.json())
      prompts.push({ sessionID, text: body.text, frame: state.capture?.() })
      received.resolve()
      return input.rejectPrompt
        ? json({ message: "Admission fixture rejected the prompt" }, { status: 400 })
        : json({
            data: {
              id: body.id ?? SessionMessage.ID.create(),
              sessionID,
              type: "user",
              delivery: body.delivery ?? "steer",
              payload: { text: body.text },
              time: { created: 0 },
            } satisfies Extract<SessionInboxInfo, { type: "user" }>,
          })
    }
    if (request.method === "GET" && /\/(message|inbox|permission|form)$/.test(url.pathname))
      return json({ data: [], cursor: {} })
    if (request.method === "POST") return new Response(null, { status: 204 })
    return undefined
  }
  return {
    fetch,
    catalog,
    writes,
    prompts,
    creationRequests,
    modelRequests,
    requested: requestedBoth.promise,
    received: () => awaitSignal(received.promise),
    capture(read: () => string) {
      state.capture = read
    },
    release(outcome: CatalogOutcome = "ready") {
      state.outcome = outcome
      gate.resolve()
    },
  }
}
