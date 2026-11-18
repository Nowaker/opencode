import { expect, setDefaultTimeout, test } from "bun:test"
import { json } from "../../fixture/tui-sdk"
import { ENTER, sessionID, withApp, type Rig } from "../../fixture/apply-revert"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(60_000)

const promptPath = `/session/${sessionID}/message`
const created = 1_700_000_000_000

/** A user message another client wrote, as this TUI's server publishes it. */
function arrive(rig: Rig, id: string, at: number, agent: string, modelID: string, variant?: string) {
  rig.emit({
    id: `evt_${id}_${agent}_${modelID}`,
    type: "message.updated",
    properties: {
      sessionID,
      info: {
        id,
        sessionID,
        role: "user",
        agent,
        model: { providerID: "test", modelID, ...(variant ? { variant } : {}) },
        time: { created: created + at },
      },
    },
  })
}

/** The agent, model and variant a delivery past the composer is sent with: the TUI's current pick. */
async function picked(rig: Rig, n: number) {
  const messageID = `msg_01${String(n).padStart(2, "0")}`
  const sent = rig.gate(promptPath)
  const before = rig.posts(promptPath)
  expect(rig.api.prompt.deliver({ sessionID, text: "probe", messageID, partID: `prt_01${String(n).padStart(2, "0")}` }))
    .toMatchObject({ status: "submitted" })
  await rig.until("the probe to reach the server", () => rig.posts(promptPath) === before + 1)
  sent.resolve(json({ info: { id: messageID }, parts: [] }))
  const body = rig.bodies(promptPath).at(-1)
  return { agent: body.agent, model: { providerID: body.model.providerID, modelID: body.model.modelID }, variant: body.variant }
}

const initial = { agent: "build", model: { providerID: "test", modelID: "model" }, variant: undefined }

test("a user message from another client moves the pick, and the next delivery and submit run on it", async () => {
  await withApp({ width: 100, turns: true, choices: true }, async (rig) => {
    await rig.ready("second answer")
    expect(await picked(rig, 1)).toEqual(initial)

    arrive(rig, "msg_0010", 10, "plan", "other", "high")
    await rig.until("the footer to show the adopted model", () => rig.frame().includes("Other"))
    const adopted = { agent: "plan", model: { providerID: "test", modelID: "other" }, variant: "high" }
    expect(await picked(rig, 2)).toEqual(adopted)

    const sent = rig.gate(promptPath)
    rig.setDraft("typed here")
    await rig.press(ENTER)
    await rig.until("the typed prompt to reach the server", () => rig.posts(promptPath) === 3)
    sent.resolve(json({ info: { id: "msg_0099" }, parts: [] }))
    expect(rig.bodies(promptPath).at(-1)).toMatchObject(adopted)
  })
})

test("a message rewritten under the same id moves the pick to what it was rewritten to", async () => {
  await withApp({ width: 100, turns: true, choices: true }, async (rig) => {
    await rig.ready("second answer")
    arrive(rig, "msg_0010", 10, "build", "model")
    expect(await picked(rig, 1)).toEqual(initial)

    arrive(rig, "msg_0010", 10, "plan", "other", "max")
    await rig.until("the footer to show the rewritten model", () => rig.frame().includes("Other"))
    expect(await picked(rig, 2)).toEqual({ agent: "plan", model: { providerID: "test", modelID: "other" }, variant: "max" })
  })
})

test("an open dialog holds the pick, which moves once the dialog closes", async () => {
  await withApp({ width: 100, turns: true, choices: true }, async (rig) => {
    await rig.ready("second answer")
    rig.api.keymap.dispatchCommand("agent.list")
    await rig.until("the agent dialog", () => rig.frame().includes("Select agent"))

    arrive(rig, "msg_0010", 10, "plan", "other", "high")
    await rig.until("the message to sync", () => rig.messageIDs().includes("msg_0010"))
    expect(await picked(rig, 1)).toEqual(initial)

    rig.api.ui.dialog.clear()
    await rig.until("the dialog to close", () => !rig.frame().includes("Select agent"))
    expect(await picked(rig, 2)).toEqual({ agent: "plan", model: { providerID: "test", modelID: "other" }, variant: "high" })
  })
})

test("a choice the person made while the dialog was open wins over the message that arrived meanwhile", async () => {
  await withApp({ width: 100, turns: true, choices: true }, async (rig) => {
    await rig.ready("second answer")
    rig.api.keymap.dispatchCommand("agent.list")
    await rig.until("the agent dialog", () => rig.frame().includes("Select agent"))

    arrive(rig, "msg_0010", 10, "build", "other", "high")
    await rig.until("the message to sync", () => rig.messageIDs().includes("msg_0010"))
    rig.api.keymap.dispatchCommand("agent.cycle")
    rig.api.ui.dialog.clear()
    await rig.until("the dialog to close", () => !rig.frame().includes("Select agent"))
    expect(await picked(rig, 1)).toEqual({ ...initial, agent: "plan" })
  })
})

test("a message naming an agent that is not a primary one leaves the pick alone", async () => {
  await withApp({ width: 100, turns: true, choices: true }, async (rig) => {
    await rig.ready("second answer")
    arrive(rig, "msg_0010", 10, "explore", "other", "high")
    await rig.until("the message to sync", () => rig.messageIDs().includes("msg_0010"))
    expect(await picked(rig, 1)).toEqual(initial)
  })
})
