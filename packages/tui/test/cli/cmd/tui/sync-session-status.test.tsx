/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { mount, wait } from "./sync-fixture"

const sessionID = "ses_status_pause"
const pause = { at: 1, mode: "soft" as const, state: "paused" as const, source: { kind: "api" as const } }

function status(id: string, value: object): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    payload: { id, type: "session.status", properties: { sessionID, status: value } },
  } as GlobalEvent
}

/*
 * 2026-11-15, Portal live check: after unpause the footer still read "paused - /unpause to continue", because the
 * store merged the new status into the old one and kept its `paused`.
 */
test("a status without paused replaces one that had it", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(undefined, tmp.path)
  try {
    emit(status("evt_paused", { type: "idle", paused: pause }))
    await wait(() => sync.data.session_status[sessionID]?.paused !== undefined)
    emit(status("evt_unpaused", { type: "idle" }))
    await wait(() => sync.data.session_status[sessionID]?.paused === undefined)
    expect(sync.data.session_status[sessionID]).toEqual({ type: "idle" })
  } finally {
    app.renderer.destroy()
  }
})
