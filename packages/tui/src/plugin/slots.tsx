import type { TuiPluginApi, TuiSlotContext, TuiSlotMap, TuiSlotProps } from "@opencode-ai/plugin/tui"
import type { PluginContext } from "@opentui/core"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { children, createEffect, createRoot, createSignal } from "solid-js"
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

// Listed sections sort before every unlisted one, which keep their default order;
// that way a section added later is never lost.
export function sidebarSectionOrder(
  name: string,
  id: string,
  order: readonly string[] | undefined,
  fallback: number | undefined,
) {
  const index = order?.findIndex((entry) => entry === name || entry === id) ?? -1
  return index === -1 ? fallback : Number.MIN_SAFE_INTEGER + index
}

type SidebarRenderer<Slots extends Record<string, object>, Context extends PluginContext> = NonNullable<
  SolidPlugin<Slots, Context>["slots"]["sidebar_content"]
>

/*
 * Applies `sidebar.order` / `sidebar.hidden` to one slot registration. Order belongs to
 * a whole registration, so its `sidebar_content` moves into a registration of its own
 * and its other slots keep their place.
 */
export function placeSidebarSection<
  Slots extends Record<string, object> & { sidebar_content: object },
  Context extends PluginContext,
>(
  plugin: SolidPlugin<Slots, Context>,
  sidebar: TuiConfig.Sidebar | undefined,
  wrap?: (name: string, content: SidebarRenderer<Slots, Context>) => SidebarRenderer<Slots, Context>,
): SolidPlugin<Slots, Context>[] {
  const content = plugin.slots.sidebar_content
  if (!content || (!wrap && !sidebar?.order?.length && !sidebar?.hidden?.length)) return [plugin]
  const name = sidebarSectionName(plugin.id)
  const host = { ...plugin, slots: { ...plugin.slots, sidebar_content: undefined } }
  if (sidebar?.hidden?.some((entry) => entry === name || entry === plugin.id)) return [host]
  return [
    host,
    {
      id: `${plugin.id}:sidebar`,
      order: sidebarSectionOrder(name, plugin.id, sidebar?.order, plugin.order),
      slots: { sidebar_content: wrap ? wrap(name, content) : content },
    },
  ]
}

export const SIDEBAR_ORDER_KEY = "sidebar_order"

export function moveSidebarSection(names: readonly string[], from: string, to: string) {
  const next = names.filter((name) => name !== from)
  next.splice(names.indexOf(to), 0, from)
  return next
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

      // A drag-and-drop order is saved in kv and wins over `sidebar.order` until reset.
      const sections = new Map<string, { name: string; pluginID: string; fallback?: number }>()
      const savedOrder = () => {
        const saved: unknown = api.kv.get(SIDEBAR_ORDER_KEY)
        if (!Array.isArray(saved)) return sidebar?.order
        return saved.filter((item): item is string => typeof item === "string")
      }
      const rank = (section: { name: string; pluginID: string; fallback?: number }, order = savedOrder()) =>
        sidebarSectionOrder(section.name, section.pluginID, order, section.fallback) ?? 0
      const disposeOrder = createRoot((dispose) => {
        createEffect(() => {
          const order = savedOrder()
          sections.forEach((section, id) => registry.updateOrder(id, rank(section, order)))
        })
        return dispose
      })

      const [dragging, setDragging] = createSignal<string>()
      const [over, setOver] = createSignal<string>()
      let pressed: string | undefined
      const move = (from: string, to: string) => {
        const names = [...sections.values()].toSorted((a, b) => rank(a) - rank(b)).map((section) => section.name)
        api.kv.set(SIDEBAR_ORDER_KEY, moveSidebarSection(names, from, to))
      }

      const release = () =>
        queueMicrotask(() => {
          pressed = undefined
          setDragging(undefined)
        })

      /*
       * The press is remembered on mouse down because opentui captures whatever is under the
       * pointer at the first drag event, which can be a gap between sections or another one.
       * Drag events then go to that capture only, so a drag is recognized from the `over`
       * events (they carry `source` while a capture drag is in progress). A drag that started
       * on selectable text is a text selection, which sends neither, and never reorders.
       */
      const wrap = (name: string, content: SidebarRenderer<RuntimeSlotMap, TuiSlotContext>) =>
        ((ctx, props) => {
          const resolved = children(() => content(ctx, props))
          return (
            <box
              visible={resolved.toArray().some((item) => item !== null && item !== undefined && item !== false)}
              backgroundColor={
                dragging() !== undefined && dragging() !== name && over() === name
                  ? api.theme.current.backgroundElement
                  : undefined
              }
              onMouseDown={() => (pressed = name)}
              onMouseDrag={(event) => {
                if (!event.isDragging && pressed) setDragging(pressed)
              }}
              onMouseOver={(event) => {
                setOver(name)
                if (event.source && pressed) setDragging(pressed)
              }}
              onMouseOut={() => setOver(undefined)}
              onMouseUp={release}
              onMouseDragEnd={release}
              onMouseDrop={() => {
                const from = dragging()
                release()
                if (from && from !== name) move(from, name)
              }}
            >
              {resolved()}
            </box>
          )
        }) satisfies SidebarRenderer<RuntimeSlotMap, TuiSlotContext>

      return {
        register(plugin: HostSlotPlugin) {
          if (!isHostSlotPlugin(plugin)) return () => {}
          const items = placeSidebarSection(plugin, { order: savedOrder(), hidden: sidebar?.hidden }, wrap)
          const disposers = items.map((item) => {
            const dispose = registry.register(item)
            if (!item.slots.sidebar_content) return dispose
            sections.set(item.id, { name: sidebarSectionName(plugin.id), pluginID: plugin.id, fallback: plugin.order })
            return () => {
              sections.delete(item.id)
              dispose()
            }
          })
          return () => disposers.forEach((dispose) => dispose())
        },
        dispose() {
          disposeOrder()
          setView(() => empty)
        },
      }
    },
    clear() {
      setView(() => empty)
    },
  }
}
