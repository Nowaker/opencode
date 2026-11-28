import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Option, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { eq } from "drizzle-orm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OwnerQuiescence } from "@/owner/quiescence"
import { MessageHistoryState } from "@/session/message-history-state"
import { Snapshot } from "../snapshot"
import { Storage } from "@/storage/storage"
import { Session } from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionRunState } from "./run-state"
import { SessionSummary } from "./summary"
import { skippedSnapshot } from "./snapshot-gap"
import { InstanceState } from "@/effect/instance-state"
import { NamedError } from "@opencode-ai/core/util/error"
import path from "path"

export const RevertInput = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
  partID: Schema.optional(PartID),
  files: Schema.optional(Schema.Boolean).annotate({
    description:
      "Also revert the file changes the reverted messages made (default: true). With false, only the messages are reverted: no snapshot is taken and no file is touched, so a later unrevert restores messages only",
  }),
})
export type RevertInput = Schema.Schema.Type<typeof RevertInput>

export class NoUndoSnapshot extends Schema.TaggedErrorClass<NoUndoSnapshot>()("NoUndoSnapshot", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly revert: (
    input: RevertInput,
  ) => Effect.Effect<Session.Info, Session.BusyError | NoUndoSnapshot | MessageHistoryState.Error>
  readonly unrevert: (input: { sessionID: SessionID }) => Effect.Effect<Session.Info, Session.BusyError | MessageHistoryState.Error>
  readonly apply: (input: { sessionID: SessionID }) => Effect.Effect<Session.Info, Session.BusyError | MessageHistoryState.Error>
  readonly cleanup: (session: Session.Info) => Effect.Effect<void, MessageHistoryState.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRevert") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snap = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const events = yield* EventV2Bridge.Service
    const summary = yield* SessionSummary.Service
    const state = yield* SessionRunState.Service
    const database = yield* Database.Service

    const withWritableHistory = <A, E, R>(sessionID: SessionID, work: Effect.Effect<A, E, R>) =>
      OwnerQuiescence.activity(Effect.gen(function* () {
        // Cleanup may have been given a stale Session.Info. Leave its native revert semantics intact.
        const row = yield* database.db
          .select({ metadata: SessionTable.metadata })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        yield* MessageHistoryState.assertWritable({ id: sessionID, metadata: row?.metadata ?? undefined })
        return yield* work
      }))

    // Messages only: nothing is snapshotted, diffed or written. A revert that already put files back keeps its
    // snapshot, because those files are still put back and unrevert is the only way to restore them.
    const revertMessages = Effect.fnUntraced(function* (
      session: Session.Info,
      rev: NonNullable<Session.Info["revert"]>,
    ) {
      const kept = session.revert?.snapshot
        ? { ...rev, snapshot: session.revert.snapshot, diff: session.revert.diff }
        : rev
      yield* sessions.setRevert({ sessionID: session.id, revert: kept, summary: session.summary })
      return yield* sessions.get(session.id).pipe(Effect.orDie)
    })

    const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
      yield* state.assertNotBusy(input.sessionID)
      if (input.files === false && !input.partID) {
        // A prompt is its own revert point, so reading it alone avoids loading the whole session.
        const target = yield* MessageV2.get(input).pipe(
          Effect.provideService(Database.Service, database),
          Effect.option,
        )
        if (Option.isSome(target) && target.value.info.role === "user")
          return yield* revertMessages(yield* sessions.get(input.sessionID).pipe(Effect.orDie), {
            messageID: input.messageID,
          })
      }
      const all = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      let lastUser: SessionV1.User | undefined
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)

      let rev: Session.Info["revert"]
      let crossesGap = false
      const patches: Snapshot.Patch[] = []
      for (const msg of all) {
        if (msg.info.role === "user") lastUser = msg.info
        const remaining = []
        let stepSkipped = false
        for (const part of msg.parts) {
          const skipped = input.files !== false && skippedSnapshot(part)
          if (rev) {
            crossesGap ||= skipped
            if (part.type === "patch") patches.push(part)
            continue
          }

          if (part.type === "step-start") stepSkipped = false
          stepSkipped ||= skipped
          if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
            const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
            rev = {
              messageID: !partID && lastUser ? lastUser.id : msg.info.id,
              partID,
            }
            // File patches operate on whole steps even when the transcript cutoff is inside one.
            crossesGap = stepSkipped
          }
          if (part.type === "step-finish") stepSkipped = false
          remaining.push(part)
        }
      }

      if (!rev) return session
      if (input.files === false) return yield* revertMessages(session, rev)
      if (crossesGap) {
        const message = "No undo snapshot exists for a step in this revert. Use Revert messages to keep file changes."
        yield* events.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: new NamedError.Unknown({ message }).toObject(),
        })
        return yield* new NoUndoSnapshot({ message })
      }

      rev.snapshot = session.revert?.snapshot ?? (yield* snap.track(input.sessionID))
      if (session.revert?.snapshot) yield* snap.restore(session.revert.snapshot)
      const kept = yield* snap.revert(patches)
      if (kept.length) yield* reportKept(input.sessionID, kept)
      if (rev.snapshot) rev.diff = yield* snap.diff(rev.snapshot)
      const index = all.findIndex((msg) => msg.info.id === rev.messageID)
      const range = index < 0 ? [] : all.slice(index)
      const diffs = yield* summary.computeDiff({ messages: range })
      if (diffs !== undefined) {
        yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
        yield* events.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
      }
      yield* sessions.setRevert({
        sessionID: input.sessionID,
        revert: rev,
        summary:
          diffs === undefined
            ? undefined
            : {
                additions: diffs.reduce((sum, x) => sum + x.additions, 0),
                deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
                files: diffs.length,
              },
      })
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const reportKept = Effect.fnUntraced(function* (sessionID: SessionID, files: string[]) {
      const ctx = yield* InstanceState.context
      const names = files.map((file) => path.relative(ctx.worktree, file).replaceAll("\\", "/"))
      const listed = names.slice(0, 5).join(", ") + (names.length > 5 ? ` and ${names.length - 5} more` : "")
      const count = names.length === 1 ? "1 file" : `${names.length} files`
      const message = `Revert kept ${count} as is because the snapshot store no longer has the earlier version: ${listed}`
      yield* events.publish(Session.Event.Error, {
        sessionID,
        error: new NamedError.Unknown({ message }).toObject(),
      })
    })

    const unrevert = Effect.fn("SessionRevert.unrevert")(function* (input: { sessionID: SessionID }) {
      yield* Effect.logInfo("unreverting", { sessionID: input.sessionID })
      yield* state.assertNotBusy(input.sessionID)
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (!session.revert) return session
      if (session.revert.snapshot) yield* snap.restore(session.revert.snapshot)
      yield* sessions.clearRevert(input.sessionID)
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const cleanup = Effect.fn("SessionRevert.cleanup")(function* (session: Session.Info) {
      if (!session.revert) return
      const sessionID = session.id
      const msgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      const messageID = session.revert.messageID
      const index = msgs.findIndex((msg) => msg.info.id === messageID)
      const target = index < 0 ? undefined : msgs[index]
      const remove = index < 0 ? [] : msgs.slice(index + (session.revert.partID ? 1 : 0))
      for (const msg of remove) {
        yield* sessions.removeMessage({ sessionID, messageID: msg.info.id })
      }
      if (session.revert.partID && target) {
        const partID = session.revert.partID
        const idx = target.parts.findIndex((part) => part.id === partID)
        if (idx >= 0) {
          const removeParts = target.parts.slice(idx)
          target.parts = target.parts.slice(0, idx)
          for (const part of removeParts) {
            yield* sessions.removePart({ sessionID, messageID: target.info.id, partID: part.id })
          }
        }
      }
      yield* sessions.clearRevert(sessionID)
    })

    const apply = Effect.fn("SessionRevert.apply")(function* (input: { sessionID: SessionID }) {
      yield* state.assertNotBusy(input.sessionID)
      yield* cleanup(yield* sessions.get(input.sessionID).pipe(Effect.orDie))
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    return Service.of({
      revert: (input) => withWritableHistory(input.sessionID, revert(input)),
      unrevert: (input) => withWritableHistory(input.sessionID, unrevert(input)),
      apply: (input) => withWritableHistory(input.sessionID, apply(input)),
      cleanup: (session) => withWritableHistory(session.id, cleanup(session)),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Database.node,
    Session.node,
    Snapshot.node,
    Storage.node,
    EventV2Bridge.node,
    SessionSummary.node,
    SessionRunState.node,
  ],
})

export * as SessionRevert from "./revert"
