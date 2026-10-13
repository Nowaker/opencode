import { expect, test } from "bun:test"
import { sidebarTitlePinned, toggleSidebarTitlePin } from "../../../src/routes/session/sidebar"

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
