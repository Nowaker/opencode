/** @jsxImportSource @opentui/solid */
import type { TuiKV, TuiPluginApi, TuiPluginMeta, TuiSlotPlugin, TuiState, TuiTheme } from "@opencode-ai/plugin/tui"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { BuiltinTuiPlugin } from "../../src/feature-plugins/builtins"
import { KVProvider, useKV } from "../../src/context/kv"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { type Info, TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, useOpencodeKeymap } from "../../src/keymap"
import { createSlots, type HostSlots } from "../../src/plugin/slots"
import { TestTuiContexts } from "./tui-environment"
import { createTuiPluginApi } from "./tui-plugin"
import { createTuiResolvedConfig } from "./tui-runtime"
export { sidebarSession, sidebarAssistantMessage, sidebarProvider } from "./sidebar-data"

/* The parts of `api.state` a test replaces; everything else keeps an empty default. */
export type SidebarState = Partial<Omit<TuiState, "session">> & { session?: Partial<TuiState["session"]> }

type Contexts = {
  kv: ReturnType<typeof useKV>
  theme: ReturnType<typeof useTheme>
  keymap: ReturnType<typeof useOpencodeKeymap>
}

/*
 * Mounts built-in sidebar sections through the real slot host (section wrapper, drag
 * handle, order), the real KV store and theme, and the real keymap provider, as the
 * session sidebar does. `state` replaces the parts of `api.state` the sections read.
 */
export async function mountSidebar(input: {
  root: string
  plugins: BuiltinTuiPlugin[]
  config?: Info
  state?: SidebarState
  route?: TuiPluginApi["route"]
  width?: number
  height?: number
}) {
  const statePath = path.join(input.root, "state")
  await mkdir(statePath, { recursive: true })
  await Bun.write(path.join(statePath, "kv.json"), "{}")
  const config = createTuiResolvedConfig(input.config ?? {})
  let mounted: Contexts | undefined

  function Sections() {
    const contexts = { kv: useKV(), theme: useTheme(), keymap: useOpencodeKeymap() }
    mounted = contexts
    const api: TuiPluginApi = {
      ...createTuiPluginApi(),
      keymap: contexts.keymap,
      ...(input.route ? { route: input.route } : {}),
      renderer: useRenderer(),
      tuiConfig: config,
      kv: pluginKV(contexts.kv),
      theme: pluginTheme(contexts.theme),
      state: sidebarState(
        { state: statePath, config: statePath, worktree: input.root, directory: input.root },
        input.state,
      ),
    }
    const slots = createSlots()
    const host = slots.setup(api, config.sidebar)
    for (const plugin of input.plugins) void plugin.tui(withSlots(api, host, plugin.id), undefined, meta(plugin.id))
    return (
      <box gap={1}>
        <slots.Slot name="sidebar_content" session_id="ses_test" />
      </box>
    )
  }

  function Harness() {
    return (
      <TestTuiContexts directory={input.root} paths={{ home: input.root, state: statePath, worktree: input.root }}>
        <OpencodeKeymapProvider keymap={createDefaultOpenTuiKeymap(useRenderer())}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <Sections />
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: input.width ?? 40, height: input.height ?? 12 })
  // KV and the theme load asynchronously; sections render once both are ready.
  const contexts = await ready(() => mounted)
  await app.renderOnce()
  await app.renderOnce()

  const lines = () => app.captureCharFrame().split("\n")
  return {
    app,
    kv: () => contexts.kv,
    theme: () => contexts.theme.theme,
    lines,
    text: () =>
      lines()
        .map((line) => line.trimEnd())
        .filter(Boolean),
    // Runs a command the way the command palette does.
    async command(name: string) {
      const result = contexts.keymap.dispatchCommand(name)
      if (!result.ok) throw new Error(`command "${name}" did not run: ${result.reason}`)
      await app.renderOnce()
    },
    // The foreground of the cells holding `needle` on the first line that contains it.
    fg(needle: string) {
      const frame = app.captureSpans()
      const row = lines().findIndex((line) => line.includes(needle))
      if (row === -1) throw new Error(`"${needle}" is not on screen`)
      const start = lines()[row].indexOf(needle)
      let column = 0
      for (const span of frame.lines[row].spans) {
        if (column + span.width > start) return span.fg
        column += span.width
      }
      throw new Error(`no span at "${needle}"`)
    },
    async select(x1: number, y1: number, x2: number, y2: number) {
      await app.mockMouse.drag(x1, y1, x2, y2)
      return app.renderer.getSelection()?.getSelectedText()
    },
    async click(x: number, y: number) {
      await app.mockMouse.click(x, y)
      await app.renderOnce()
    },
    destroy: () => app.renderer.destroy(),
  }
}

async function ready(read: () => Contexts | undefined) {
  const start = Date.now()
  for (;;) {
    const contexts = read()
    if (contexts?.kv.ready && contexts.theme.ready) return contexts
    if (Date.now() - start > 5000) throw new Error("KV and theme never became ready")
    await Bun.sleep(10)
  }
}

function pluginKV(kv: Contexts["kv"]): TuiKV {
  return {
    get: (key, fallback) => kv.get(key, fallback),
    set: (key, value) => kv.set(key, value),
    get ready() {
      return kv.ready
    },
  }
}

function pluginTheme(theme: Contexts["theme"]): TuiTheme {
  return {
    get current() {
      return theme.theme
    },
    get selected() {
      return theme.selected
    },
    has: (name) => theme.has(name),
    set: (name) => theme.set(name),
    async install() {
      throw new Error("theme.install is not available in the sidebar fixture")
    },
    mode: () => theme.mode(),
    get ready() {
      return theme.ready
    },
  }
}

function sidebarState(paths: TuiState["path"], overrides: SidebarState = {}): TuiState {
  const { session, ...rest } = overrides
  return {
    ready: true,
    config: {},
    provider: [],
    path: paths,
    vcs: undefined,
    part: () => [],
    lsp: () => [],
    mcp: () => [],
    ...rest,
    session: {
      count: () => 0,
      get: () => undefined,
      diff: () => [],
      todo: () => [],
      messages: () => [],
      status: () => undefined,
      permission: () => [],
      question: () => [],
      ...session,
    },
  }
}

// Each plugin registers its slots under its own id, as the plugin runtime does.
function withSlots(api: TuiPluginApi, host: HostSlots, id: string): TuiPluginApi {
  function register(plugin: TuiSlotPlugin): string
  function register<Slots extends Record<string, object>>(plugin: TuiSlotPlugin<Slots>): string
  function register<Slots extends Record<string, object>>(plugin: TuiSlotPlugin<Slots>) {
    host.register({ ...plugin, id })
    return id
  }
  return { ...api, slots: { register } }
}

function meta(id: string) {
  return {
    id,
    source: "internal",
    spec: id,
    target: id,
    first_time: 0,
    last_time: 0,
    time_changed: 0,
    load_count: 1,
    fingerprint: "test",
    state: "same",
  } satisfies TuiPluginMeta
}
