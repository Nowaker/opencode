import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { EngineStop } from "@opencode/schema/engine-stop"
import { optional } from "@opencode/schema/schema"
import { UnauthorizedError } from "../errors.js"
import { EngineStopControlError } from "../engine-stop.js"

export const ServerInfo = Schema.Struct({
  version: Schema.String,
  // 0 means the runtime has no OS process identity (e.g. workerd).
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  // The machine's name, absent where the runtime has none (e.g. workerd).
  hostname: Schema.optional(Schema.String),
  urls: Schema.Array(Schema.String),
  paths: Schema.Struct({
    tmp: Schema.String,
  }),
  // Optional at every level so clients still decode servers that predate a capability.
  capabilities: Schema.optional(
    Schema.Struct({
      persistentPty: Schema.optional(Schema.Boolean),
      engineStop: Schema.optional(Schema.Boolean).annotate({
        description: "Experimental process-local admission sealing for idle stop and forced restart.",
      }),
      toolDeferral: Schema.optional(Schema.Boolean).annotate({
        description: "Awaited session context hooks can defer ordinary tools through native provider tool search.",
      }),
      jobControl: Schema.optional(Schema.Boolean).annotate({
        description: "Plugins can list owned background Jobs and cancel directly owned native shell and image Jobs.",
      }),
      jobResults: Schema.optional(Schema.Boolean).annotate({
        description: "Plugins can read owned native Job outcomes and wait without cancelling execution.",
      }),
      childCancellation: Schema.optional(Schema.Boolean).annotate({
        description: "Parent-scoped child cancellation reports settled, requested, terminal, or unsupported ownership.",
      }),
      sessionMessages: Schema.optional(Schema.Boolean).annotate({
        description: "Plugins can read durable session messages with the message list pagination contract.",
      }),
      sessionSelection: Schema.optional(Schema.Boolean).annotate({
        description: "Plugins can read the target Location's effective agent and model selection without changing it.",
      }),
      sessionCompareAndInterrupt: Schema.optional(Schema.Literal(true)),
      sessionConditionalPrompt: Schema.optional(Schema.Literal(true)),
      subagentOptions: Schema.optional(Schema.Boolean).annotate({
        description: "Supports native subagent fork, completion notice policies and timed foreground handoff.",
      }),
      pluginConfiguration: Schema.optional(Schema.Boolean).annotate({
        description: "Supports awaited activation-owned plugin configuration before native config consumers.",
      }),
      compactionSummary: Schema.optional(Schema.Boolean).annotate({
        description:
          "Supports awaited experimental compaction summary completion, frozen generation context and local stop boundaries.",
      }),
      sessionMetadataMergePatch: Schema.optional(Schema.Boolean).annotate({
        description: "Supports atomic RFC 7396 session metadata updates selected by experimental.metadataMode.",
      }),
      syntheticAppend: Schema.optional(Schema.Boolean).annotate({
        description: "Supports mode: append on session.synthetic without inbox admission or execution changes.",
      }),
      promptTextParts: Schema.optional(Schema.Boolean).annotate({
        description:
          "Awaited prompt hooks can persist ordered text parts on the user message, excluding ignored text from models.",
      }),
      formControl: Schema.optional(Schema.Boolean).annotate({
        description: "Plugins can list pending native forms and read, answer or cancel forms owned by a session.",
      }),
      permissionDefer: Schema.optional(Schema.Boolean).annotate({
        description:
          "Supports decision: defer on permission replies with exact optional feedback and no reject cascade.",
      }),
      permissionRejectIsolation: Schema.optional(Schema.Boolean).annotate({
        description: "Supports scope: request on reject permission replies to leave sibling requests pending.",
      }),
    }),
  ),
}).annotate({ identifier: "ServerInfo" })
export type ServerInfo = typeof ServerInfo.Type

export const PairingCode = Schema.Struct({
  code: Schema.String,
  expires_in: Schema.Int,
}).annotate({ identifier: "PairingCode" })
export type PairingCode = typeof PairingCode.Type

export const PairingSession = Schema.Struct({
  token: Schema.String,
}).annotate({ identifier: "PairingSession" })
export type PairingSession = typeof PairingSession.Type

export const PAIRING_CONNECT_PATH = "/auth/connect/:code"

const PAIRING_CONNECT_URL = /^\/auth\/connect\/[^/]+$/

export function isPairingConnectURL(url: URL) {
  return PAIRING_CONNECT_URL.test(url.pathname)
}

/** `server.stop.*` in the `server.experimental` group. */
export const ServerStopEndpoints = [
  HttpApiEndpoint.get("server.stop.get", "/api/experimental/server/stop", {
    query: Schema.Struct({
      ...EngineStop.GetQuery.fields,
      waitMs: Schema.NumberFromString.pipe(Schema.decodeTo(EngineStop.WaitMillis), optional),
    }),
    success: EngineStop.Info,
    error: EngineStopControlError,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.server.stop.get",
      summary: "Get engine stop state",
      description:
        "Experimental: may change without compatibility guarantees. Read the current incarnation and activity revision before checking quiescence, or await a named stop operation for up to waitMs (0 through 30000).",
    }),
  ),
  HttpApiEndpoint.post("server.stop.prepare", "/api/experimental/server/stop/prepare", {
    payload: EngineStop.PrepareInput,
    success: EngineStop.Operation,
    error: EngineStopControlError,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.server.stop.prepare",
      summary: "Prepare engine stop",
      description:
        "Experimental: may change without compatibility guarantees. Seal fresh admissions for idle stop or forced restart. A preparing receipt is not permission to close the process; waitMs bounds only this request's settlement wait.",
    }),
  ),
  HttpApiEndpoint.post("server.stop.cancel", "/api/experimental/server/stop/cancel", {
    payload: EngineStop.CancelInput,
    success: EngineStop.Operation,
    error: EngineStopControlError,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.server.stop.cancel",
      summary: "Cancel engine stop",
      description:
        "Experimental: may change without compatibility guarantees. Reopen only the matching generation, operation and token; already dispatched work interruption is not undone.",
    }),
  ),
] as const

export const ServerGroup = HttpApiGroup.make("server.server")
  .add(
    HttpApiEndpoint.get("server.info", "/api/info", {
      success: ServerInfo,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.info",
        summary: "Get server info",
        description: "Return the server identity, connection URLs, paths, and readiness status.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("server.pair", "/api/pair", {
      success: PairingCode,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.pair",
        summary: "Create pairing code",
        description: "Create a short-lived, single-use code for a /auth/connect/:code pairing link.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("server.connect", PAIRING_CONNECT_PATH, {
      params: { code: Schema.String },
      success: PairingSession,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.connect",
        summary: "Redeem pairing code",
        description:
          "Redeem a pairing code. Browsers receive a session cookie and a redirect to the web app; requests that accept JSON receive a session token to use as the password.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "server" }))
