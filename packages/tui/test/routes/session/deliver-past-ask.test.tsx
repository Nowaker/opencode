import { expect, setDefaultTimeout, test } from "bun:test"
import { json } from "../../fixture/tui-sdk"
import { sessionID, withApp, type Rig } from "../../fixture/apply-revert"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(60_000)

const promptPath = `/session/${sessionID}/message`
const delivery = { sessionID, text: "from another session", messageID: "msg_0005", partID: "prt_0005" }

/**
 * A delivery while `ask` stands in for the composer: it reaches the server under the caller's IDs, and the prompt
 * stays on screen as it was, unanswered, with the composer still hidden from the person.
 */
async function deliverPast(rig: Rig, ask: { asked: () => void; shown: string; replyPath: string; answered: () => void }) {
  await rig.ready("second answer")
  ask.asked()
  await rig.until(`the ${ask.shown} prompt`, () => rig.frame().includes(ask.shown) && rig.api.prompt.snapshot().reason === "unmounted")
  const before = rig.frame()
  const sent = rig.gate(promptPath)

  expect(rig.api.prompt.deliver(delivery)).toEqual({ status: "submitted", messageID: "msg_0005", partID: "prt_0005" })
  await rig.until("the delivery to reach the server", () => rig.posts(promptPath) === 1)
  expect(rig.bodies(promptPath)).toEqual([
    expect.objectContaining({
      messageID: "msg_0005",
      agent: "build",
      model: { providerID: "test", modelID: "model" },
      parts: [{ id: "prt_0005", type: "text", text: "from another session" }],
    }),
  ])
  expect(rig.frame()).toEqual(before)
  expect(rig.api.prompt.snapshot()).toMatchObject({ reason: "unmounted", visible: false })
  expect(rig.posts(ask.replyPath)).toBe(0)

  sent.resolve(json({ info: { id: "msg_0005" }, parts: [] }))
  ask.answered()
  await rig.until("the composer back", () => !rig.frame().includes(ask.shown) && rig.api.prompt.snapshot().reason !== "unmounted")
  expect(rig.posts(ask.replyPath)).toBe(0)
}

test("a delivery while a permission is pending reaches the session and leaves the permission alone", async () => {
  const request = { id: "per_0001", sessionID, permission: "probe", patterns: ["*"], metadata: {}, always: ["*"] }
  const rig = await withApp({ width: 80, turns: true }, async (rig) => {
    await deliverPast(rig, {
      asked: () => rig.emit({ id: "evt_asked", type: "permission.asked", properties: request }),
      shown: "Call tool probe",
      replyPath: `/permission/${request.id}/reply`,
      answered: () =>
        rig.emit({ id: "evt_replied", type: "permission.replied", properties: { sessionID, requestID: request.id, reply: "once" } }),
    })
  })
  expect(rig.posts(promptPath)).toBe(1)
})

test("a delivery while a question is pending reaches the session and leaves the question alone", async () => {
  const request = {
    id: "que_0001",
    sessionID,
    questions: [{ header: "Probe", question: "Go on with the probe?", options: [{ label: "Yes", description: "go on" }] }],
  }
  const rig = await withApp({ width: 80, turns: true }, async (rig) => {
    await deliverPast(rig, {
      asked: () => rig.emit({ id: "evt_asked", type: "question.asked", properties: request }),
      shown: "Go on with the probe?",
      replyPath: `/question/${request.id}/reply`,
      answered: () =>
        rig.emit({ id: "evt_replied", type: "question.replied", properties: { sessionID, requestID: request.id, answers: [["Yes"]] } }),
    })
  })
  expect(rig.posts(promptPath)).toBe(1)
})
