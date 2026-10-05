export * as TuiConfig from "."

import { createBindingLookup } from "@opentui/keymap/extras"
import { Schema } from "effect"
import { createContext, type JSX, useContext } from "solid-js"
import { TuiKeybind } from "./keybind"

export const AttentionSoundName = Schema.Literals([
  "default",
  "question",
  "permission",
  "error",
  "done",
  "subagent_done",
])
export type AttentionSoundName = Schema.Schema.Type<typeof AttentionSoundName>

export const PluginOptions = Schema.Record(Schema.String, Schema.Unknown)
export const PluginSpec = Schema.Union([Schema.String, Schema.mutable(Schema.Tuple([Schema.String, PluginOptions]))])

export const LeaderTimeoutDefault = 2000
export const LeaderTimeout = Schema.Int.check(Schema.isGreaterThan(0)).annotate({
  description: "Leader key timeout in milliseconds",
})

export const ScrollSpeed = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0.001))
export const ScrollAcceleration = Schema.Struct({
  enabled: Schema.Boolean.annotate({ description: "Enable scroll acceleration" }),
}).annotate({ description: "Scroll acceleration settings" })
export const DiffStyle = Schema.Literals(["auto", "stacked"]).annotate({
  description: "Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column",
})
export const Cursor = Schema.Struct({
  style: Schema.optional(Schema.Literals(["block", "underline", "line", "default"])).annotate({
    description: "Cursor shape. Use 'default' to preserve the terminal setting",
  }),
  blinking: Schema.optional(Schema.Boolean).annotate({
    description: "Whether the cursor blinks. Has no effect when style is 'default'",
  }),
}).annotate({ description: "Terminal cursor settings" })
export const TurnTiming = Schema.Struct({
  time: Schema.optional(Schema.Boolean).annotate({
    description:
      "Show when each assistant turn finished: the time of day if today, the date and time otherwise (default: false)",
  }),
  duration: Schema.optional(Schema.Boolean).annotate({
    description:
      "Show how long each assistant turn took; the final turn also keeps the total since the prompt (default: false)",
  }),
}).annotate({
  description: "Default per-turn timing in assistant message footers; toggle at runtime from the command palette",
})

export const SidebarContext = Schema.Literals(["expanded", "compact"]).annotate({
  description:
    "Sidebar context display: 'expanded' shows one value per line, 'compact' fits them on one line sized to the sidebar width",
})
export const SidebarMcpSummary = Schema.Literals(["default", "collapsed", "never", "always"]).annotate({
  description:
    "MCP header summary: 'default' shows the active and error counts while collapsed, 'collapsed' shows a colored dot and count per status while collapsed, 'always' shows them in both states, 'never' shows nothing",
})
export const SidebarMcpList = Schema.Literals(["descriptive", "compact"]).annotate({
  description:
    "Sidebar MCP server rows: 'descriptive' shows the status dot, name and status text, 'compact' shows the status dot and name only",
})
export const SidebarTodoSummary = Schema.Literals(["never", "collapsed", "always"]).annotate({
  description:
    "When to show todo counts after the sidebar Todo heading: 'never' (default), 'collapsed' only while the list is collapsed, or 'always'",
})
export const SidebarTodoSummaryStyle = Schema.Literals(["progress", "icons"]).annotate({
  description: "Todo summary format: 'progress' is done+in_progress/total (10+1/12), 'icons' is ✓10 •1 ○1",
})
export const Sidebar = Schema.Struct({
  context: Schema.optional(SidebarContext),
  pin_title: Schema.optional(Schema.Boolean).annotate({
    description: "Keep the session title at the top of the sidebar instead of scrolling it with the sidebar content",
  }),
  order: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Sidebar sections in display order, by name (context, mcp, lsp, todo, files) or plugin id. Sections not listed follow in their default order",
  }),
  hidden: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Sidebar sections to hide, by name (context, mcp, lsp, todo, files) or plugin id",
  }),
  mcp_summary: Schema.optional(SidebarMcpSummary),
  mcp_list: Schema.optional(SidebarMcpList),
  todo_summary: Schema.optional(SidebarTodoSummary),
  todo_summary_style: Schema.optional(SidebarTodoSummaryStyle),
}).annotate({ description: "Session sidebar settings" })
export type Sidebar = Schema.Schema.Type<typeof Sidebar>

export const UsageContextColor = Schema.Literals(["plain", "colored"]).annotate({
  description:
    "Context usage color: 'plain' keeps the muted text color, 'colored' colors tokens and percent used by context_thresholds",
})
export const UsageContextThresholdsDefault = [60, 70, 80, 90]
const Thresholds = Schema.Array(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)))
export const Usage = Schema.Struct({
  context_color: Schema.optional(UsageContextColor),
  context_thresholds: Schema.optional(Thresholds).annotate({
    description:
      "Percent-used thresholds for 'colored': above the first is the warning color, above the last the error color, blended between (default: [60, 70, 80, 90])",
  }),
  cost_thresholds: Schema.optional(Thresholds).annotate({
    description:
      "Dollar thresholds for the session cost: above the first is the warning color, above the last the error color, blended between (default: none)",
  }),
}).annotate({ description: "Context usage and cost coloring in the sidebar Context block and the prompt footer" })
export type Usage = Schema.Schema.Type<typeof Usage>

export const AttentionSounds = Schema.Record(AttentionSoundName, Schema.optionalKey(Schema.String))
export type AttentionSoundPaths = Schema.Schema.Type<typeof AttentionSounds>
export const Attention = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  notifications: Schema.optional(Schema.Boolean),
  sound: Schema.optional(Schema.Boolean),
  volume: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))),
  sound_pack: Schema.optional(Schema.String),
  sounds: Schema.optional(AttentionSounds),
}).annotate({ description: "Attention notification and sound settings" })

const PromptSize = Schema.Int.check(Schema.isGreaterThan(0))
export const Prompt = Schema.Struct({
  max_height: Schema.optional(PromptSize).annotate({ description: "Prompt textarea max height" }),
  max_width: Schema.optional(Schema.Union([PromptSize, Schema.Literal("auto")])).annotate({
    description: "Home prompt max width: a positive integer for a fixed cap, or 'auto' to scale with terminal width",
  }),
}).annotate({ description: "Prompt size settings" })

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.String),
  keybinds: Schema.optional(TuiKeybind.KeybindOverrides),
  plugin: Schema.optional(Schema.Array(PluginSpec)),
  plugin_enabled: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  leader_timeout: Schema.optional(LeaderTimeout),
  attention: Schema.optional(Attention),
  prompt: Schema.optional(Prompt),
  scroll_speed: Schema.optional(ScrollSpeed).annotate({ description: "TUI scroll speed" }),
  scroll_acceleration: Schema.optional(ScrollAcceleration),
  diff_style: Schema.optional(DiffStyle),
  keep_scroll_on_submit: Schema.optional(Schema.Boolean).annotate({
    description:
      "Keep the session scroll position when a prompt is submitted instead of jumping to the bottom (default: false)",
  }),
  turn_timing: Schema.optional(TurnTiming),
  cursor: Schema.optional(Cursor),
  sidebar: Schema.optional(Sidebar),
  usage: Schema.optional(Usage),
  mouse: Schema.optional(Schema.Boolean).annotate({ description: "Enable or disable mouse capture (default: true)" }),
})
export type Info = Schema.Schema.Type<typeof Info>

export type Resolved = Omit<Info, "attention" | "keybinds" | "leader_timeout" | "mouse" | "cursor"> & {
  attention: {
    enabled: boolean
    notifications: boolean
    sound: boolean
    volume: number
    sound_pack: string
    sounds: AttentionSoundPaths
  }
  keybinds: TuiKeybind.BindingLookupView
  leader_timeout: number
  mouse: boolean
  cursor?: {
    style: "block" | "underline" | "line" | "default"
    blinking: boolean
  }
}

export const ResolveOptions = Schema.Struct({
  terminalSuspend: Schema.Boolean,
})
export type ResolveOptions = Schema.Schema.Type<typeof ResolveOptions>

export function resolve(input: Info, options: ResolveOptions): Resolved {
  const keybinds: TuiKeybind.KeybindOverrides = { ...input.keybinds }
  if (!options.terminalSuspend) {
    keybinds.terminal_suspend = "none"
    if (keybinds.input_undo === undefined) {
      const inputUndo = TuiKeybind.defaultValue("input_undo")
      keybinds.input_undo = ["ctrl+z", ...(typeof inputUndo === "string" ? inputUndo.split(",") : [])]
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(",")
    }
  }

  return {
    ...input,
    attention: {
      enabled: input.attention?.enabled ?? false,
      notifications: input.attention?.notifications ?? true,
      sound: input.attention?.sound ?? true,
      volume: input.attention?.volume ?? 0.4,
      sound_pack: input.attention?.sound_pack ?? "opencode.default",
      sounds: input.attention?.sounds ?? {},
    },
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse(keybinds)), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: input.leader_timeout ?? LeaderTimeoutDefault,
    mouse: input.mouse ?? true,
    cursor: input.cursor
      ? {
          style: input.cursor.style ?? "block",
          blinking: input.cursor.blinking ?? true,
        }
      : undefined,
  }
}

const ConfigContext = createContext<Resolved>()

export function TuiConfigProvider(props: { config: Resolved; children: JSX.Element }) {
  return <ConfigContext.Provider value={props.config}>{props.children}</ConfigContext.Provider>
}

export function useTuiConfig() {
  const value = useContext(ConfigContext)
  if (!value) throw new Error("TuiConfigProvider is missing")
  return value
}
