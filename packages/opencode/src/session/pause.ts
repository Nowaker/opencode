import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseTransaction } from "@opencode-ai/core/database/transaction"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionPauseEvent } from "@opencode-ai/schema/session-pause-event"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { isRecord } from "@/util/record"
import { SessionID } from "./schema"
import { Session } from "./session"
import { SessionStatus } from "./status"

/*
 * The durable pause of a session lives in `session.metadata.pause`: no column, so every existing copy of a session
 * row (sync, forks of the row, backups) carries it without a migration. This module only stores and announces it;
 * what a pause does to the loop is SessionPrompt's.
 */

export const Info = SessionPauseEvent.Info
export type Info = SessionPauseEvent.Info
export const Source = SessionPauseEvent.Source
export type Source = SessionPauseEvent.Source
export const Held = SessionPauseEvent.Held
export type Held = SessionPauseEvent.Held
export const Event = SessionPauseEvent

export const Expected = Schema.Struct({
  expectedPauseAt: Schema.optional(Info.fields.at).annotate({
    description:
      "Only mutate a pause whose at equals this value. A changed or missing pause returns 409 without changes.",
  }),
  expectedPauseSource: Schema.optional(Source).annotate({
    description:
      "Only mutate a pause with exactly these known source fields, independent of object key order. A changed or missing pause returns 409 without changes. Omitted expectations preserve unconditional behavior.",
  }),
})
export type Expected = Schema.Schema.Type<typeof Expected>

export class ChangedError extends Schema.TaggedErrorClass<ChangedError>()("PauseChangedError", {
  sessionID: SessionID,
}) {}

const decode = Schema.decodeUnknownOption(Info)

export function read(metadata: Session.Info["metadata"]): Info | undefined {
  const value = metadata?.pause
  if (value === undefined || value === null) return undefined
  return Option.getOrUndefined(decode(value))
}

/** A tool part the model asked for while its session was paused; it was never started. */
export function isDeferred(part: { type: string; state?: { status: string; metadata?: Record<string, any> } }) {
  return part.type === "tool" && part.state?.status === "pending" && !!part.state.metadata?.deferred
}

/*
 * What a tool's execute returns instead of running while its session is paused. The processor turns it into a
 * pending part with `metadata.deferred`; the model never sees it, because every step rebuilds its request from the
 * stored history and a deferred part is settled (unpause or discard) before the next model call.
 */
export function deferredResult(at: number, switched = false) {
  return {
    title: "",
    output: "",
    metadata: { deferred: { reason: "paused" as const, at, ...(switched && { switched: true as const }) } },
  }
}

export function deferredOf(metadata: Record<string, unknown>) {
  const value = metadata.deferred
  if (!isRecord(value) || value.reason !== "paused" || typeof value.at !== "number") return
  return { reason: "paused" as const, at: value.at, ...(value.switched === true && { switched: true as const }) }
}

export const Refusal = SessionPauseEvent.Refusal
export type Refusal = SessionPauseEvent.Refusal

export const REFUSAL_CODE = "no_routable_account"
export const REFUSAL_PREFIX = "No routable Claude account: "

/*
 * Meridian's "no routable account" refusal, found in an error as opencode recorded it, or undefined for any other
 * error. A refusal before the stream is an HTTP 429 whose body keeps every Meridian field; one inside the stream
 * reaches us through the Anthropic SDK with only its message, so the stable message prefix is the fallback match
 * and the incident is read from the message's "(incident inc_...)" token. Only fields of the expected type are
 * copied, because a malformed one would make the whole stored pause undecodable.
 */
export function refusal(error: { name: string; data?: unknown }): Refusal | undefined {
  const data = isRecord(error.data) ? error.data : {}
  const found = [data.responseBody, data.message].flatMap((value) => {
    if (typeof value !== "string") return []
    const body = parseObject(value)
    const inner = body && isRecord(body.error) ? body.error : body
    if (inner && (inner.code === REFUSAL_CODE || startsWithPrefix(inner.message))) return [inner]
    const at = value.indexOf(REFUSAL_PREFIX)
    return at === -1 ? [] : [{ message: value.slice(at) }]
  })[0]
  if (!found) return undefined
  const message = typeof found.message === "string" ? found.message : REFUSAL_PREFIX.trim()
  const incident = string(found.incident_id) ?? /\(incident (inc_\d+_\d+)\)\s*$/.exec(message)?.[1]
  return {
    code: REFUSAL_CODE,
    message,
    ...(incident !== undefined && { incident_id: incident }),
    ...(string(found.request_id) !== undefined && { request_id: string(found.request_id) }),
    ...(string(found.reset_at) !== undefined && { reset_at: string(found.reset_at) }),
    ...(Array.isArray(found.profiles) && { profiles: found.profiles }),
    api_error: error,
  }
}

function parseObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function startsWithPrefix(value: unknown) {
  return typeof value === "string" && value.startsWith(REFUSAL_PREFIX)
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export type Action = "pause" | "unpause" | "discard"

/**
 * The text of the user-only notice a pause, unpause or discard leaves in the transcript, in Vibeterm's metadata
 * block shape so the TUI shows it as provenance.
 */
export function noticeText(input: {
  action: Action
  source: Source
  at: number
  reason?: string
  count?: number
  parked?: boolean
}) {
  const call = { pause: "/pause", unpause: "/unpause", discard: "/discard" }[input.action]
  const lines = [
    "[vibeterm_metadata]",
    `call: ${call}`,
    `source: ${input.source.kind}`,
    input.source.client && `client: ${input.source.client}`,
    input.source.tool && `tool: ${input.source.tool}`,
    input.source.sessionID && `from_session: ${input.source.sessionID}`,
    input.source.sessionTitle && `from_session_name: ${input.source.sessionTitle}`,
    input.source.machine && `from_machine: ${input.source.machine}`,
    `sent_at: ${new Date(input.at).toISOString()}`,
    input.reason && `reason: ${input.reason}`,
    "[/vibeterm_metadata]",
  ].filter((line): line is string => !!line)
  const who = describe(input.source)
  const text = {
    pause: input.parked
      ? "Paused: no Claude account can take the request. The refused step was dropped; /unpause runs it again."
      : `Paused by ${who}. The running step finishes; nothing else runs until /unpause.`,
    unpause: `Unpaused by ${who}.`,
    discard: `${input.count ?? 0} deferred tool call${input.count === 1 ? "" : "s"} discarded by ${who}.`,
  }[input.action]
  return `${lines.join("\n")}\n\n${text}`
}

function describe(source: Source) {
  const where = source.machine ? ` on ${source.machine}` : ""
  if (source.kind === "tui") return `the user (TUI)${where}`
  if (source.kind === "tool")
    return `a tool call${source.tool ? ` (${source.tool})` : ""}${source.sessionID ? ` from session ${source.sessionID}` : ""}${where}`
  return `the API${source.client ? ` (${source.client})` : ""}${where}`
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info | undefined>
  /** Stores the pause (or clears it with undefined), then tells status and the bus. */
  readonly write: (sessionID: SessionID, pause: Info | undefined) => Effect.Effect<void>
  /** Check ownership and mutate durable state under the same SQLite write lock. */
  readonly mutate: <A, E, R>(
    input: Expected & { readonly sessionID: SessionID },
    f: (current: Info | undefined) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ChangedError, R>
  /** Every paused session of this project, read from the database. */
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPause") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const get = Effect.fn("SessionPause.get")(function* (sessionID: SessionID) {
      const session = yield* sessions.get(sessionID).pipe(Effect.option)
      return Option.isSome(session) ? read(session.value.metadata) : undefined
    })

    const write = Effect.fn("SessionPause.write")(function* (sessionID: SessionID, pause: Info | undefined) {
      const current = (yield* sessions.get(sessionID).pipe(Effect.orDie)).metadata ?? {}
      // A cleared pause stays as `null`, never a deleted key: Vibeterm's session sync adds every key the local row
      // lacks from the other machine's copy, so a deleted key came back from a peer still holding the old pause.
      yield* sessions.setMetadata({ sessionID, metadata: { ...current, pause: pause ?? null } })
      yield* DatabaseTransaction.afterCommit(status.setPaused(sessionID, pause))
      yield* events.publish(Event.Updated, { sessionID, pause: pause ?? null })
    })

    const mutate: Interface["mutate"] = (input, f) =>
      db
        .transaction(
          () =>
            Effect.gen(function* () {
              const current = yield* get(input.sessionID)
              if (input.expectedPauseAt !== undefined && current?.at !== input.expectedPauseAt)
                return yield* new ChangedError({ sessionID: input.sessionID })
              if (input.expectedPauseSource !== undefined) {
                const fields = ["kind", "sessionID", "sessionTitle", "machine", "tool", "client"] as const
                if (!current || fields.some((key) => current.source[key] !== input.expectedPauseSource?.[key]))
                  return yield* new ChangedError({ sessionID: input.sessionID })
              }
              return yield* f(current)
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))

    const list = Effect.fn("SessionPause.list")(function* () {
      const ctx = yield* InstanceState.context
      const rows = yield* db
        .select({ id: SessionTable.id, metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(
          and(
            eq(SessionTable.project_id, ctx.project.id),
            sql`json_valid(${SessionTable.metadata}) and json_extract(${SessionTable.metadata}, '$.pause') is not null`,
          ),
        )
        .all()
        .pipe(Effect.orDie)
      return new Map(
        rows.flatMap((row) => {
          const pause = read(row.metadata ?? undefined)
          return pause ? [[SessionID.make(row.id), pause] as const] : []
        }),
      )
    })

    return Service.of({ get, write, mutate, list })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Session.node, SessionStatus.node, EventV2Bridge.node, Database.node],
})

export * as SessionPause from "./pause"
