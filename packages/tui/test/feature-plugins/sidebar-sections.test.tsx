/** @jsxImportSource @opentui/solid */
import type { TuiSidebarLspItem, TuiSidebarMcpItem } from "@opencode-ai/plugin/tui"
import { expect, test } from "bun:test"
import SidebarContext from "../../src/feature-plugins/sidebar/context"
import SidebarFiles from "../../src/feature-plugins/sidebar/files"
import SidebarLsp from "../../src/feature-plugins/sidebar/lsp"
import SidebarMcp from "../../src/feature-plugins/sidebar/mcp"
import SidebarTodo from "../../src/feature-plugins/sidebar/todo"
import type { Info } from "../../src/config"
import { SIDEBAR_ORDER_KEY } from "../../src/plugin/slots"
import { tmpdir } from "../fixture/fixture"
import {
  mountSidebar,
  sidebarAssistantMessage,
  sidebarProvider,
  sidebarSession,
  type SidebarState,
} from "../fixture/sidebar"

// The last assistant message used `tokens` of a model with a `limit` context window.
function usage(tokens: number, limit: number, cost: number): SidebarState {
  return {
    session: {
      get: () => sidebarSession({ cost }),
      messages: () => [
        sidebarAssistantMessage({
          providerID: "fake",
          modelID: "model",
          tokens: { input: tokens - 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ],
      todo: () => [],
    },
    provider: [sidebarProvider({ id: "fake", model: "model", context: limit })],
  }
}

const mcpServers: TuiSidebarMcpItem[] = [
  { name: "alpha", status: "connected" },
  { name: "beta", status: "connected" },
  { name: "gamma", status: "failed", error: "spawn ENOENT" },
  { name: "delta", status: "disabled" },
]

async function context(root: string, config: Info, state = usage(175_019, 1_000_000, 1215.2), width = 40) {
  return mountSidebar({ root, plugins: [SidebarContext], config, state, width })
}

test("compact Context shows the most detailed line that fits the sidebar width", async () => {
  await using tmp = await tmpdir()
  const lines: Record<number, string> = {}
  for (const width of [60, 42, 26]) {
    const view = await context(tmp.path, { sidebar: { context: "compact" } }, undefined, width)
    try {
      expect(view.text()).toHaveLength(1)
      lines[width] = view.text()[0]
    } finally {
      view.destroy()
    }
  }
  expect(lines[60]).toBe("▶ 175,019 tokens · 18% used · $1,215.20 spent")
  expect(lines[42]).toBe("▶ 175,019 · 18% · $1,215.20")
  expect(lines[26]).toBe("▶ 175K · 18% · $1,215")
})

test("clicking the Context header switches between expanded and compact and remembers it", async () => {
  await using tmp = await tmpdir()
  const view = await context(tmp.path, {})
  try {
    expect(view.text()).toEqual(["▼ Context", "175,019 tokens", "18% used", "$1,215.20 spent"])
    await view.click(2, 0)
    expect(view.text()).toEqual(["▶ 175,019 · 18% · $1,215.20"])
    expect(view.kv().get("sidebar_context")).toBe("compact")
    // The values open /status instead; the arrow folds it back.
    await view.click(10, 0)
    expect(view.text()).toEqual(["▶ 175,019 · 18% · $1,215.20"])
    await view.click(0, 0)
    expect(view.text()).toHaveLength(4)
    expect(view.kv().get("sidebar_context")).toBe("expanded")
  } finally {
    view.destroy()
  }
})

test("the sidebar.context.toggle command switches the Context layout", async () => {
  await using tmp = await tmpdir()
  const view = await context(tmp.path, { sidebar: { context: "compact" } })
  try {
    await view.command("sidebar.context.toggle")
    expect(view.text()[0]).toBe("▼ Context")
  } finally {
    view.destroy()
  }
})

test("the compact Context values select as text while its arrow drags the section", async () => {
  await using tmp = await tmpdir()
  const view = await mountSidebar({
    root: tmp.path,
    plugins: [SidebarContext, SidebarMcp],
    config: { sidebar: { context: "compact" } },
    state: { ...usage(175_019, 1_000_000, 1215.2), mcp: () => mcpServers },
  })
  try {
    expect(await view.select(2, 0, 9, 0)).toBe("175,019")
    expect(view.kv().get(SIDEBAR_ORDER_KEY)).toBeUndefined()
    view.app.renderer.clearSelection()
    const mcp = view.lines().findIndex((line) => line.includes("MCP"))
    await view.app.mockMouse.drag(0, 0, 0, mcp)
    expect(view.kv().get(SIDEBAR_ORDER_KEY)).toEqual(["mcp", "context"])
  } finally {
    view.destroy()
  }
})

test("colored context ramps tokens and percent by threshold, cost only past its own thresholds", async () => {
  await using tmp = await tmpdir()
  const cases = [
    { tokens: 50_000, color: "textMuted" },
    { tokens: 65_000, color: "warning" },
    { tokens: 95_000, color: "error" },
  ] as const
  for (const item of cases) {
    const view = await context(
      tmp.path,
      { usage: { context_color: "colored", cost_thresholds: [1] } },
      usage(item.tokens, 100_000, 3.7),
    )
    try {
      expect(view.fg("tokens").equals(view.theme()[item.color])).toBe(true)
      expect(view.fg("% used").equals(view.theme()[item.color])).toBe(true)
      expect(view.fg("$3.70").equals(view.theme().warning)).toBe(true)
    } finally {
      view.destroy()
    }
  }
  const plain = await context(tmp.path, {}, usage(95_000, 100_000, 3.7))
  try {
    expect(plain.fg("tokens").equals(plain.theme().textMuted)).toBe(true)
    expect(plain.fg("$3.70").equals(plain.theme().textMuted)).toBe(true)
  } finally {
    plain.destroy()
  }
})

test("disabled LSP with no servers is one line, every other state keeps heading and content", async () => {
  await using tmp = await tmpdir()
  const render = async (lsp: boolean, servers: TuiSidebarLspItem[]) => {
    const view = await mountSidebar({
      root: tmp.path,
      plugins: [SidebarLsp],
      state: { config: { lsp }, lsp: () => servers },
    })
    try {
      return view.text()
    } finally {
      view.destroy()
    }
  }
  expect(await render(false, [])).toEqual(["LSPs are disabled"])
  expect(await render(true, [])).toEqual(["LSP", "LSPs will activate as files are read"])
  expect(await render(false, [{ id: "typescript", root: "/repo", status: "connected" }])).toEqual([
    "LSP",
    "• typescript /repo",
  ])
})

test("the LSP disabled note selects as text", async () => {
  await using tmp = await tmpdir()
  const view = await mountSidebar({
    root: tmp.path,
    plugins: [SidebarLsp],
    state: { config: { lsp: false }, lsp: () => [] },
  })
  try {
    expect(await view.select(5, 0, 17, 0)).toBe("are disabled")
  } finally {
    view.destroy()
  }
})

async function mcp(root: string, sidebar: Info["sidebar"]) {
  return mountSidebar({ root, plugins: [SidebarMcp], config: { sidebar }, state: { mcp: () => mcpServers } })
}

test("compact MCP rows drop the status text and keep the status dot colors", async () => {
  await using tmp = await tmpdir()
  const descriptive = await mcp(tmp.path, {})
  try {
    expect(descriptive.text()).toContain("• alpha Connected")
    expect(descriptive.text()).toContain("• delta Disabled")
  } finally {
    descriptive.destroy()
  }
  const compact = await mcp(tmp.path, { mcp_list: "compact" })
  try {
    expect(compact.text()).toEqual(["▼ MCP", "• alpha", "• beta", "• gamma", "• delta"])
    expect(compact.fg("• alpha").equals(compact.theme().success)).toBe(true)
    expect(compact.fg("• gamma").equals(compact.theme().error)).toBe(true)
    expect(compact.fg("• delta").equals(compact.theme().textMuted)).toBe(true)
  } finally {
    compact.destroy()
  }
})

test("MCP status counts follow sidebar.mcp_summary while expanded and collapsed", async () => {
  await using tmp = await tmpdir()
  const headings = async (sidebar: Info["sidebar"]) => {
    const view = await mcp(tmp.path, sidebar)
    try {
      const open = view.text()[0]
      await view.click(0, 0)
      return [open, view.text()[0]]
    } finally {
      view.destroy()
    }
  }
  expect(await headings({})).toEqual(["▼ MCP", "▶ MCP (2 active, 1 error)"])
  expect(await headings({ mcp_summary: "collapsed" })).toEqual(["▼ MCP", "▶ MCP •2 •1 •1"])
  expect(await headings({ mcp_summary: "always" })).toEqual(["▼ MCP •2 •1 •1", "▶ MCP •2 •1 •1"])
  expect(await headings({ mcp_summary: "never" })).toEqual(["▼ MCP", "▶ MCP"])
})

test("todo counts follow sidebar.todo_summary on the Todo heading and select as text", async () => {
  await using tmp = await tmpdir()
  const list = ["completed", "in_progress", "pending"].map((status, index) => ({
    content: `Task ${index + 1}`,
    status,
    priority: "medium",
  }))
  const headings = async (sidebar: Info["sidebar"]) => {
    const view = await mountSidebar({
      root: tmp.path,
      plugins: [SidebarTodo],
      config: { sidebar },
      state: { session: { todo: () => list } },
    })
    try {
      const open = view.text()[0]
      const selected = open.length > "▼ Todo".length ? await view.select(7, 0, open.length, 0) : undefined
      view.app.renderer.clearSelection()
      await view.click(0, 0)
      return { open, collapsed: view.text()[0], selected }
    } finally {
      view.destroy()
    }
  }
  expect(await headings({})).toEqual({ open: "▼ Todo", collapsed: "▶ Todo", selected: undefined })
  expect(await headings({ todo_summary: "always" })).toEqual({
    open: "▼ Todo 1+1/3",
    collapsed: "▶ Todo 1+1/3",
    selected: "1+1/3",
  })
  expect(await headings({ todo_summary: "collapsed", todo_summary_style: "icons" })).toEqual({
    open: "▼ Todo",
    collapsed: "▶ Todo ✓1 •1 ○1",
    selected: undefined,
  })
})

test("clicking a Modified Files row opens the diff viewer at that file, and a drag does not", async () => {
  await using tmp = await tmpdir()
  const opened: unknown[] = []
  const view = await mountSidebar({
    root: tmp.path,
    plugins: [SidebarFiles],
    state: {
      session: {
        diff: () => [
          { file: "src/a.ts", additions: 2, deletions: 1, status: "modified" },
          { file: "src/b.ts", additions: 4, deletions: 0, status: "modified" },
        ],
      },
    },
    route: {
      register: () => () => {},
      navigate: (name, params) => void opened.push({ name, params }),
      current: { name: "session", params: { sessionID: "ses_test" } },
    },
  })
  try {
    const row = view.text().findIndex((line) => line.includes("src/b.ts"))
    expect(await view.select(0, row, 6, row)).toBe("src/b.")
    expect(opened).toEqual([])
    view.app.renderer.clearSelection()
    await view.click(2, row)
    expect(opened).toEqual([
      {
        name: "diff",
        params: {
          mode: "git",
          sessionID: "ses_test",
          returnRoute: { name: "session", params: { sessionID: "ses_test" } },
          file: "src/b.ts",
        },
      },
    ])
  } finally {
    view.destroy()
  }
})
