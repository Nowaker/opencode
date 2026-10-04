/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createSlot, createSolidSlotRegistry, testRender, useRenderer } from "@opentui/solid"
import { onMount } from "solid-js"
import type { TuiConfig } from "../../src/config"
import { onHeaderClick } from "../../src/feature-plugins/sidebar/click"
import { moveSidebarSection, placeSidebarSection, sidebarSectionName } from "../../src/plugin/slots"

type Slots = {
  prompt: {}
}

test("replace slot mounts plugin content once", async () => {
  let mounts = 0

  const Probe = () => {
    onMount(() => {
      mounts += 1
    })
    return <box />
  }

  const App = () => {
    const registry = createSolidSlotRegistry<Slots>(useRenderer(), {})
    const Slot = createSlot(registry)
    registry.register({ id: "plugin", slots: { prompt: () => <Probe /> } })

    return (
      <Slot name="prompt" mode="replace">
        <box />
      </Slot>
    )
  }

  const app = await testRender(() => <App />)
  try {
    expect(mounts).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

type SidebarSlots = {
  sidebar_content: {}
  sidebar_footer: {}
}

async function renderSidebar(sidebar: TuiConfig.Sidebar | undefined) {
  const section = (id: string, order: number, label: string, footer?: string) => ({
    id,
    order,
    slots: {
      sidebar_content: () => <text>{label}</text>,
      ...(footer ? { sidebar_footer: () => <text>{footer}</text> } : {}),
    },
  })
  const App = () => {
    const registry = createSolidSlotRegistry<SidebarSlots>(useRenderer(), {})
    const Slot = createSlot(registry)
    for (const plugin of [
      section("internal:sidebar-context", 100, "Context", "Footer-context"),
      section("internal:sidebar-mcp", 200, "MCP"),
      section("internal:sidebar-lsp", 300, "LSP"),
      section("my-plugin", 50, "Plugin", "Footer-plugin"),
    ]) {
      placeSidebarSection(plugin, sidebar).forEach((item) => registry.register(item))
    }
    return (
      <box>
        <Slot name="sidebar_content" />
        <Slot name="sidebar_footer" />
      </box>
    )
  }
  const app = await testRender(() => <App />, { width: 30, height: 10 })
  await app.renderOnce()
  const lines = app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  app.renderer.destroy()
  return lines
}

test("sidebar sections keep their default order without config", async () => {
  expect(await renderSidebar(undefined)).toEqual(["Plugin", "Context", "MCP", "LSP", "Footer-plugin", "Footer-context"])
})

test("sidebar.order puts listed sections first and keeps unlisted ones in default order", async () => {
  expect(await renderSidebar({ order: ["lsp", "context"] })).toEqual([
    "LSP",
    "Context",
    "Plugin",
    "MCP",
    "Footer-plugin",
    "Footer-context",
  ])
})

test("sidebar.hidden removes a section by name or plugin id but keeps its other slots", async () => {
  expect(await renderSidebar({ order: ["mcp"], hidden: ["context", "my-plugin"] })).toEqual([
    "MCP",
    "LSP",
    "Footer-plugin",
    "Footer-context",
  ])
})

test("dragging a section moves it to the drop target's place", () => {
  const names = ["context", "mcp", "lsp", "todo"]
  expect(moveSidebarSection(names, "context", "lsp")).toEqual(["mcp", "lsp", "context", "todo"])
  expect(moveSidebarSection(names, "todo", "mcp")).toEqual(["context", "todo", "mcp", "lsp"])
  expect(moveSidebarSection(names, "mcp", "mcp")).toEqual(names)
})

test("a section header toggles on click but not after a drag or a drop", () => {
  let toggles = 0
  const header = onHeaderClick(() => toggles++)
  header.onMouseDown({ x: 3, y: 10 })
  header.onMouseUp({ x: 3, y: 10 })
  expect(toggles).toBe(1)
  header.onMouseDown({ x: 3, y: 10 })
  header.onMouseUp({ x: 3, y: 5 })
  expect(toggles).toBe(1)
  header.onMouseUp({ x: 3, y: 10 })
  expect(toggles).toBe(1)
})

test("built-in sections are named without the internal prefix", () => {
  expect(sidebarSectionName("internal:sidebar-files")).toBe("files")
  expect(sidebarSectionName("my-plugin:1")).toBe("my-plugin:1")
})
