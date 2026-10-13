import { expect, test } from "bun:test"
import {
  sidebarShowsSessionID,
  sidebarTitlePinned,
  toggleSidebarSessionID,
  toggleSidebarTitlePin,
} from "../../../src/routes/session/sidebar"
import { TuiLayout } from "../../../src/layout"

function store(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    set: (key: string, value: unknown) => void values.set(key, value),
    values,
  }
}

test("/pin-title is remembered in kv.json while tui.json leaves sidebar.pin_title unset", () => {
  const kv = store()
  expect(sidebarTitlePinned({}, kv)).toBe(false)
  expect(toggleSidebarTitlePin({}, kv)).toBeUndefined()
  expect(kv.values.get("sidebar_pin_title")).toBe(true)
  expect(sidebarTitlePinned({}, kv)).toBe(true)
})

test("sidebar.pin_title in tui.json beats a remembered /pin-title, which then lasts until exit", () => {
  const config = { sidebar: { pin_title: true } }
  const kv = store({ sidebar_pin_title: false })
  expect(sidebarTitlePinned(config, kv)).toBe(true)
  expect(toggleSidebarTitlePin(config, kv)).toContain("until opencode exits")
  expect(sidebarTitlePinned(config, kv)).toBe(false)
  expect(kv.values.get("sidebar_pin_title")).toBe(false)
  // Toggling back to what tui.json says clears the override.
  expect(toggleSidebarTitlePin(config, kv)).toBeUndefined()
  expect(sidebarTitlePinned({ sidebar: { pin_title: false } }, kv)).toBe(false)
})

test("sidebar.session_id in tui.json beats a remembered /session-id, which then lasts until exit", () => {
  const config = { sidebar: { session_id: false } }
  const kv = store({ sidebar_session_id: true })
  expect(sidebarShowsSessionID(config, kv)).toBe(false)
  expect(toggleSidebarSessionID(config, kv)).toContain("until opencode exits")
  expect(sidebarShowsSessionID(config, kv)).toBe(true)
  expect(kv.values.get("sidebar_session_id")).toBe(true)
  expect(toggleSidebarSessionID(config, kv)).toBeUndefined()
  expect(sidebarShowsSessionID(config, kv)).toBe(false)
})

test("/session-id is remembered in kv.json while tui.json leaves sidebar.session_id unset", () => {
  const kv = store({ sidebar_session_id: true })
  expect(sidebarShowsSessionID({}, kv)).toBe(true)
  expect(toggleSidebarSessionID({}, kv)).toBeUndefined()
  expect(kv.values.get("sidebar_session_id")).toBe(false)
})

test("the instant session screen reads the session ID line the same way", () => {
  expect(TuiLayout.sidebarShowsSessionId({ kv: true, configured: false, channel: "dev" })).toBe(false)
  expect(TuiLayout.sidebarShowsSessionId({ kv: true, channel: "latest" })).toBe(true)
  expect(TuiLayout.sidebarShowsSessionId({ channel: "latest" })).toBe(false)
  expect(TuiLayout.sidebarShowsSessionId({ channel: "dev" })).toBe(true)
})
