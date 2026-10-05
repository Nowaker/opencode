/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createSlot, createSolidSlotRegistry, testRender, useRenderer } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { onMount } from "solid-js"
import { type TuiConfig, TuiConfigProvider } from "../../src/config"
import { onHeaderClick } from "../../src/feature-plugins/sidebar/click"
import SidebarMcp from "../../src/feature-plugins/sidebar/mcp"
import {
  createSlots,
  moveSidebarSection,
  placeSidebarSection,
  SIDEBAR_ORDER_KEY,
  sidebarSectionName,
} from "../../src/plugin/slots"
import { createTuiPluginApi } from "../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

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

// Two sections shaped like the built-in ones: an unselectable name with selectable data after
// it, then a row whose gap after the bullet is not text.
//   y0 "Context 12 tokens", y1 "• row", y3 "MCP •3", y4 "• row"
async function renderDraggableSidebar() {
  const slots = createSlots()
  const base = createTuiPluginApi()
  const section = (title: string, data: string) => () => (
    <box>
      <box flexDirection="row" gap={1}>
        <text selectable={false}>{title}</text>
        <text>{data}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text>•</text>
        <text>row</text>
      </box>
    </box>
  )
  const App = () => {
    const host = slots.setup({ ...base, renderer: useRenderer() } satisfies TuiPluginApi)
    host.register({
      id: "internal:sidebar-context",
      order: 100,
      slots: { sidebar_content: section("Context", "12 tokens") },
    })
    host.register({ id: "internal:sidebar-mcp", order: 200, slots: { sidebar_content: section("MCP", "•3") } })
    return (
      <box gap={1}>
        <slots.Slot name="sidebar_content" session_id="ses_test" />
      </box>
    )
  }
  const app = await testRender(() => <App />, { width: 30, height: 8 })
  await app.renderOnce()
  return { app, order: () => base.kv.get(SIDEBAR_ORDER_KEY) }
}

test("a section drags by its header", async () => {
  const sidebar = await renderDraggableSidebar()
  try {
    await sidebar.app.mockMouse.drag(0, 3, 0, 0)
    expect(sidebar.order()).toEqual(["mcp", "context"])
  } finally {
    sidebar.app.renderer.destroy()
  }
})

test("a drag that starts below a section's header never moves the section", async () => {
  const sidebar = await renderDraggableSidebar()
  try {
    await sidebar.app.mockMouse.drag(1, 4, 1, 0)
    expect(sidebar.order()).toBeUndefined()
  } finally {
    sidebar.app.renderer.destroy()
  }
})

test("text after a section name selects instead of dragging the section", async () => {
  const sidebar = await renderDraggableSidebar()
  try {
    await sidebar.app.mockMouse.drag(4, 3, 6, 3)
    expect(sidebar.app.renderer.getSelection()?.getSelectedText()).toBe("•3")
    expect(sidebar.order()).toBeUndefined()
  } finally {
    sidebar.app.renderer.destroy()
  }
})

async function renderMcpSection(sidebar: TuiConfig.Sidebar) {
  const slots = createSlots()
  const base = createTuiPluginApi()
  const servers = ["a", "b", "c"].map((name) => ({ name, status: "failed" as const, error: "boom" }))
  const App = () => {
    const hostApi = { ...base, renderer: useRenderer() } satisfies TuiPluginApi
    const host = slots.setup(hostApi)
    const api = {
      ...hostApi,
      state: { ...base.state, mcp: () => servers },
      slots: {
        register(plugin: TuiSlotPlugin) {
          host.register({ ...plugin, id: "internal:sidebar-mcp" })
          return "internal:sidebar-mcp"
        },
      },
    } satisfies TuiPluginApi
    void SidebarMcp.tui(api, undefined, mcpMeta)
    return (
      <TuiConfigProvider config={createTuiResolvedConfig({ sidebar })}>
        <slots.Slot name="sidebar_content" session_id="ses_test" />
      </TuiConfigProvider>
    )
  }
  const app = await testRender(() => <App />, { width: 40, height: 10 })
  await app.renderOnce()
  return { app, heading: () => app.captureCharFrame().split("\n")[0].trim() }
}

test("the collapsed MCP summary selects as text and still toggles on click", async () => {
  const mcp = await renderMcpSection({})
  try {
    await mcp.app.mockMouse.click(0, 0)
    await mcp.app.renderOnce()
    expect(mcp.heading()).toBe("▶ MCP (0 active, 3 errors)")
    await mcp.app.mockMouse.drag(6, 0, 15, 0)
    expect(mcp.app.renderer.getSelection()?.getSelectedText()).toBe("(0 active")
    mcp.app.renderer.clearSelection()
    await mcp.app.mockMouse.click(8, 0)
    await mcp.app.renderOnce()
    expect(mcp.heading()).toBe("▼ MCP")
  } finally {
    mcp.app.renderer.destroy()
  }
})

test("the MCP status counts after the heading select as text", async () => {
  const mcp = await renderMcpSection({ mcp_summary: "always" })
  try {
    expect(mcp.heading()).toBe("▼ MCP •3")
    await mcp.app.mockMouse.drag(6, 0, 8, 0)
    expect(mcp.app.renderer.getSelection()?.getSelectedText()).toBe("•3")
  } finally {
    mcp.app.renderer.destroy()
  }
})

const mcpMeta = {
  id: "internal:sidebar-mcp",
  source: "internal",
  spec: "internal:sidebar-mcp",
  target: "internal:sidebar-mcp",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta

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
