import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionPauseEvent } from "@opencode-ai/schema/session-pause-event"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
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
export function deferredResult(at: number) {
  return { title: "", output: "", metadata: { deferred: { reason: "paused" as const, at } } }
}

export function deferredOf(metadata: Record<string, unknown>) {
  const value = metadata.deferred
  if (typeof value !== "object" || value === null) return undefined
  if (!("reason" in value) || value.reason !== "paused" || !("at" in value) || typeof value.at !== "number") return
  return { reason: "paused" as const, at: value.at }
}

export type Action = "pause" | "unpause" | "discard"

/**
 * The text of the user-only notice a pause, unpause or discard leaves in the transcript, in Vibeterm's metadata
 * block shape so the TUI shows it as provenance.
 */
export function noticeText(input: { action: Action; source: Source; at: number; reason?: string; count?: number }) {
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
    pause: `Paused by ${who}. The running step finishes; nothing else runs until /unpause.`,
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
      const { pause: _, ...rest } = current
      yield* sessions.setMetadata({ sessionID, metadata: pause ? { ...rest, pause } : rest })
      yield* status.setPaused(sessionID, pause)
      yield* events.publish(Event.Updated, { sessionID, pause: pause ?? null })
    })

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

    return Service.of({ get, write, list })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Session.node, SessionStatus.node, EventV2Bridge.node, Database.node],
})

export * as SessionPause from "./pause"
