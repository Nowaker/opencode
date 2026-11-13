export * as SubagentCompletion from "./subagent-completion.js"

import { Effect } from "effect"
import { and, desc, eq, sql } from "drizzle-orm"
import type { Job } from "../job.js"
import type { Session } from "../session.js"
import type { SessionMessage } from "./message.js"
import type { Database } from "../database/database.js"
import { SubagentGroup } from "./subagent-group.js"
import { SessionHistory } from "./history.js"
import { SessionMessageTable } from "./sql.js"

export const NO_TEXT = "Subagent completed without a text response."

export function text(message: SessionMessage.Info | undefined) {
  if (message?.type !== "assistant") return NO_TEXT
  return (
    message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter((text) => text.length > 0)
      .join("\n\n") || NO_TEXT
  )
}

export const read = Effect.fn("SubagentCompletion.read")(function* (
  db: Database.Interface["db"],
  input: Pick<Extract<Job.Recovery, { kind: "subagent" }>, "childSessionID" | "after">,
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, input.childSessionID),
        eq(SessionMessageTable.type, "assistant"),
        sql`json_extract(${SessionMessageTable.data}, '$.time.completed') is not null`,
        sql`json_extract(${SessionMessageTable.data}, '$.error') is null`,
        input.after === undefined
          ? undefined
          : sql`${SessionMessageTable.seq} > (
      select ${SessionMessageTable.seq} from ${SessionMessageTable}
      where ${SessionMessageTable.session_id} = ${input.childSessionID} and ${SessionMessageTable.id} = ${input.after}
    )`,
      ),
    )
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return text(row ? yield* SessionHistory.loadMessageRow(db, row) : undefined)
})

export const deliver = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "synthetic">,
  jobs: Pick<Job.Interface, "completeBackground">,
  input: Pick<Job.Info, "status" | "output" | "error" | "notificationID"> & {
    recovery: Extract<Job.Recovery, { kind: "subagent" }>
    resume?: boolean
    db: Database.Interface["db"]
  },
) {
  if (input.status === "running") return
  const recovery = input.recovery
  if (recovery.group) {
    yield* SubagentGroup.update(input.db, recovery.group, {
      status: input.status,
      ...(input.output === undefined ? {} : { output: input.output }),
      ...(input.error === undefined ? {} : { error: input.error }),
    })
    const state = yield* SubagentGroup.get(input.db, recovery.parentSessionID, recovery.group.id)
    if (state) yield* deliverGroup(sessions, { db: input.db, state, resume: input.resume })
    if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
    return
  }
  if (recovery.notice === "none") {
    if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
    return
  }
  const text =
    input.status === "completed"
      ? (input.output ?? NO_TEXT)
      : input.status === "error"
        ? (input.error ?? "Subagent failed")
        : "Subagent cancelled"
  yield* sessions.synthetic({
    ...(input.notificationID ? { id: input.notificationID } : {}),
    sessionID: recovery.parentSessionID,
    ...(input.resume === false ? { resume: false } : {}),
    description: recovery.description,
    text: `<subagent sessionID="${recovery.childSessionID}" state="${input.status}" description="${recovery.description}">\n${text}\n</subagent>`,
    metadata: { source: "subagent", childID: recovery.childSessionID, agent: recovery.agent, state: input.status },
  })
  if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
})

export const deliverGroup = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "synthetic">,
  input: { readonly db: Database.Interface["db"]; readonly state: SubagentGroup.State; readonly resume?: boolean },
) {
  const state = input.state
  if (state.delivered || !SubagentGroup.ready(state)) return
  yield* sessions.synthetic({
    id: state.notificationID,
    sessionID: state.parentSessionID,
    ...(input.resume === false ? { resume: false } : {}),
    description: `Subagent group ${state.id}`,
    text: state.slots.toSorted((a, b) => a.index - b.index).map((slot) =>
      `<subagent index="${slot.index}"${slot.childSessionID ? ` sessionID="${slot.childSessionID}"` : ""} state="${slot.status}" agent="${slot.agent}" description="${slot.description}">\n${slot.status === "completed" ? slot.output ?? NO_TEXT : slot.error ?? `Subagent ${slot.status}`}\n</subagent>`,
    ).join("\n\n"),
    metadata: { source: "subagent-group", groupID: state.id, total: state.total },
  })
  yield* SubagentGroup.acknowledge(input.db, state)
})
