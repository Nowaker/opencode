import { expect, setDefaultTimeout, test } from "bun:test"
import { json } from "../../fixture/tui-sdk"
import { ENTER, cybersecPath, sessionID, withApp, type Rig } from "../../fixture/apply-revert"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(60_000)

type Preference = "inherit" | "on" | "off"
const status = (preference: Preference, revision: number) => json({ preference, revision })

// A slash command starts from an empty composer; the rig keeps the composer's text across scenarios.
async function slash(rig: Rig, text: string) {
  rig.setDraft("")
  await rig.press(text)
  await rig.press(ENTER)
}

async function openModels(rig: Rig) {
  rig.api.keymap.dispatchCommand("model.list")
  await rig.until("the model dialog", () => rig.frame().includes("Select model"))
}

const notice = (rig: Rig, revision: number) =>
  rig.emit({
    id: `evt_cybersec_${revision}`,
    type: "vibeterm.session.cybersec_preservation.updated",
    properties: { version: 1, sessionID, revision },
  })

const reads = (rig: Rig) => rig.posts(cybersecPath, "GET")
const writes = (rig: Rig) => rig.bodies(cybersecPath, "PUT")

test("/cybersec on saves through the owner without sending a prompt and empties the composer", async () => {
  await withApp({ width: 120, cybersecPreservation: () => status("inherit", 0) }, async (rig) => {
    await rig.ready("second answer")
    const saved = rig.gate(cybersecPath)
    await slash(rig, "/cybersec on")
    await rig.until("the save to reach the owner", () => writes(rig).length === 1)
    expect(writes(rig)).toEqual([{ preference: "on" }])
    saved.resolve(status("on", 1))
    await rig.until("the composer to empty", () => rig.draft().input === "")
  })
})

test("/cybersec with an unknown value sends nothing and keeps the draft", async () => {
  await withApp({ width: 120, cybersecPreservation: () => status("inherit", 0) }, async (rig) => {
    await rig.ready("second answer")
    await slash(rig, "/cybersec maybe")
    await rig.until("the usage", () => rig.frame().includes("/cybersec on|off|inherit"))
    expect(writes(rig)).toEqual([])
    expect(rig.draft().input).toBe("/cybersec maybe")
  })
})

test("an engine without the capability says so and is never sent the session route", async () => {
  await withApp({ width: 120 }, async (rig) => {
    await rig.ready("second answer")
    await slash(rig, "/cybersec off")
    await rig.until("the reason", () => rig.frame().includes("needs a newer engine"))
    await openModels(rig)
    await rig.until("the unsupported control", () => rig.frame().includes("Cybersec: unsupported"))
    expect(reads(rig) + writes(rig).length).toBe(0)
  })
})

test("the model dialog sets the session's preference from the keyboard and adds nothing to the session view", async () => {
  const server: { preference: Preference; revision: number } = { preference: "inherit", revision: 0 }
  await withApp({ width: 120, cybersecPreservation: () => status(server.preference, server.revision) }, async (rig) => {
    await rig.ready("second answer")
    const layout = rig.frame()
    expect(layout).not.toContain("Cybersec")

    await openModels(rig)
    // Shown only once the action has a key: the dialog footer drops actions with no binding.
    await rig.until("the control", () => rig.frame().includes("Cybersec: inherit"))
    rig.api.keymap.dispatchCommand("model.dialog.cybersec")
    await rig.until("the three choices", () => {
      const shown = rig.frame()
      return shown.includes("Follow this machine's default") && shown.includes("On") && shown.includes("Off")
    })
    // The filter takes focus a tick after the dialog mounts; keys typed before that are lost.
    await rig.until("the choice filter", () => rig.filterFocused())
    const saved = rig.gate(cybersecPath)
    await rig.press("Off")
    await rig.press(ENTER)
    await rig.until("the save to reach the owner", () => writes(rig).length === 1)
    expect(writes(rig)).toEqual([{ preference: "off" }])
    Object.assign(server, { preference: "off", revision: 1 })
    saved.resolve(status("off", 1))

    await openModels(rig)
    await rig.until("the acknowledged value", () => rig.frame().includes("Cybersec: off"))
    rig.api.ui.dialog.clear()
    await rig.until("the dialog to close", () => !rig.frame().includes("Select model"))
    expect(rig.frame().split("\n").length).toBe(layout.split("\n").length)
    expect(rig.frame()).not.toContain("Cybersec")
  })
})

test("an unbound owner shows unavailable, never inherit, and refuses the change", async () => {
  await withApp({ width: 120, cybersecPreservation: () => json({ message: "owner unavailable" }, { status: 503 }) }, async (rig) => {
    await rig.ready("second answer")
    await openModels(rig)
    await rig.until("the unavailable control", () => rig.frame().includes("Cybersec: unavailable"))
    expect(rig.frame()).not.toContain("Cybersec: inherit")
    rig.api.keymap.dispatchCommand("model.dialog.cybersec")
    await rig.until("the reason", () => rig.frame().includes("owner unavailable"))
    expect(writes(rig)).toEqual([])
  })
})

test("the owner's change notice rereads the preference once, and a stale notice reads nothing", async () => {
  const server: { preference: Preference; revision: number } = { preference: "inherit", revision: 0 }
  await withApp({ width: 120, cybersecPreservation: () => status(server.preference, server.revision) }, async (rig) => {
    await rig.ready("second answer")
    await openModels(rig)
    await rig.until("the control", () => rig.frame().includes("Cybersec: inherit"))
    const before = reads(rig)
    Object.assign(server, { preference: "on", revision: 1 })
    notice(rig, 1)
    await rig.until("the reread", () => reads(rig) === before + 1 && rig.frame().includes("Cybersec: on"))
    // Neither a notice already shown nor a generic session update reads; the newer notice after them
    // is the barrier, since notices are handled in order.
    notice(rig, 1)
    rig.updated(undefined)
    Object.assign(server, { preference: "off", revision: 2 })
    notice(rig, 2)
    await rig.until("the newer reread", () => rig.frame().includes("Cybersec: off"))
    expect(reads(rig)).toBe(before + 2)
  })
})
