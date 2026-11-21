import { expect, setDefaultTimeout, test } from "bun:test"
import { json } from "../../fixture/tui-sdk"
import { ENTER, autoSwitchPath, sessionID, withApp } from "../../fixture/apply-revert"
import type { AutoSwitchStatus } from "../../../src/component/prompt/auto-switch"

// The first test in the file also pays for starting the whole app.
setDefaultTimeout(60_000)

const opus = { agent: "build", providerID: "anthropic", modelID: "claude-opus-5-5", variant: "high" }
const sol = { agent: "build", providerID: "openai", modelID: "sol", variant: "xhigh" }

function status(patch: Partial<AutoSwitchStatus> = {}): AutoSwitchStatus {
  return {
    version: 1,
    sessionID,
    availability: "available",
    ownerEpoch: "epoch-1",
    revision: 3,
    preference: "inherit",
    enabled: true,
    reason: "default-on",
    returnPending: false,
    preferred: opus,
    effective: opus,
    ...patch,
  }
}

// The row under the composer that holds the agent and model.
const metaRow = (frame: string) => frame.split("\n").find((line) => line.includes("Auto-switch:")) ?? ""

test("the toggle beside the model saves through the owner, shows Saving, and keeps the draft", async () => {
  const server = { status: status() }
  await withApp({ width: 100, autoSwitch: () => json(server.status) }, async (rig) => {
    await rig.ready("second answer")
    await rig.until("the toggle", () => metaRow(rig.frame()).includes("Auto-switch: On"))
    expect(metaRow(rig.frame())).toMatch(/Build · Model Test · Auto-switch: On default/)
    // An owner that reports no automatic return gets no auto-return toggle, and the rest still works.
    expect(rig.frame()).not.toContain("Auto-return")
    rig.setDraft("half-typed thought")

    const saved = rig.gate(autoSwitchPath)
    await rig.click("Auto-switch: On")
    await rig.until("the save to reach the owner", () => rig.posts(autoSwitchPath, "PUT") === 1)
    expect(rig.bodies(autoSwitchPath, "PUT")).toEqual([
      { action: "set-preference", preference: "off", ownerEpoch: "epoch-1", revision: 3 },
    ])
    await rig.until("Saving with the acknowledged value", () => metaRow(rig.frame()).includes("Auto-switch: On Saving..."))

    server.status = status({ preference: "off", enabled: false, reason: "session-off", revision: 4 })
    saved.resolve(json(server.status))
    await rig.until("the owner's acknowledgement", () => metaRow(rig.frame()).includes("Auto-switch: Off"))
    expect(metaRow(rig.frame())).not.toContain("Saving")
    expect(rig.draft().input).toBe("half-typed thought")
  })
})

test("a stale save shows the owner's current state and says it was not saved", async () => {
  await withApp({ width: 100, autoSwitch: () => json(status()) }, async (rig) => {
    await rig.ready("second answer")
    await rig.until("the toggle", () => metaRow(rig.frame()).includes("Auto-switch: On"))
    const saved = rig.gate(autoSwitchPath)
    await rig.click("Auto-switch: On")
    await rig.until("the save to reach the owner", () => rig.posts(autoSwitchPath, "PUT") === 1)
    saved.resolve(json(status({ revision: 5, reason: "rule-on" }), { status: 409 }))
    await rig.until("the conflict", () => metaRow(rig.frame()).includes("Not saved: changed elsewhere"))
    expect(metaRow(rig.frame())).toContain("Auto-switch: On")
  })
})

test("/auto-switch toggles from the keyboard without sending a prompt", async () => {
  await withApp({ width: 100, autoSwitch: () => json(status({ enabled: false, reason: "rule-off" })) }, async (rig) => {
    await rig.ready("second answer")
    await rig.until("the toggle", () => metaRow(rig.frame()).includes("Auto-switch: Off by rule"))
    // The composer keeps its text across the tests in this file; a slash command starts an empty one.
    rig.setDraft("")
    const saved = rig.gate(autoSwitchPath)
    await rig.press("/auto-switch")
    await rig.until("the slash command", () => rig.frame().includes("Toggle auto-switch"))
    await rig.press(ENTER)
    await rig.until("the save to reach the owner", () => rig.posts(autoSwitchPath, "PUT") === 1)
    expect(rig.bodies(autoSwitchPath, "PUT")).toEqual([
      { action: "set-preference", preference: "on", ownerEpoch: "epoch-1", revision: 3 },
    ])
    saved.resolve(json(status({ preference: "on", reason: "session-on", revision: 4 })))
    await rig.until("the owner's acknowledgement", () => /Auto-switch: On(?! by rule)/.test(metaRow(rig.frame())))
    expect(rig.draft().input).toBe("")
  })
})

test("an engine without the capability shows unsupported, explains it, and is never sent a session route", async () => {
  await withApp({ width: 100 }, async (rig) => {
    await rig.ready("second answer")
    await rig.until("the toggle", () => metaRow(rig.frame()).includes("Auto-switch: unsupported"))
    await rig.click("Auto-switch: unsupported")
    await rig.until("the reason", () => rig.frame().includes("Auto-switch needs a newer engine"))
    rig.api.keymap.dispatchCommand("session.auto_switch.toggle")
    expect(rig.posts(autoSwitchPath, "GET") + rig.posts(autoSwitchPath, "PUT")).toBe(0)
  })
})

test("an alternate in use shows both routes, returns on click, and leaves the composer's pick alone", async () => {
  const server = { status: status({ reason: "alternate-active", effective: sol }) }
  await withApp({ width: 100, autoSwitch: () => json(server.status) }, async (rig) => {
    await rig.ready("second answer")
    await rig.until("the alternate", () =>
      rig.frame().includes("Using sol xhigh (preferred: claude-opus-5-5 high)  Return to preferred"),
    )
    const saved = rig.gate(autoSwitchPath)
    await rig.click("Return to preferred")
    await rig.until("the return to reach the owner", () => rig.posts(autoSwitchPath, "PUT") === 1)
    expect(rig.bodies(autoSwitchPath, "PUT")).toEqual([{ action: "return-to-preferred", ownerEpoch: "epoch-1", revision: 3 }])
    await rig.until("the pending return", () => rig.frame().includes("returning at next step"))
    server.status = status({ reason: "return-pending", returnPending: true, effective: sol, revision: 4 })
    saved.resolve(json(server.status))
    await rig.until("the acknowledged return", () => !metaRow(rig.frame()).includes("Saving"))
    expect(rig.frame()).toContain("Using sol xhigh (preferred: claude-opus-5-5 high)  returning at next step")
    expect(rig.frame()).not.toContain("Return to preferred")
    expect(metaRow(rig.frame())).toContain("Build · Model Test")
  })
})

test("session.updated rereads the owner's status", async () => {
  const server = { status: status() }
  await withApp({ width: 100, autoSwitch: () => json(server.status) }, async (rig) => {
    await rig.ready("second answer")
    await rig.until("the toggle", () => metaRow(rig.frame()).includes("Auto-switch: On"))
    server.status = status({ enabled: false, reason: "pinned", revision: 4 })
    rig.updated(undefined)
    await rig.until("the reread", () => metaRow(rig.frame()).includes("Auto-switch: Off pinned"))
    await rig.click("Auto-switch: Off")
    await rig.until("the reason", () => rig.frame().includes("This session's route is pinned"))
    expect(rig.posts(autoSwitchPath, "PUT")).toBe(0)
  })
})

const automatic = {
  returnPreference: "inherit",
  returnEnabled: true,
  returnState: "preferred",
  next: opus,
} satisfies Partial<AutoSwitchStatus>

test("the auto-return toggle saves its own preference and keeps the draft", async () => {
  await withApp({ width: 120, autoSwitch: () => json(status(automatic)) }, async (rig) => {
    await rig.ready("second answer")
    await rig.until("both toggles", () =>
      metaRow(rig.frame()).includes("Auto-switch: On default · Auto-return: On default"),
    )
    rig.setDraft("still typing")
    const saved = rig.gate(autoSwitchPath)
    await rig.click("Auto-return: On")
    await rig.until("the save to reach the owner", () => rig.posts(autoSwitchPath, "PUT") === 1)
    expect(rig.bodies(autoSwitchPath, "PUT")).toEqual([
      { action: "set-return-preference", preference: "off", ownerEpoch: "epoch-1", revision: 3 },
    ])
    await rig.until("Saving on the auto-return toggle", () =>
      metaRow(rig.frame()).includes("Auto-switch: On default · Auto-return: On Saving..."),
    )
    saved.resolve(
      json(status({ ...automatic, returnPreference: "off", returnEnabled: false, returnState: "return-off", revision: 4 })),
    )
    await rig.until("the owner's acknowledgement", () => metaRow(rig.frame()).includes("Auto-return: Off"))
    expect(rig.draft().input).toBe("still typing")
  })
})

test("the next route is a preview: a submitted prompt still carries the composer's pick", async () => {
  const promptPath = `/session/${sessionID}/message`
  await withApp(
    { width: 120, turns: true, autoSwitch: () => json(status({ ...automatic, next: sol })) },
    async (rig) => {
      await rig.ready("second answer")
      await rig.until("the next route", () => rig.frame().includes("Next: sol xhigh (preferred: claude-opus-5-5 high)"))
      expect(metaRow(rig.frame())).toContain("Build · Model Test")
      rig.setDraft("go on")
      const sent = rig.gate(promptPath)
      await rig.press(ENTER)
      await rig.until("the prompt to reach the server", () => rig.posts(promptPath) === 1)
      sent.resolve(json({ info: { id: "msg_0099" }, parts: [] }))
      expect(rig.bodies(promptPath).at(-1)).toMatchObject({ agent: "build", model: { providerID: "test", modelID: "model" } })
    },
  )
})

test("the owner going idle rereads the status, which is where a ready return shows first", async () => {
  const server = { status: status({ ...automatic, effective: sol, returnState: "alternate", next: sol }) }
  await withApp({ width: 120, autoSwitch: () => json(server.status) }, async (rig) => {
    await rig.ready("second answer")
    await rig.until("the alternate", () => rig.frame().includes("Using sol xhigh (preferred: claude-opus-5-5 high)"))
    server.status = status({ ...automatic, effective: sol, returnState: "returning", next: opus, revision: 4 })
    rig.emit({ id: "evt_idle", type: "session.status", properties: { sessionID, status: { type: "idle" } } })
    await rig.until("the reread", () => rig.frame().includes("returning at next step"))
    expect(metaRow(rig.frame())).toContain("Build · Model Test")
  })
})
