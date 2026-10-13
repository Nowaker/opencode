import { expect, test } from "bun:test"
import { sidebarShowsSessionID, toggleSidebarSessionID } from "../../../src/routes/session/sidebar"

function store(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    set: (key: string, value: unknown) => void values.set(key, value),
    values,
  }
}

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
