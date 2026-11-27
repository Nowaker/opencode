import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseTransaction } from "@opencode-ai/core/database/transaction"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { and, eq, inArray, or, sql } from "drizzle-orm"
import { Effect, Layer, Context, Option, Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
import { LiveEvents } from "./live-events"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID } from "./schema"
import { skippedSnapshot } from "./snapshot-gap"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"
import { isDeepStrictEqual } from "node:util"

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: SessionV1.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[] | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummary") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const database = yield* Database.Service
    const live = yield* LiveEvents.Service

    const messageRole = sql<string>`json_extract(${MessageTable.data}, '$.role')`
    const readUserDiffs = Effect.fnUntraced(function* (input: { sessionID: SessionID; messageID: MessageID }) {
      const row = yield* database.db
        .select({ data: MessageTable.data })
        .from(MessageTable)
        .where(
          and(eq(MessageTable.session_id, input.sessionID), eq(MessageTable.id, input.messageID), eq(messageRole, "user")),
        )
        .get()
        .pipe(Effect.orDie)
      if (row) return { diffs: typeof row.data.summary === "object" ? row.data.summary?.diffs : undefined }

      const session = yield* database.db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!session) return yield* Effect.die(new NotFoundError({ message: `Session not found: ${input.sessionID}` }))
    })

    const diffSnapshots = Effect.fnUntraced(function* (from: string | null | undefined, to: string | null | undefined) {
      if (!from || !to) return []
      return yield* snapshot.diffFull(from, to).pipe(
        Effect.catchTag("SnapshotDiffTimeout", (error) =>
          Effect.logWarning("snapshot diff timed out", { from: error.from, to: error.to }).pipe(Effect.as(undefined)),
        ),
      )
    })

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: SessionV1.WithParts[] }) {
      let from: string | undefined
      let to: string | undefined
      for (const item of input.messages) {
        for (const part of item.parts) {
          if (skippedSnapshot(part)) return []
          if (!from && part.type === "step-start" && part.snapshot) from = part.snapshot
          if (part.type === "step-finish" && part.snapshot) to = part.snapshot
        }
      }
      return yield* diffSnapshots(from, to)
    })

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      const resetSessionDiff = Effect.gen(function* () {
        yield* sessions.setSummary({
          sessionID: input.sessionID,
          summary: {
            additions: 0,
            deletions: 0,
            files: 0,
          },
        })
        yield* events.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: [] })
      })
      if ((yield* config.get()).snapshot === false) return yield* resetSessionDiff
      const target = yield* readUserDiffs(input)
      if (!target) return yield* resetSessionDiff

      const partType = sql<string>`json_extract(${PartTable.data}, '$.type')`
      const skipped = eq(sql`json_extract(${PartTable.data}, '$.state.metadata.engine.snapshot')`, "skipped")
      const parts = yield* database.db
        .select({ type: partType, snapshot: sql<string | null>`json_extract(${PartTable.data}, '$.snapshot')` })
        .from(MessageTable)
        .innerJoin(PartTable, eq(PartTable.message_id, MessageTable.id))
        .where(
          and(
            eq(MessageTable.session_id, input.sessionID),
            or(
              eq(MessageTable.id, input.messageID),
              and(eq(messageRole, "assistant"), eq(sql`json_extract(${MessageTable.data}, '$.parentID')`, input.messageID)),
            ),
            or(inArray(partType, ["step-start", "step-finish"]), and(eq(partType, "tool"), skipped)),
          ),
        )
        .orderBy(MessageTable.time_created, MessageTable.id, PartTable.id)
        .all()
        .pipe(Effect.orDie)
      const msgDiffs = parts.some((part) => part.type === "tool")
        ? []
        : yield* diffSnapshots(
            parts.find((part) => part.type === "step-start" && part.snapshot)?.snapshot,
            parts.findLast((part) => part.type === "step-finish" && part.snapshot)?.snapshot,
          )
      if (msgDiffs === undefined) return
      yield* resetSessionDiff
      if (isDeepStrictEqual(target.diffs, msgDiffs)) return
      yield* live.guard(
        input.sessionID,
        DatabaseTransaction.batch(
          database.db,
          Effect.gen(function* () {
            // Computing a diff can outlast an unpause that changes the same user row.
            const current = yield* MessageV2.get(input).pipe(
              Effect.provideService(Database.Service, database),
              Effect.option,
            )
            if (Option.isNone(current) || current.value.info.role !== "user") return
            const info = current.value.info
            if (isDeepStrictEqual(info.summary?.diffs, msgDiffs)) return
            yield* sessions.updateMessage({
              ...info,
              promptOrigin: MessageV2.storedPromptOrigin(info),
              summary: { ...info.summary, diffs: msgDiffs },
            })
          }),
        ),
      ).pipe(Effect.orDie)
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      if (!input.messageID) return []
      const target = yield* readUserDiffs({ sessionID: input.sessionID, messageID: input.messageID })
      const diffs = target?.diffs ?? []
      return diffs.map((item) => {
        if (item.file === undefined) return item
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
})
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Session.node, Snapshot.node, EventV2Bridge.node, Config.node, Database.node, LiveEvents.node],
})

export * as SessionSummary from "./summary"
