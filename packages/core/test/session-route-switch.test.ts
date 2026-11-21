import { expect } from "bun:test"
import { UserMessage } from "@opencode/ai/effect"
import path from "node:path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { MeridianRouting } from "@opencode/core/plugin/provider/meridian-routing"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRouteSwitch } from "@opencode/core/session/route-switch"
import { SessionRouteSwitchPreview } from "@opencode/core/session/route-switch-preview"
import { SessionRouteSwitchRecovery } from "@opencode/core/session/route-switch-recovery"
import { Snapshot } from "@opencode/core/snapshot"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Clock, Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { withEnv } from "./fixture/env"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { Tool } from "@opencode/core/tool"

const claude = { providerID: "anthropic", modelID: "claude-opus-5-5", variant: "high", agent: "build" } as const
const sol = { providerID: "openai", modelID: "gpt-6.2-sol", variant: "max", agent: "build" } as const
const body = Schema.decodeUnknownSync(
  Schema.Struct({
    model: Schema.String,
    output_config: Schema.optional(Schema.Struct({ effort: Schema.String })),
    reasoning: Schema.optional(Schema.Struct({ effort: Schema.String })),
    messages: Schema.optional(Schema.Unknown),
    input: Schema.optional(Schema.Unknown),
  }),
)

const layers = LayerNode.group([
  Session.node,
  SessionExecution.node,
  SessionRouteSwitch.node,
  SessionRouteSwitchPreview.node,
  SessionRouteSwitchRecovery.node,
  LocationServiceMap.node,
])
const ref = (route: typeof claude | typeof sol) =>
  Model.Ref.make({
    providerID: Provider.ID.make(route.providerID),
    id: Model.ID.make(route.modelID),
    variant: Model.VariantID.make(route.variant),
  })

type Answer = "text" | "quota" | "auth" | "tool" | "ambiguous"
type FixtureOptions = {
  readonly source?: typeof claude | typeof sol
  readonly held?: boolean
  readonly attachment?: "unsupported" | "drop" | "change"
  readonly pinned?: boolean
}
const fixture = (
  steps: Answer[],
  run: (rig: {
    readonly sessionID: Session.ID
    readonly sessions: Session.Interface
    readonly execution: SessionExecution.Interface
    readonly route: Effect.Success<typeof SessionRouteSwitch.Service>
    readonly preview: Effect.Success<typeof SessionRouteSwitchPreview.Service>
    readonly recovery: Effect.Success<typeof SessionRouteSwitchRecovery.Service>
    readonly probes: string[]
    readonly sends: ReturnType<typeof body>[]
    readonly tools: string[]
    readonly streamStarted: Deferred.Deferred<void>
    readonly releaseStream: Deferred.Deferred<void>
  }) => Effect.Effect<void, unknown>,
  options: FixtureOptions = {},
) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const policy = path.join(dir.path, "native-policy.mjs")
    const source = options.source ?? claude
    const target = source === claude ? sol : claude
    const sends: ReturnType<typeof body>[] = []
    const tools: string[] = []
    const probes: string[] = []
    const streamStarted = yield* Deferred.make<void>()
    const releaseStream = yield* Deferred.make<void>()
    const clock = yield* Clock.Clock
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            const url = new URL(request.url)
            if (request.method === "GET") {
              probes.push(url.search)
              return Response.json({
                version: 1,
                ...Object.fromEntries(url.searchParams),
                available: true,
                routable_allotment: 1,
                observed_at: clock.currentTimeMillisUnsafe(),
              })
            }
            if (request.headers.get("x-fixture-kind") === "title") return new Response(null, { status: 401 })
            const sent = body(await request.json())
            sends.push(sent)
            const answer = steps.shift()
            if (!answer) return new Response(null, { status: 500 })
            const anthropic = sent.model === claude.modelID
            if (answer === "auth") return new Response(null, { status: 401 })
            if (answer === "ambiguous") return new Response(null, { status: 503 })
            if (answer === "quota")
              return Response.json(
                {
                  ...(anthropic ? { type: "error" } : {}),
                  error: {
                    type: "rate_limit_error",
                    code: "no_routable_account",
                    request_id: request.headers.get("x-request-id"),
                    route_refusal: {
                      version: 1,
                      phase: "before_inference",
                      sent: false,
                      provider: anthropic ? "claude" : "chatgpt",
                      model: sent.model,
                      variant: sent.reasoning?.effort,
                      reason: "quota_exhausted",
                    },
                  },
                },
                { status: 429, headers: { "x-meridian-route-refusal": "1" } },
              )
            if (options.held && sends.length === 2) {
              await Effect.runPromise(Deferred.succeed(streamStarted, undefined))
              await Effect.runPromise(Deferred.await(releaseStream))
            }
            return reply(anthropic, answer, sends.length)
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const config = {
      providers: {
        anthropic: {
          package: "@opencode/ai/providers/anthropic",
          settings: { apiKey: "fixture", baseURL: `${server.url.origin}/v1` },
          ...(options.pinned ? { headers: { "X-Meridian-Profile": "isolated-fixture" } } : {}),
          models: {
            [claude.modelID]: {
              variants: [{ id: "high", settings: { effort: "high" } }],
              limit: { context: 200000, output: 1000 },
            },
          },
        },
        openai: {
          package: "@opencode/ai/providers/openai",
          settings: { apiKey: "fixture", baseURL: `${server.url.origin}/v1` },
          models: {
            [sol.modelID]: {
              variants: [{ id: "max", settings: { reasoningEffort: "max" } }],
              limit: { context: 200000, output: 1000 },
              capabilities: { input: options.attachment === "unsupported" ? ["text"] : ["text", "image"] },
            },
          },
        },
      },
      compaction: { auto: false },
      warming: false,
    }
    yield* Effect.promise(() => Bun.write(path.join(dir.path, "opencode.json"), JSON.stringify(config)))
    yield* Effect.promise(() =>
      Bun.write(
        policy,
        `export const readAutoSwitchPolicy = ({source, preference, returnPreference}) => ({
        enabled: preference !== "off", returnEnabled: returnPreference !== "off", reason: "default-on",
        alternates: source?.providerID === ${JSON.stringify(source.providerID)} ? [${JSON.stringify(target)}] : [], policyRevision: preference + returnPreference,
      });`,
      ),
    )
    yield* withEnv({ VIBETERM_AUTO_SWITCH_POLICY_MODULE: policy }, () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const execution = yield* SessionExecution.Service
        const route = yield* SessionRouteSwitch.Service
        const preview = yield* SessionRouteSwitchPreview.Service
        const recovery = yield* SessionRouteSwitchRecovery.Service
        const session = yield* sessions.create({
          location: { directory: AbsolutePath.make(dir.path) },
          model: ref(source),
          agent: Agent.ID.make("build"),
          title: "Routing fixture",
          permissions: [{ action: "effect_once", resource: "*", effect: "allow" }],
        })
        const locations = yield* LocationServiceMap.Service
        const layer = locations.get(session.location)
        yield* Effect.gen(function* () {
          yield* Plugin.awaitActivation
          const hooks = yield* PluginHooks.Service
          yield* hooks.register("session", "http.request", (event) =>
            Effect.sync(() => {
              event.request.headers.set("x-fixture-kind", event.kind)
            }),
          )
          if (options.attachment === "drop" || options.attachment === "change")
            yield* hooks.register("session", "context", (event) =>
              Effect.sync(() => {
                if (event.model.providerID !== "openai") return
                for (const [i, message] of event.messages.entries()) {
                  if (message.role !== "user") continue
                  event.messages[i] = new UserMessage({
                    ...message,
                    content: message.content.flatMap<(typeof message.content)[number]>((part) =>
                      part.type !== "media"
                        ? [part]
                        : options.attachment === "drop"
                          ? []
                          : [{ ...part, filename: "replaced.png" }],
                    ),
                  })
                }
              }),
            )
          const tool = yield* Tool.Service
          yield* tool.transform((editor) =>
            editor.add({
              name: "effect_once",
              description: "Record one test effect",
              input: Schema.Struct({}),
              output: Schema.Struct({}),
              options: { codemode: false },
              execute: () =>
                Effect.sync(() => {
                  tools.push("ran")
                  return { output: {}, content: "earlier result" }
                }),
            }),
          )
        }).pipe(Effect.provide(layer))
        yield* run({
          sessionID: session.id,
          sessions,
          execution,
          route,
          preview,
          recovery,
          probes,
          sends,
          tools,
          streamStarted,
          releaseStream,
        })
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(layers, [
            offlineModels,
            Watcher.node.replace(Watcher.configured({ enabled: false })),
            Snapshot.node.replace(Snapshot.noopLayer),
          ]).pipe(
            Layer.provideMerge(
              Layer.succeed(MeridianRouting.Trust, {
                claudeInferenceURL: new URL("v1/messages", server.url).href,
                chatgptAvailabilityURL: new URL("profiles/route-availability", server.url).href,
              }),
            ),
          ),
        ),
      ),
    )
  })

function reply(anthropic: boolean, answer: "text" | "tool", count: number) {
  const tool = answer === "tool"
  const text = `answer-${count}`
  const frames = anthropic
    ? [
        {
          type: "message_start",
          message: {
            id: `msg_${count}`,
            type: "message",
            role: "assistant",
            model: claude.modelID,
            content: [],
            usage: { input_tokens: 12, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: tool
            ? { type: "tool_use", id: "toolu_once", name: "effect_once", input: {} }
            : { type: "text", text },
        },
        ...(tool
          ? [{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }]
          : []),
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 3 } },
        { type: "message_stop" },
      ]
    : [
        { type: "response.created", response: { id: `resp_${count}` } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", id: `msg_${count}`, role: "assistant", content: [], status: "in_progress" },
        },
        { type: "response.output_text.delta", item_id: `msg_${count}`, output_index: 0, content_index: 0, delta: text },
        { type: "response.output_text.done", item_id: `msg_${count}`, output_index: 0, content_index: 0, text },
        {
          type: "response.completed",
          response: { id: `resp_${count}`, status: "completed", usage: { input_tokens: 15, output_tokens: 4 } },
        },
      ]
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  })
}

it.live("switches one refused step without losing or repeating the earlier tool", () =>
  fixture(["tool", "quota", "text"], (rig) =>
    Effect.gen(function* () {
      yield* rig.sessions.prompt({ sessionID: rig.sessionID, text: "original work", resume: false })
      yield* rig.execution.resume(rig.sessionID)
      expect(rig.sends.map((sent) => sent.model)).toEqual([claude.modelID, claude.modelID, sol.modelID])
      expect(rig.tools).toEqual(["ran"])
      expect(rig.sends[2]?.input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "function_call", name: "effect_once", call_id: "toolu_once" }),
          expect.objectContaining({ type: "function_call_output", call_id: "toolu_once" }),
        ]),
      )
      const history = yield* rig.sessions.messages({ sessionID: rig.sessionID, order: "asc" })
      expect(history.filter((message) => message.type === "user")).toHaveLength(1)
      expect(
        history
          .filter((message) => message.type === "assistant")
          .map((message) => ({
            provider: String(message.model.providerID),
            error: message.error?.type,
            tokens: message.tokens?.input,
          })),
      ).toEqual([
        { provider: "anthropic", error: undefined, tokens: 12 },
        { provider: "anthropic", error: "route.quota-exhausted", tokens: undefined },
        { provider: "openai", error: undefined, tokens: 15 },
      ])
    }),
  ),
)

it.effect("returns to the durable Sol max selection only on a genuinely new settled admission", () =>
  fixture(
    ["quota", "text", "text", "text"],
    (rig) =>
      Effect.gen(function* () {
        yield* rig.sessions.prompt({ sessionID: rig.sessionID, text: "first user submission", resume: false })
        const running = yield* rig.execution.resume(rig.sessionID).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(rig.streamStarted)
        const probes = rig.probes.length
        expect((yield* rig.preview.refresh(rig.sessionID)).previewExpiresAt).toBeUndefined()
        expect(rig.probes).toHaveLength(probes)
        yield* rig.sessions.prompt({
          sessionID: rig.sessionID,
          text: "queued before settlement",
          resume: false,
          delivery: "queue",
        })
        yield* TestClock.adjust("61 seconds")
        yield* Deferred.succeed(rig.releaseStream, undefined)
        yield* Fiber.join(running)
        expect(rig.sends.map((sent) => sent.model)).toEqual([sol.modelID, claude.modelID, claude.modelID])
        yield* TestClock.adjust("61 seconds")
        const ready = yield* Effect.all([rig.preview.refresh(rig.sessionID), rig.preview.refresh(rig.sessionID)], {
          concurrency: 2,
        })
        expect(ready.map((state) => state.next)).toEqual([sol, sol])
        expect(ready.map((state) => state.effective)).toEqual([claude, claude])
        expect(rig.probes).toHaveLength(probes + 1)
        expect(rig.sends).toHaveLength(3)
        yield* TestClock.adjust("31 seconds")
        expect((yield* rig.route.status(rig.sessionID)).next).toBeNull()
        yield* rig.sessions.prompt({ sessionID: rig.sessionID, text: "admitted after settlement", resume: false })
        yield* rig.execution.resume(rig.sessionID)
        expect(rig.sends.map((sent) => [sent.model, sent.reasoning?.effort ?? sent.output_config?.effort])).toEqual([
          [sol.modelID, "max"],
          [claude.modelID, "high"],
          [claude.modelID, "high"],
          [sol.modelID, "max"],
        ])
        expect(yield* rig.route.status(rig.sessionID)).toMatchObject({
          preferred: sol,
          effective: sol,
          returnState: "preferred",
        })
      }),
    { source: sol, held: true },
  ),
)

it.live("manual resume of a proved quota stop keeps existing tool results and does not admit a prompt", () =>
  fixture(["tool", "quota", "text"], (rig) =>
    Effect.gen(function* () {
      const observed = yield* rig.route.status(rig.sessionID)
      if (observed.availability !== "available") throw new Error("Expected fixture policy to load")
      const edited = yield* rig.route.edit({
        sessionID: rig.sessionID,
        ownerEpoch: observed.ownerEpoch,
        revision: observed.revision,
        action: "set-preference",
        preference: "off",
      })
      expect(edited.status).toBe(200)
      yield* rig.sessions.prompt({ sessionID: rig.sessionID, text: "work to resume", resume: false })
      yield* rig.execution.resume(rig.sessionID).pipe(Effect.flip)
      const stopped = yield* rig.route.status(rig.sessionID)
      expect(stopped.quotaStop).toEqual({ route: claude, reason: "quota_exhausted" })
      if (stopped.availability !== "available") throw new Error("Expected native owner")
      const request = { sessionID: rig.sessionID, ownerEpoch: stopped.ownerEpoch, revision: stopped.revision }
      expect((yield* rig.recovery.retry(request)).status).toBe(200)
      expect((yield* rig.recovery.retry(request)).status).toBe(409)
      yield* rig.execution.awaitIdle(rig.sessionID)
      expect(rig.sends.map((sent) => sent.model)).toEqual([claude.modelID, claude.modelID, claude.modelID])
      expect(rig.tools).toEqual(["ran"])
      expect(rig.sends[2]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_once" }),
            ]),
          }),
        ]),
      )
      expect(yield* rig.sessions.messages({ sessionID: rig.sessionID, type: "user" })).toHaveLength(1)
      expect((yield* rig.route.status(rig.sessionID)).quotaStop).toBeUndefined()
    }),
  ),
)

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

it.live("admission keeps an explicit picker tuple with its first receipt until delivery", () =>
  fixture(["text"], (rig) =>
    Effect.gen(function* () {
      const observed = yield* rig.route.status(rig.sessionID)
      if (observed.availability !== "available") throw new Error("Missing native owner")
      const selection = { ownerEpoch: observed.ownerEpoch, revision: observed.revision, route: sol }
      const request = { sessionID: rig.sessionID, text: "select Sol", resume: false, experimental: { selection } }
      const accepted = yield* rig.sessions.prompt(request)
      expect(accepted.payload.selection).toEqual(sol)
      expect((yield* rig.sessions.get(rig.sessionID)).model).toEqual(ref(claude))
      const duplicate = yield* rig.sessions.prompt({
        ...request,
        id: accepted.id,
        experimental: { selection: { ...selection, route: claude } },
      })
      expect(duplicate.payload.selection).toEqual(sol)
      expect(yield* rig.sessions.prompt(request).pipe(Effect.flip)).toMatchObject({ reason: "selection-stale" })
      yield* rig.execution.resume(rig.sessionID)
      const projected = yield* rig.sessions.prompt({ ...request, id: accepted.id })
      expect(projected.payload.selection).toEqual(sol)
      expect(rig.sends.map((sent) => [sent.model, sent.reasoning?.effort])).toEqual([[sol.modelID, "max"]])
      expect(yield* rig.sessions.messages({ sessionID: rig.sessionID, type: "user" })).toHaveLength(1)
    }),
  ),
)

it.live("rejects unavailable picker selections and stale unchanged-picker owner fences before admission", () =>
  fixture([], (rig) =>
    Effect.gen(function* () {
      const observed = yield* rig.route.status(rig.sessionID)
      if (observed.availability !== "available") throw new Error("Missing native owner")
      const request = { sessionID: rig.sessionID, text: "never admitted", resume: false }
      const guard = { ownerEpoch: observed.ownerEpoch, revision: observed.revision }
      expect(
        yield* rig.sessions
          .prompt({ ...request, experimental: { selection: { ...guard, route: { ...sol, variant: "unsupported" } } } })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "selection-unavailable" })
      expect(
        yield* rig.sessions
          .prompt({ ...request, experimental: { selection: { ...guard, ownerEpoch: "retired-owner" } } })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "selection-stale" })
      expect(yield* rig.sessions.inbox(rig.sessionID)).toEqual([])
      expect(rig.sends).toEqual([])
    }),
  ),
)

it.live("a source provider's configured routing pin rejects an explicit picker escape before admission", () =>
  fixture(
    [],
    (rig) =>
      Effect.gen(function* () {
        const state = yield* rig.route.status(rig.sessionID)
        if (state.availability !== "available") throw new Error("Missing native owner")
        const selection = { ownerEpoch: state.ownerEpoch, revision: state.revision, route: sol }
        expect(
          yield* rig.sessions
            .prompt({ sessionID: rig.sessionID, text: "not admitted", experimental: { selection } })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "selection-pinned" })
        expect(yield* rig.sessions.inbox(rig.sessionID)).toEqual([])
        expect(rig.sends).toEqual([])
      }),
    { pinned: true },
  ),
)
it.live("standalone agent and model edits invalidate a picker's revision before the first prompt", () =>
  fixture([], (rig) =>
    Effect.gen(function* () {
      const status = yield* rig.route.status(rig.sessionID)
      if (status.availability !== "available") throw new Error("Missing native owner")
      const stale = (revision: number) =>
        rig.sessions
          .prompt({
            sessionID: rig.sessionID,
            text: "stale picker",
            resume: false,
            experimental: { selection: { ownerEpoch: status.ownerEpoch, revision, route: claude } },
          })
          .pipe(Effect.flip)
      yield* rig.sessions.switchAgent({ sessionID: rig.sessionID, agent: Agent.ID.make("plan") })
      expect(yield* stale(status.revision)).toMatchObject({ reason: "selection-stale" })
      const afterAgent = yield* rig.route.status(rig.sessionID)
      if (afterAgent.availability !== "available") throw new Error("Missing native owner")
      yield* rig.sessions.switchModel({ sessionID: rig.sessionID, model: ref(sol) })
      expect(yield* stale(afterAgent.revision)).toMatchObject({ reason: "selection-stale" })
      expect((yield* rig.sessions.inbox(rig.sessionID)).filter((item) => item.type === "user")).toEqual([])
    }),
  ),
)

for (const attachment of ["unsupported", "drop", "change"] as const) {
  it.live(`does not disclose replay when an attached image is ${attachment}`, () =>
    fixture(
      ["quota"],
      (rig) =>
        Effect.gen(function* () {
          yield* rig.sessions.prompt({
            sessionID: rig.sessionID,
            text: "image prompt",
            files: [{ uri: png, name: "source.png" }],
            resume: false,
          })
          yield* rig.execution.resume(rig.sessionID).pipe(Effect.flip)
          expect(rig.sends.map((sent) => sent.model)).toEqual([claude.modelID])
          expect(rig.probes).toEqual([])
          expect((yield* rig.route.status(rig.sessionID)).quotaStop).toEqual({
            route: claude,
            reason: "quota_exhausted",
          })
        }),
      { attachment },
    ),
  )
}

it.live("does not hop after an earlier ambiguous inference request in the same step", () =>
  fixture(["ambiguous", "quota", "text"], (rig) =>
    Effect.gen(function* () {
      yield* rig.sessions.prompt({ sessionID: rig.sessionID, text: "ordinary retry", resume: false })
      yield* rig.execution.resume(rig.sessionID)
      expect(rig.sends.map((sent) => sent.model)).toEqual([claude.modelID, claude.modelID, claude.modelID])
      expect(rig.probes).toEqual([])
    }),
  ),
)

it.effect("a proved failed return gets one alternate attempt and requires a clean turn before another return", () =>
  fixture(
    ["quota", "text", "quota", "text", "text", "text"],
    (rig) =>
      Effect.gen(function* () {
        const turn = (text: string) =>
          rig.sessions
            .prompt({ sessionID: rig.sessionID, text, resume: false })
            .pipe(Effect.andThen(rig.execution.resume(rig.sessionID)))
        yield* turn("switch to Claude")
        yield* TestClock.adjust("61 seconds")
        yield* turn("return while Sol still exhausted")
        expect(rig.sends.map((sent) => sent.model)).toEqual([sol.modelID, claude.modelID, sol.modelID, claude.modelID])
        expect((yield* rig.route.status(rig.sessionID)).effective).toEqual(claude)
        yield* TestClock.adjust("6 minutes")
        yield* turn("one clean turn before returning")
        expect(rig.sends.at(-1)?.model).toBe(claude.modelID)
        yield* turn("preferred after clean completion")
        expect(rig.sends.at(-1)?.reasoning?.effort).toBe("max")
      }),
    { source: sol },
  ),
)
