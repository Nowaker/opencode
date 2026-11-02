import { expect, setDefaultTimeout, test } from "bun:test"
import { json } from "../../fixture/tui-sdk"
import {
  ENTER,
  applyPath,
  cardText,
  revertPath,
  session,
  sessionID,
  unrevertPath,
  withApp,
  type Rig,
} from "../../fixture/apply-revert"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(60_000)

test("Revert messages from the message menu, then Apply revert from the keyboard palette", async () => {
  const rig = await withApp({ width: 80, mode: "dark" }, async (rig: Rig) => {
    await rig.ready("second answer")
    await rig.click("second question")
    await rig.until("the message menu", () => rig.frame().includes("Message Actions"))
    const reverted = rig.gate(revertPath)
    await rig.click("Revert messages")
    await rig.until("the optimistic revert card", () => rig.frame().includes("1 message reverted"))
    // An idle revert hands the reverted prompt back to the composer, where the user keeps editing it.
    await rig.until("the reverted prompt in the composer", () => rig.draft().input === "second question")
    rig.setDraft("second question, reworded")
    const draft = rig.draft()
    await rig.evidence("palette-80-dark-1-reverted")

    // Applied while the revert request is still out, it waits for the revert to be stored.
    const applied = rig.gate(applyPath)
    await rig.palette("apply revert", true)
    await rig.evidence("palette-80-dark-2-palette")
    await rig.press(ENTER)
    await rig.until("the applying state", () => rig.frame().includes("Applying revert"))
    expect(rig.frame()).not.toContain("Commands")
    expect(rig.posts(applyPath)).toBe(0)
    await rig.evidence("palette-80-dark-3-applying")
    // The composer refuses to submit while the apply runs; Enter neither sends nor clears it.
    expect(rig.api.prompt.snapshot().disabled).toBe(true)
    await rig.press(ENTER)

    rig.updated({ messageID: "msg_0003" })
    reverted.resolve(json({ ...session, revert: { messageID: "msg_0003" } }))
    await rig.until("the apply request after the revert settled", () => rig.posts(applyPath) === 1)
    // The response alone removes nothing: the card stays until the server's events arrive.
    applied.resolve(json(session))
    await rig.until("the apply request to settle", () => !rig.frame().includes("Applying revert"))
    expect(rig.frame()).toContain("1 message reverted")
    expect(rig.messageIDs()).toEqual(["msg_0001", "msg_0002", "msg_0003", "msg_0004"])

    await rig.applied()
    await rig.evidence("palette-80-dark-4-applied")
    expect(rig.messageIDs()).toEqual(["msg_0001", "msg_0002"])
    expect(rig.frame()).not.toContain("second answer")
    expect(rig.draft()).toEqual(draft)
    expect(rig.api.prompt.snapshot().disabled).toBe(false)
  })
  expect([rig.posts(revertPath), rig.posts(applyPath), rig.posts(unrevertPath)]).toEqual([1, 1, 0])
})

test("clicking Apply revert stays off Redo, cannot run twice, and retries after a failure", async () => {
  const rig = await withApp({ width: 40, reverted: true, mode: "light" }, async (rig: Rig) => {
    await rig.ready("1 message reverted")
    rig.setDraft("keep this draft")
    const draft = rig.draft()
    const failed = rig.gate(applyPath)
    await rig.click("Apply revert")
    await rig.until("the apply request", () => rig.frame().includes("Applying revert") && rig.posts(applyPath) === 1)
    await rig.evidence("mouse-40-light-1-applying")
    // The release went to the action, not to the card underneath, whose release asks to confirm Redo.
    expect(rig.frame()).not.toContain("Confirm Redo")

    // While it runs, neither the command, the card, the composer nor the palette starts another.
    rig.api.keymap.dispatchCommand("session.revert.apply")
    await rig.click("Applying revert")
    await rig.press(ENTER)
    await rig.palette("apply revert", false)
    await rig.closePalette()
    expect(rig.frame()).not.toContain("Confirm Redo")
    expect(rig.posts(applyPath)).toBe(1)

    failed.resolve(json({ message: "apply exploded" }, { status: 500 }))
    await rig.until("the retry offer", () => rig.frame().includes("Retry apply revert"))
    // At 40 columns the hint wraps word by word beside the action.
    expect(cardText(rig.frame())).toContain("Retry apply revert the last apply failed")
    expect(rig.frame()).toContain("apply exploded")
    await rig.evidence("mouse-40-light-2-failed")

    const retried = rig.gate(applyPath)
    await rig.click("Retry apply revert")
    await rig.until("the retried apply request", () => rig.posts(applyPath) === 2)
    retried.resolve(json(session))
    await rig.until("the retry to settle", () => !rig.frame().includes("Applying revert"))
    await rig.applied()
    await rig.evidence("mouse-40-light-3-applied")
    expect(rig.messageIDs()).toEqual(["msg_0001", "msg_0002"])
    expect(rig.draft()).toEqual(draft)
  })
  expect([rig.posts(applyPath), rig.posts(unrevertPath)]).toEqual([2, 0])
})

test("Apply revert is unavailable while the session is busy and once nothing is reverted", async () => {
  const rig = await withApp({ width: 80, reverted: true }, async (rig: Rig) => {
    await rig.ready("1 message reverted")
    rig.emit({ id: "evt_busy", type: "session.status", properties: { sessionID, status: { type: "busy" } } })
    await rig.until("the busy hint", () => rig.frame().includes("available once the session is idle"))
    await rig.evidence("busy-80-dark-busy")
    await rig.click("Apply revert")
    rig.api.keymap.dispatchCommand("session.revert.apply")
    // The palette opens after the click and the command were handled, so its frame shows their effect.
    await rig.palette("apply revert", false)
    expect(rig.frame()).not.toContain("Applying revert")
    await rig.closePalette()

    rig.emit({ id: "evt_idle", type: "session.status", properties: { sessionID, status: { type: "idle" } } })
    await rig.until("the idle hint", () => rig.frame().includes("remove the reverted messages for good"))
    // A redo elsewhere cleared the revert: the card goes, and the command with it.
    rig.updated(undefined)
    await rig.until("the card to clear", () => !rig.frame().includes("message reverted"))
    rig.api.keymap.dispatchCommand("session.revert.apply")
    await rig.palette("apply revert", false)
    await rig.closePalette()
  })
  expect(rig.posts(applyPath)).toBe(0)
})

for (const width of [80, 40])
  for (const mode of ["dark", "light"] as const)
    test(`the card keeps its hint whole at ${width} columns in the ${mode} theme`, async () => {
      await withApp({ width, reverted: true, mode }, async (rig: Rig) => {
        await rig.ready("1 message reverted")
        expect(rig.api.theme.mode()).toBe(mode)
        expect(cardText(rig.frame())).toContain("Apply revert remove the reverted messages for good")
        await rig.evidence(`card-${width}-${mode}`)
      })
    })
