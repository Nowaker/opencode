import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { ToolRegistry } from "@/tool/registry"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { LegacyEvent } from "@opencode-ai/schema/legacy-event"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: LegacyEvent.CommandExecuted,
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill", "tool"])),
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  native: Schema.optional(Schema.Boolean),
  /**
   * Run this TOOL rather than prompt with a template. Implies `native`: there
   * is no reply to wait for, so the command persists the tool's output and
   * returns. The value is the tool's registry id, which is not the command's
   * own name - `bash` is both, but `vibeterm_restart_tab` is typed as
   * `/vibeterm-restart-tab`.
   */
  tool: Schema.optional(Schema.String),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "Command" })

export type Info = Omit<Schema.Schema.Type<typeof Info>, "template"> & { template: Promise<string> | string }

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  INIT: "init",
  REVIEW: "review",
} as const

/**
 * A tool id is typed with dashes: `vibeterm_restart_tab` -> `vibeterm-restart-tab`.
 *
 * Underscores are how tool ids are namespaced - a plugin tool keeps its key
 * verbatim and an MCP tool is `sanitize(server)_sanitize(tool)` - and a slash
 * command is typed rather than emitted, so it reads as a command instead of an
 * identifier. Any client that registers its own command for a tool must use
 * this same spelling or the skip below will not match it and the tool ends up
 * exposed twice.
 */
export function toolCommandName(toolId: string) {
  return toolId.replaceAll("_", "-")
}

/**
 * The namespace every auto-registered tool command lives under: `/tool-bash`,
 * `/tool-grep`, `/tool-panel-context-search-code`.
 *
 * Generated commands would otherwise take the top of the `/` menu under names
 * as generic as `bash`, `read`, `write` and `list`, where nothing distinguishes
 * a command somebody wrote from one manufactured out of a tool id.
 *
 * `tool-` rather than `native-`, which would be a lie by omission - a plugin's
 * own `/vibeterm-*` command is equally native, so a prefix carried by half of
 * them implies a difference in behaviour that does not exist - and rather than
 * `local-`, which names the wrong property, since an MCP tool is frequently a
 * remote server. It matches the `source: "tool"` and `tool:` fields the entry
 * already carries, and `/tool` filters the whole family.
 */
export const TOOL_COMMAND_PREFIX = "tool-"

export function toolCommandFullName(toolId: string) {
  return `${TOOL_COMMAND_PREFIX}${toolCommandName(toolId)}`
}

/**
 * Both spellings a tool may already be reachable under.
 *
 * The prefixed one is what auto-registration would add. The BARE one is the
 * trap the prefix introduced: a plugin publishes `/vibeterm-restart-tab` from
 * its own `config` hook, so a skip that only looked for the prefixed name would
 * find nothing taken and expose all twelve a second time - re-creating the
 * exact double exposure the skip exists to prevent.
 */
export function toolCommandNames(toolId: string): string[] {
  return [toolCommandFullName(toolId), toolCommandName(toolId)]
}

/**
 * A tool's description is written for a model and runs to paragraphs; a command
 * palette shows one line. First sentence, capped.
 */
export function toolCommandDescription(description: string | undefined, limit = 100) {
  const flat = (description ?? "").replace(/\s+/g, " ").trim()
  if (!flat) return ""
  const stop = flat.search(/[.:]\s/)
  const first = stop > 0 ? flat.slice(0, stop) : flat
  return first.length <= limit ? first : `${first.slice(0, limit - 1).trimEnd()}…`
}

export type ParsedToolCommand =
  | { ok: true; hidden: boolean; args: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * `[--hide|--show] [<json object>]`, the text typed after a tool command.
 *
 * Returns a result rather than throwing: a synchronous throw inside the
 * `Effect.gen` that calls this becomes a `Cause.Die`, which surfaces to the
 * client as an opaque failure instead of the usage error the person needs.
 *
 * `--hide` persists the output but keeps it out of the model's context.
 * Visible is the default, because the usual reason to run a tool by hand is to
 * put its output in front of the model.
 */
export function parseToolCommandArguments(raw: string): ParsedToolCommand {
  let rest = (raw ?? "").trim()
  let hidden = false
  for (;;) {
    if (rest === "--hide" || rest.startsWith("--hide ")) {
      hidden = true
      rest = rest.slice("--hide".length).trim()
      continue
    }
    if (rest === "--show" || rest.startsWith("--show ")) {
      hidden = false
      rest = rest.slice("--show".length).trim()
      continue
    }
    break
  }
  if (!rest) return { ok: true, hidden, args: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(rest)
  } catch {
    return { ok: false, error: `expected a JSON object of arguments, got: ${rest}` }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: `expected arguments to be a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    }
  }
  return { ok: true, hidden, args: parsed as Record<string, unknown> }
}

/** Line-oriented and greppable, so a transcript reads the same however it was run. */
export function formatToolCommandResult(input: { tool: string; args: unknown; output: string }) {
  const body = input.output.endsWith("\n") ? input.output.slice(0, -1) : input.output
  return [`[tool: ${input.tool}] args=${JSON.stringify(input.args)}`, "----", body, "----"].join("\n")
}

function addToolCommand(commands: Record<string, Info>, toolId: string, description?: string) {
  const name = toolCommandFullName(toolId)
  for (const taken of toolCommandNames(toolId)) if (commands[taken]) return
  commands[name] = {
    name,
    description: toolCommandDescription(description),
    source: "tool",
    tool: toolId,
    native: true,
    template: "",
    hints: ["$ARGUMENTS"],
  }
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Command") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service
    const registry = yield* ToolRegistry.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      }
      commands[Default.REVIEW] = {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", ctx.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      }

      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        commands[name] = {
          name,
          agent: command.agent,
          model: command.model,
          description: command.description,
          source: "command",
          get template() {
            return command.template
          },
          subtask: command.subtask,
          native: command.native,
          hints: hints(command.template),
        }
      }

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                .pipe(
                  Effect.map(
                    (template) =>
                      template?.messages
                        .map((message) => (message.content.type === "text" ? message.content.text : ""))
                        .join("\n") || "",
                  ),
                ),
            )
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }

      for (const item of yield* skill.all()) {
        if (commands[item.name]) continue
        const dir = item.location === "<built-in>" ? undefined : path.dirname(item.location)
        commands[item.name] = {
          name: item.name,
          description: item.description,
          source: "skill",
          get template() {
            if (!dir) return item.content
            return [
              item.content,
              "",
              `Base directory for this skill: ${dir}`,
              "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
            ].join("\n")
          },
          hints: [],
        }
      }

      /**
       * Every tool, as a command a human can type.
       *
       * Each lands under `TOOL_COMMAND_PREFIX` - `/tool-bash`, `/tool-grep` -
       * so a generated entry is never mistaken for one somebody wrote, and the
       * generic ids (`bash`, `read`, `write`, `list`) stop occupying the top of
       * the `/` menu under their bare names.
       *
       * Registered LAST, and only when NEITHER spelling is taken, so a command
       * from a `.md` file, an MCP prompt, a skill or a plugin always wins -
       * each of those was written deliberately, and this is generated. Checking
       * the bare spelling too is the whole of the "do not double-expose" rule:
       * a plugin already publishing `/vibeterm-restart-tab` keeps it and gains
       * no `/tool-vibeterm-restart-tab` twin.
       *
       * Builtin and plugin tools come from the registry; MCP tools are NOT in
       * it - they are merged into the model's tool map later, in
       * `SessionTools.resolve` - so they are listed separately here from the
       * same `mcp.tools()` that merge reads. Both are cheap: the registry is
       * already resolved and `mcp.tools()` reads cached defs of connected
       * clients rather than calling any server.
       */
      for (const item of yield* registry.all()) {
        addToolCommand(commands, item.id, item.description)
      }
      for (const [id, def] of Object.entries(yield* mcp.tools())) {
        addToolCommand(commands, id, (def as { description?: string }).description)
      }

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.commands[name]
    })

    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.commands)
    })

    return Service.of({ get, list })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, MCP.node, Skill.node, ToolRegistry.node],
})

export * as Command from "."
