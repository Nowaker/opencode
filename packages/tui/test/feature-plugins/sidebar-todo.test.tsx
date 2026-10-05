/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiPluginApi } from "../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import type { Info } from "../../src/config"

type Todo = { content: string; status: string; priority: string }

const todos = (...statuses: string[]) =>
  statuses.map((status, index) => ({ content: `Task ${index + 1}`, status, priority: "medium" }))

async function mountTodo(root: string, sidebar: Info["sidebar"]) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [{ default: plugin }, { KVProvider }, { ThemeProvider }, { TuiConfigProvider }] = await Promise.all([
    import("../../src/feature-plugins/sidebar/todo"),
    import("../../src/context/kv"),
    import("../../src/context/theme"),
    import("../../src/config"),
  ])

  const [store, setStore] = createStore<{ list: Todo[] }>({ list: [] })
  let slot: ((ctx: unknown, props: { session_id: string }) => JSX.Element) | undefined
  const api = createTuiPluginApi({ state: { session: { todo: () => store.list } as never } })
  Object.assign(api, {
    slots: {
      register(input: TuiSlotPlugin) {
        slot = input.slots.sidebar_content as typeof slot
        return "sidebar-todo"
      },
    },
  })
  await plugin.tui(api as TuiPluginApi, undefined, undefined as never)
  if (!slot) throw new Error("sidebar_content slot was not registered")
  const render = slot

  const app = await testRender(
    () => (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <TuiConfigProvider config={createTuiResolvedConfig({ sidebar })}>
          <KVProvider>
            <ThemeProvider mode="dark">{render({}, { session_id: "ses_test" })}</ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 12 },
  )

  // KV and the theme load asynchronously and render nothing until ready.
  setStore("list", todos("pending"))
  const start = Date.now()
  while (true) {
    await app.renderOnce()
    if (app.captureCharFrame().includes("Todo")) break
    if (Date.now() - start > 5000) throw new Error("sidebar todo never rendered")
    await Bun.sleep(10)
  }

  return {
    async frame(list: Todo[]) {
      setStore("list", list)
      await app.renderOnce()
      return app.captureCharFrame()
    },
    cleanup: () => app.renderer.destroy(),
  }
}

test("hides an all-completed list by default", async () => {
  await using tmp = await tmpdir()
  const view = await mountTodo(tmp.path, undefined)
  try {
    expect(await view.frame(todos("completed", "in_progress", "pending"))).toContain("Task 2")
    expect(await view.frame(todos("completed", "completed", "completed"))).not.toContain("Todo")
  } finally {
    view.cleanup()
  }
})

test("show keeps an all-completed list open", async () => {
  await using tmp = await tmpdir()
  const view = await mountTodo(tmp.path, { todo_completed: "show" })
  try {
    const frame = await view.frame(todos("completed", "completed", "completed"))
    expect(frame).toContain("▼ Todo")
    expect(frame).toContain("Task 3")
  } finally {
    view.cleanup()
  }
})

test("collapsed folds the list when it completes and unfolds it for new work", async () => {
  await using tmp = await tmpdir()
  const view = await mountTodo(tmp.path, { todo_completed: "collapsed" })
  try {
    expect(await view.frame(todos("completed", "in_progress", "pending"))).toContain("Task 2")
    const done = await view.frame(todos("completed", "completed", "completed"))
    expect(done).toContain("▶ Todo")
    expect(done).not.toContain("Task 1")
    expect(await view.frame(todos("in_progress", "pending", "pending"))).toContain("Task 3")
  } finally {
    view.cleanup()
  }
})

test("collapsed still lists a completed list of two items, which never collapses", async () => {
  await using tmp = await tmpdir()
  const view = await mountTodo(tmp.path, { todo_completed: "collapsed" })
  try {
    expect(await view.frame(todos("completed", "completed"))).toContain("Task 2")
  } finally {
    view.cleanup()
  }
})
