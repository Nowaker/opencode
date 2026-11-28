import { expect, setDefaultTimeout, test } from "bun:test"
import { json } from "../../fixture/tui-sdk"
import { ENTER, sessionID, withApp, type Rig } from "../../fixture/apply-revert"
import {
  createApprovedActionSource,
  lineOf,
  receiptMessageID,
  row,
  status,
  storedOutcome,
  streamingAnswer,
  userPrompt,
} from "../../fixture/approved-action"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(60_000)

const promptPath = `/session/${sessionID}/message`
const transcript = ["msg_0001", "msg_0002", "msg_0003", "msg_0004"]
const RUNNING = "Approved action running"
// The composer's own line while only an approved action runs; the model's turn keeps "esc interrupt".
const IDLE_STATUS = "approved action running"
const INTERRUPT = "esc interrupt"
const exited = (exitCode: number) => ({ kind: "exited" as const, exitCode, output: "fixture output" })

type Owner = ReturnType<typeof createApprovedActionSource>

async function watched(rig: Rig, owner: Owner) {
  await rig.ready("second answer")
  await rig.until("the TUI to watch this session's owner", () => owner.subscribers() > 0 && owner.views.at(-1) === sessionID)
}

// A frame drawn after a synced prompt shows every store change made before it, snapshots included.
async function settle(rig: Rig, id: string, at: number) {
  userPrompt(rig, id, at, `fixture marker ${id}`)
  await rig.until(`marker ${id}`, () => rig.frame().includes(`fixture marker ${id}`))
}

async function leaveAndReturn(rig: Rig, owner: Owner) {
  const calls = owner.snapshotCalls.length
  rig.api.route.navigate("home")
  await rig.until("the home screen to clear the view", () => owner.views.at(-1) === undefined)
  rig.api.route.navigate("session", { sessionID })
  await rig.until(
    "the session to come back and ask for the owner's snapshot",
    () => owner.views.at(-1) === sessionID && owner.snapshotCalls.length > calls && rig.frame().includes("first answer"),
  )
}

test("an approved action running while the model is idle has its own row above the composer", async () => {
  const owner = createApprovedActionSource()
  await withApp({ width: 100, approvedAction: owner.source }, async (rig) => {
    await watched(rig, owner)
    owner.publish(row({ sequence: 1, phase: "running", preview: "fixture line 1\nfixture line 2" }))
    await rig.until("the running row", () => rig.frame().includes(RUNNING) && rig.frame().includes("fixture line 2"))

    const frame = rig.frame()
    expect(lineOf(frame, RUNNING)).toBeGreaterThan(lineOf(frame, "second answer"))
    expect(lineOf(frame, RUNNING)).toBeLessThan(lineOf(frame, IDLE_STATUS))
    expect(frame).not.toContain(INTERRUPT)
    expect(rig.api.prompt.snapshot().ready).toBe(true)
    expect(rig.messageIDs()).toEqual(transcript)
  })
})

test("a person's prompt still starts a turn during an approved action, and the row keeps updating beside it", async () => {
  const owner = createApprovedActionSource()
  await withApp({ width: 100, turns: true, approvedAction: owner.source }, async (rig) => {
    await watched(rig, owner)
    owner.publish(row({ sequence: 1, phase: "running", preview: "fixture line 1" }))
    await rig.until("the idle status of the approved action", () => rig.frame().includes(IDLE_STATUS))

    const sent = rig.gate(promptPath)
    rig.setDraft("fixture human question")
    await rig.press(ENTER)
    await rig.until("the prompt to reach the server", () => rig.posts(promptPath) === 1)
    sent.resolve(json({ info: { id: "msg_0005" }, parts: [] }))
    expect(rig.bodies(promptPath)[0]).toMatchObject({
      parts: [expect.objectContaining({ type: "text", text: "fixture human question" })],
    })

    userPrompt(rig, "msg_0005", 10, "fixture human question")
    status(rig, "busy", "evt_busy")
    streamingAnswer(rig, "msg_0006", 11, "msg_0005")
    owner.publish(row({ sequence: 2, phase: "running", preview: "fixture line 1\nfixture line 2" }))
    await rig.until(
      "the model's indicator beside the updated row",
      () => rig.frame().includes(INTERRUPT) && rig.frame().includes("fixture line 2"),
    )
    const busy = rig.frame()
    expect(busy).toContain(RUNNING)
    expect(busy).not.toContain(IDLE_STATUS)
    expect(lineOf(busy, RUNNING)).toBeGreaterThan(lineOf(busy, "fixture human question"))
    expect(rig.messageIDs()).toEqual([...transcript, "msg_0005", "msg_0006"])

    status(rig, "idle", "evt_idle")
    owner.publish(row({ sequence: 3, phase: "settled", preview: "fixture line 2", outcome: exited(0) }))
    await rig.until("the settled row", () => rig.frame().includes("Approved action exited 0"))
    expect(rig.frame()).not.toContain(IDLE_STATUS)
    expect(rig.frame()).not.toContain(RUNNING)
  })
})

test("the row sits just above the first queued prompt while the model works", async () => {
  const owner = createApprovedActionSource()
  await withApp({ width: 100, approvedAction: owner.source }, async (rig) => {
    await watched(rig, owner)
    userPrompt(rig, "msg_0005", 10, "fixture follow-up")
    streamingAnswer(rig, "msg_0006", 11, "msg_0005")
    userPrompt(rig, "msg_0007", 12, "fixture queued one")
    userPrompt(rig, "msg_0008", 13, "fixture queued two")
    status(rig, "busy", "evt_busy")
    owner.publish(row({ sequence: 1, phase: "running", preview: "fixture line 1" }))
    await rig.until(
      "the row and the queued prompts",
      () => rig.frame().includes(RUNNING) && rig.frame().includes("QUEUED") && rig.frame().includes("fixture queued two"),
    )

    const frame = rig.frame()
    expect(lineOf(frame, RUNNING)).toBeLessThan(lineOf(frame, "fixture queued one"))
    expect(lineOf(frame, RUNNING)).toBeLessThan(lineOf(frame, "QUEUED"))
    expect(frame).toContain(INTERRUPT)
  })
})

test("a running action from before the screen opened shows from the snapshot and survives leaving the session", async () => {
  const owner = createApprovedActionSource()
  owner.seed(row({ sequence: 4, phase: "running", preview: "fixture line 1" }))
  await withApp({ width: 100, approvedAction: owner.source }, async (rig) => {
    await watched(rig, owner)
    await rig.until("the row from the snapshot", () => rig.frame().includes(RUNNING))
    expect(owner.snapshotCalls).toContain(sessionID)

    rig.api.route.navigate("home")
    await rig.until("the home screen to clear the view", () => owner.views.at(-1) === undefined)
    owner.publish(row({ sequence: 5, phase: "running", preview: "fixture line 1\nfixture line 2" }))
    rig.api.route.navigate("session", { sessionID })
    await rig.until(
      "the row back with its newest preview",
      () => owner.views.at(-1) === sessionID && rig.frame().includes(RUNNING) && rig.frame().includes("fixture line 2"),
    )
  })
})

test("a slow snapshot or a replayed event never replaces a newer row, and a newer action does", async () => {
  const owner = createApprovedActionSource()
  const snapshot = owner.holdSnapshot()
  await withApp({ width: 100, approvedAction: owner.source }, async (rig) => {
    await rig.ready("second answer")
    await rig.until("the snapshot request", () => owner.snapshotCalls.includes(sessionID) && owner.subscribers() > 0)
    owner.publish(row({ sequence: 3, phase: "settled", outcome: exited(7) }))
    await rig.until("the settled row", () => rig.frame().includes("Approved action exited 7"))

    snapshot.resolve(row({ sequence: 2, phase: "running", preview: "fixture stale line" }))
    owner.replay(row({ sequence: 1, phase: "running", preview: "fixture replayed line" }))
    await settle(rig, "msg_0005", 10)
    const frame = rig.frame()
    expect(frame).toContain("Approved action exited 7")
    expect(frame).not.toContain(RUNNING)
    expect(frame).not.toContain("fixture stale line")
    expect(frame).not.toContain("fixture replayed line")

    owner.publish(
      row({ sequence: 4, phase: "running", actionID: "qac_FixtureRun02", messageID: "msg_0091", preview: "fixture next action" }),
    )
    await rig.until("the newer action's row", () => rig.frame().includes("fixture next action"))
    expect(rig.frame()).not.toContain("Approved action exited 7")
  })
})

test("a settled row gives way to its stored outcome and never shows twice", async () => {
  const owner = createApprovedActionSource()
  await withApp({ width: 100, approvedAction: owner.source }, async (rig) => {
    await watched(rig, owner)
    owner.publish(row({ sequence: 1, phase: "running", preview: "fixture line 1" }))
    owner.publish(row({ sequence: 2, phase: "settled", preview: "fixture line 1", outcome: exited(0) }))
    await rig.until("the settled row", () => rig.frame().includes("Approved action exited 0"))

    storedOutcome(rig, 20, exited(0))
    await rig.until(
      "the stored outcome to replace the row",
      () => rig.api.state.part(receiptMessageID).length === 1 && !rig.frame().includes("Approved action exited 0"),
    )

    await leaveAndReturn(rig, owner)
    await settle(rig, "msg_0095", 30)
    expect(rig.frame()).not.toContain("Approved action exited")
    expect(rig.api.state.part(receiptMessageID)).toHaveLength(1)
  })
})

test("a settled event arriving after its stored outcome never shows a row", async () => {
  const owner = createApprovedActionSource()
  await withApp({ width: 100, approvedAction: owner.source }, async (rig) => {
    await watched(rig, owner)
    storedOutcome(rig, 20, exited(3))
    await rig.until("the stored outcome to sync", () => rig.api.state.part(receiptMessageID).length === 1)

    owner.publish(row({ sequence: 2, phase: "settled", outcome: exited(3) }))
    await settle(rig, "msg_0095", 30)
    expect(rig.frame()).not.toContain("Approved action exited")
  })
})

test("an action that did not run, or whose result was not recorded, says so in plain words", async () => {
  const owner = createApprovedActionSource()
  await withApp({ width: 100, approvedAction: owner.source }, async (rig) => {
    await watched(rig, owner)
    owner.publish(row({ sequence: 1, phase: "settled", outcome: { kind: "not-run", reason: "launch-refused" } }))
    await rig.until("the not-run row", () => rig.frame().includes("Approved action did not run · the launch was refused"))
    expect(rig.frame()).not.toContain("launch-refused")

    owner.publish(row({ sequence: 2, phase: "unconfirmed", actionID: "qac_FixtureRun02", messageID: "msg_0091" }))
    await rig.until("the unconfirmed row", () => rig.frame().includes("Approved action finished · result not recorded"))
    expect(rig.frame()).not.toContain("did not run")
  })
})

test("a pending permission keeps its dialog while the row stays in the transcript", async () => {
  const owner = createApprovedActionSource()
  const request = { id: "per_0001", sessionID, permission: "probe", patterns: ["*"], metadata: {}, always: ["*"] }
  await withApp({ width: 100, approvedAction: owner.source }, async (rig) => {
    await watched(rig, owner)
    owner.publish(row({ sequence: 1, phase: "running", preview: "fixture line 1" }))
    await rig.until("the running row", () => rig.frame().includes(RUNNING))

    rig.emit({ id: "evt_asked", type: "permission.asked", properties: request })
    await rig.until("the permission prompt", () => rig.frame().includes("Call tool probe"))
    expect(rig.frame()).toContain(RUNNING)
    expect(rig.api.prompt.snapshot().reason).toBe("unmounted")

    rig.emit({
      id: "evt_replied",
      type: "permission.replied",
      properties: { sessionID, requestID: request.id, reply: "once" },
    })
    await rig.until(
      "the composer back with the row still in the transcript",
      () =>
        !rig.frame().includes("Call tool probe") &&
        rig.api.prompt.snapshot().reason !== "unmounted" &&
        rig.frame().includes(RUNNING),
    )
  })
})
