import type { ApprovedActionActivity, ApprovedActionFailure, ApprovedActionReceipt } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk/v2"
import { createSignal, onCleanup } from "solid-js"

/** The embedded owner's private activity channel; only a portless TUI whose worker enabled approved actions has it. */
export type ApprovedActivitySource = {
  readonly view: (sessionID?: string) => Promise<void>
  readonly activity: (sessionID: string) => Promise<ApprovedActionActivity | undefined>
  readonly subscribe: (handler: (activity: ApprovedActionActivity) => void) => () => void
}

// Rows of sessions left long ago are dropped first; a running row is kept as long as anything else can go.
const SESSION_LIMIT = 16

export function createApprovedActivity(source: ApprovedActivitySource) {
  const [rows, setRows] = createSignal<ReadonlyMap<string, ApprovedActionActivity>>(new Map())
  const merge = (activity: ApprovedActionActivity) => setRows((current) => mergeActivity(current, activity))
  onCleanup(source.subscribe(merge))
  return {
    get: (sessionID: string) => rows().get(sessionID),
    view: (sessionID?: string) => void source.view(sessionID).catch(() => {}),
    // The subscription is open before this runs, so an event and the snapshot can only race, never leave a gap.
    refresh: (sessionID: string) =>
      void source
        .activity(sessionID)
        .then((activity) => activity?.sessionID === sessionID && merge(activity))
        .catch(() => {}),
  }
}

/** The owner numbers rows across all actions, so the highest sequence is the newest whatever arrives late. */
export function mergeActivity(rows: ReadonlyMap<string, ApprovedActionActivity>, activity: ApprovedActionActivity) {
  const current = rows.get(activity.sessionID)
  if (current && current.sequence >= activity.sequence) return rows
  const next = new Map(rows)
  next.delete(activity.sessionID)
  next.set(activity.sessionID, activity)
  while (next.size > SESSION_LIMIT) {
    const older = [...next.values()].filter((row) => row.sessionID !== activity.sessionID)
    const evicted = older.find((row) => row.phase !== "running") ?? older[0]
    if (!evicted) break
    next.delete(evicted.sessionID)
  }
  return next
}

/**
 * A finished row gives way once its canonical outcome part is in the transcript and no longer held behind a queue
 * or pause; a running one never does.
 */
export function activityShown(
  activity: ApprovedActionActivity,
  receipt: { readonly parts: readonly Part[] | undefined; readonly held: boolean },
) {
  if (activity.phase === "running" || receipt.held) return true
  return !receipt.parts?.some((part) => recordedBy(activity, part))
}

export function isReceipt(part: Part) {
  return part.type === "text" && part.metadata?.vibetermApprovedAction !== undefined
}

function recordedBy(activity: ApprovedActionActivity, part: Part) {
  if (part.type !== "text") return false
  const marker: unknown = part.metadata?.vibetermApprovedAction
  return (
    typeof marker === "object" &&
    marker !== null &&
    "version" in marker &&
    marker.version === 1 &&
    "sessionID" in marker &&
    marker.sessionID === activity.sessionID &&
    "actionID" in marker &&
    marker.actionID === activity.actionID &&
    "messageID" in marker &&
    marker.messageID === activity.messageID
  )
}

const failures: Record<ApprovedActionFailure, string> = {
  "owner-lost": "the session owner stopped",
  "pane-unavailable": "its terminal pane is gone",
  "claim-unavailable": "the run could not be claimed",
  "launch-refused": "the launch was refused",
  "result-unavailable": "no result came back",
}

const unconfirmed = { text: "Approved action finished · result not recorded", warning: true, running: false }

export function describeActivity(activity: ApprovedActionActivity) {
  switch (activity.phase) {
    case "running":
      return { text: "Approved action running", warning: false, running: true }
    case "unconfirmed":
      return unconfirmed
    case "settled":
      return activity.outcome ? describeOutcome(activity.outcome) : unconfirmed
  }
}

function describeOutcome(outcome: ApprovedActionReceipt["outcome"]) {
  switch (outcome.kind) {
    case "exited":
      return { text: `Approved action exited ${outcome.exitCode}`, warning: outcome.exitCode !== 0, running: false }
    case "not-run":
      return { text: `Approved action did not run · ${failures[outcome.reason]}`, warning: true, running: false }
    case "unknown":
      return { text: `Approved action result unknown · ${failures[outcome.reason]}`, warning: true, running: false }
  }
}

/** The last few lines of the live preview, enough to see it move without growing the transcript. */
export function approvedPreviewLines(activity: ApprovedActionActivity) {
  return activity.preview
    .split("\n")
    .filter((line) => line.trim())
    .slice(-3)
}
