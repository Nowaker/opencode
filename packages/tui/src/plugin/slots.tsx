import type { TuiPluginApi, TuiSlotContext, TuiSlotMap, TuiSlotProps } from "@opencode-ai/plugin/tui"
import type { PluginContext } from "@opentui/core"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { TuiConfig } from "../config"
import { isRecord } from "../util/record"

type RuntimeSlotMap = TuiSlotMap<Record<string, object>>
type SlotView = <Name extends string>(props: TuiSlotProps<Name>) => JSX.Element | null

export type HostSlotPlugin<Slots extends Record<string, object> = {}> = SolidPlugin<TuiSlotMap<Slots>, TuiSlotContext>
export type HostPluginApi = TuiPluginApi
export type HostSlots = {
  register: {
    (plugin: HostSlotPlugin): () => void
    <Slots extends Record<string, object>>(plugin: HostSlotPlugin<Slots>): () => void
  }
  dispose: () => void
}

function isHostSlotPlugin(value: unknown): value is HostSlotPlugin<Record<string, object>> {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  return isRecord(value.slots)
}

const BUILTIN_SIDEBAR_PREFIX = "internal:sidebar-"

// Built-in sections are addressed by their short name ("mcp"), plugin sections by
// the id their slot registration received ("my-plugin", "my-plugin:1").
export function sidebarSectionName(id: string) {
  return id.startsWith(BUILTIN_SIDEBAR_PREFIX) ? id.slice(BUILTIN_SIDEBAR_PREFIX.length) : id
}

/*
 * Applies `sidebar.order` / `sidebar.hidden` to one slot registration. Order belongs to
 * a whole registration, so its `sidebar_content` moves into a registration of its own
 * and its other slots keep their place. Listed sections sort before every unlisted one,
 * which keep their default order; that way a section added later is never lost.
 */
export function placeSidebarSection<
  Slots extends Record<string, object> & { sidebar_content: object },
  Context extends PluginContext,
>(plugin: SolidPlugin<Slots, Context>, sidebar: TuiConfig.Sidebar | undefined): SolidPlugin<Slots, Context>[] {
  const content = plugin.slots.sidebar_content
  if (!content || (!sidebar?.order?.length && !sidebar?.hidden?.length)) return [plugin]
  const name = sidebarSectionName(plugin.id)
  const matches = (entry: string) => entry === name || entry === plugin.id
  const host = { ...plugin, slots: { ...plugin.slots, sidebar_content: undefined } }
  if (sidebar.hidden?.some(matches)) return [host]
  const index = sidebar.order?.findIndex(matches) ?? -1
  return [
    host,
    {
      id: `${plugin.id}:sidebar`,
      order: index === -1 ? plugin.order : Number.MIN_SAFE_INTEGER + index,
      slots: { sidebar_content: content },
    },
  ]
}

export function createSlots() {
  const empty: SlotView = () => null
  const [view, setView] = createSignal<SlotView>(empty)
  const Slot: SlotView = (props) => view()(props)

  return {
    Slot,
    setup(api: HostPluginApi, sidebar?: TuiConfig.Sidebar): HostSlots {
      const registry = createSolidSlotRegistry<RuntimeSlotMap, TuiSlotContext>(
        api.renderer,
        { theme: api.theme },
        {
          onPluginError(event) {
            console.error("[tui.slot] plugin error", {
              plugin: event.pluginId,
              slot: event.slot,
              phase: event.phase,
              source: event.source,
              message: event.error.message,
            })
          },
        },
      )
      const slot = createSlot<RuntimeSlotMap, TuiSlotContext>(registry)
      setView(() => (props: TuiSlotProps<string>) => slot(props))

      return {
        register(plugin: HostSlotPlugin) {
          if (!isHostSlotPlugin(plugin)) return () => {}
          const disposers = placeSidebarSection(plugin, sidebar).map((item) => registry.register(item))
          return () => disposers.forEach((dispose) => dispose())
        },
        dispose() {
          setView(() => empty)
        },
      }
    },
    clear() {
      setView(() => empty)
    },
  }
}
