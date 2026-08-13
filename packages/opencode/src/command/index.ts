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
 * One parameter of a tool, in the only terms the argument parser needs.
 *
 * `type` comes from the tool's own JSON Schema - `ToolJsonSchema.fromTool` for
 * anything in the registry, and an MCP server's published `inputSchema` for the
 * rest - so a value can be coerced without anything executable.
 */
export interface ToolParam {
  name: string
  required: boolean
  type?: string
}

/**
 * `[--hide|--show] [<arguments>]`, the text typed after a tool command.
 *
 * A tool's arguments are always an object, so the braces say nothing and are
 * implied, and the parameter NAMES are known, so `key=value` pairs can be found
 * in free text without a quoting discipline: a word is an assignment only when
 * it is a parameter this tool really has. That is what lets an unquoted value
 * contain spaces. A tool with one parameter - or several with exactly one
 * required - also takes a bare value, so `/tool-bash git status` works.
 *
 * Returns a result rather than throwing: a synchronous throw inside the
 * `Effect.gen` that calls this becomes a `Cause.Die`, which surfaces to the
 * client as an opaque failure instead of the usage error the person needs.
 *
 * `--hide` persists the output but keeps it out of the model's context.
 * Visible is the default, because the usual reason to run a tool by hand is to
 * put its output in front of the model.
 */
export function parseToolCommandArguments(raw: string, params?: readonly ToolParam[]): ParsedToolCommand {
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

  /* A leading brace is unambiguous intent to write JSON, so a broken object is
     reported as broken JSON rather than quietly read as a positional value. */
  if (rest.startsWith("{")) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rest)
    } catch {
      return { ok: false, error: `that starts with "{" so it is read as JSON, and it is not valid JSON: ${rest}` }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `expected arguments to be a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      }
    }
    return { ok: true, hidden, args: parsed as Record<string, unknown> }
  }

  try {
    return { ok: true, hidden, args: parseTypedArguments(rest, params) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

interface Assignment {
  name: string
  nameStart: number
  valueStart: number
}

/**
 * Where in the text a parameter is being assigned.
 *
 * Only a name the tool really has counts, which is what lets an unquoted value
 * run over spaces: in `command=yo yo timeout=5` the first value ends at
 * `timeout` because that is a parameter, and would not end at `yo`. Quoted runs
 * are skipped wholesale, so a parameter name inside quotes never splits.
 */
function findAssignments(text: string, names: ReadonlySet<string>): Assignment[] {
  const found: Assignment[] = []
  let index = 0
  let atBoundary = true

  while (index < text.length) {
    const char = text[index]!
    if (char === "'" || char === '"') {
      index = skipQuoted(text, index)
      atBoundary = false
      continue
    }
    if (atBoundary) {
      const match = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*([:=])/.exec(text.slice(index))
      if (match && names.has(match[1]!)) {
        found.push({ name: match[1]!, nameStart: index, valueStart: index + match[0].length })
        index += match[0].length
        atBoundary = false
        continue
      }
    }
    atBoundary = char === " " || char === "\t" || char === "\n" || char === ","
    index += 1
  }

  return found
}

function skipQuoted(text: string, start: number) {
  const quote = text[start]
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1
      continue
    }
    if (text[index] === quote) return index + 1
  }
  return text.length
}

function parseTypedArguments(text: string, params?: readonly ToolParam[]): Record<string, unknown> {
  if (!params || params.length === 0) {
    throw new Error(`this tool's parameters are not known here, so its arguments have to be written as JSON: {"key":"value"}`)
  }

  const byName = new Map(params.map((param) => [param.name, param]))
  const assignments = findAssignments(text, new Set(byName.keys()))
  const args: Record<string, unknown> = {}

  for (let position = 0; position < assignments.length; position += 1) {
    const assignment = assignments[position]!
    const end = assignments[position + 1]?.nameStart ?? text.length
    if (assignment.name in args) throw new Error(`${assignment.name} was given twice`)
    args[assignment.name] = readValue(text.slice(assignment.valueStart, end), byName.get(assignment.name)!)
  }

  const lead = trimSeparators(assignments[0] ? text.slice(0, assignments[0].nameStart) : text)
  if (!lead) return args

  const positional = positionalParam(params)
  if (!positional) {
    throw new Error(
      `cannot tell which parameter ${JSON.stringify(excerpt(lead))} is - this tool takes ` +
        `${describeParams(params)}, and none of them is the obvious one, so name it: ` +
        `${params[0]!.name}=${JSON.stringify(excerpt(lead))}`,
    )
  }
  if (positional.name in args) {
    throw new Error(
      `${JSON.stringify(excerpt(lead))} has no parameter name in front of it, and ${positional.name} - ` +
        `the one it would have gone to - was already given`,
    )
  }
  args[positional.name] = readValue(lead, positional)
  return args
}

/**
 * The parameter a bare value goes to, when there is an obvious one.
 *
 * Two required parameters cannot be told apart by position when either may
 * contain spaces, so that is refused rather than guessed at.
 */
function positionalParam(params: readonly ToolParam[]) {
  const required = params.filter((param) => param.required)
  if (required.length === 1) return required[0]
  if (params.length === 1) return params[0]
  return undefined
}

function readValue(raw: string, param: ToolParam): unknown {
  const text = trimSeparators(raw)
  /* Quotes are the escape hatch, so what is inside them is never re-read as a
     number, a boolean or JSON. */
  const quoted = unquote(text)
  if (quoted !== undefined) return quoted

  switch (param.type) {
    case "number":
    case "integer": {
      const value = Number(text)
      return text !== "" && Number.isFinite(value) ? value : text
    }
    case "boolean":
      return text === "true" ? true : text === "false" ? false : text
    case "array": {
      const value = tryJson(text)
      if (Array.isArray(value)) return value
      return text
        .split(",")
        .map((item) => trimSeparators(item))
        .filter((item) => item.length > 0)
    }
    case "object": {
      const value = tryJson(text)
      return value === undefined ? text : value
    }
    case "string":
      return text
    default: {
      const specific = specificReadings(text)
      /* NOT `specific[0] ?? text`: the most specific reading of `null` IS null,
         which `??` reads as absent and replaces with the string. */
      return specific.length > 0 ? specific[0] : text
    }
  }
}

function specificReadings(text: string): unknown[] {
  const readings: unknown[] = []
  if (text.startsWith("[") || text.startsWith("{")) {
    const value = tryJson(text)
    if (value !== undefined) readings.push(value)
  }
  if (text === "true") readings.push(true)
  if (text === "false") readings.push(false)
  if (text === "null") readings.push(null)
  if (text !== "" && Number.isFinite(Number(text))) readings.push(Number(text))
  return readings
}

function unquote(text: string) {
  if (text.length < 2) return undefined
  const quote = text[0]
  if (quote !== "'" && quote !== '"') return undefined
  if (skipQuoted(text, 0) !== text.length) return undefined
  if (text[text.length - 1] !== quote) return undefined
  return text.slice(1, -1).replace(/\\(['"\\])/g, "$1")
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function trimSeparators(text: string) {
  let out = text.trim()
  while (out.endsWith(",")) out = out.slice(0, -1).trimEnd()
  return out
}

function excerpt(text: string, limit = 40) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}

function describeParams(params: readonly ToolParam[]) {
  return params.map((param) => (param.required ? param.name : `[${param.name}]`)).join(", ")
}

/** The three spellings, shown when something could not be read. */
export function toolCommandUsage(commandName: string, params?: readonly ToolParam[]) {
  if (!params || params.length === 0) return `usage: /${commandName} [--hide] {"key":"value"}`

  const required = params.filter((param) => param.required)
  const shown = (required.length > 0 ? required : params).slice(0, 3)
  const first = shown[0]?.name ?? "key"
  const lines = [`usage: /${commandName} [--hide] ${shown.map((param) => `${param.name}=…`).join(" ")}`]

  const positional = positionalParam(params)
  if (positional) lines.push(`       /${commandName} [--hide] <${positional.name}>`)
  lines.push(`       /${commandName} [--hide] {${JSON.stringify(first)}:"…"}`)
  if (params.length > 1) lines.push(`parameters: ${describeParams(params)}  ([optional])`)
  return lines.join("\n")
}

/**
 * A JSON Schema object, as parameters.
 *
 * Every tool has one: opencode derives it from a builtin's Effect Schema
 * (`ToolJsonSchema.fromTool`), a plugin tool carries one built from its zod
 * args, and an MCP server publishes its own.
 */
export function toolParamsFromJsonSchema(schema: unknown): ToolParam[] {
  if (!schema || typeof schema !== "object") return []
  const properties = (schema as { properties?: unknown }).properties
  if (!properties || typeof properties !== "object") return []

  const declared = (schema as { required?: unknown }).required
  const required = new Set(
    Array.isArray(declared) ? declared.filter((name): name is string => typeof name === "string") : [],
  )

  return Object.entries(properties as Record<string, unknown>).map(([name, property]) => {
    const type = jsonSchemaType(property)
    return { name, required: required.has(name), ...(type ? { type } : {}) }
  })
}

function jsonSchemaType(property: unknown): string | undefined {
  if (!property || typeof property !== "object") return undefined

  const declared = (property as { type?: unknown }).type
  if (typeof declared === "string") return declared
  if (Array.isArray(declared)) {
    const first = declared.find((entry) => typeof entry === "string" && entry !== "null")
    if (typeof first === "string") return first
  }

  /* A nullable field renders as a union with `null`, which is one real type
     wearing two. A genuine union is left without one, so the text decides. */
  const anyOf = (property as { anyOf?: unknown }).anyOf
  if (Array.isArray(anyOf)) {
    const types = new Set(
      anyOf.map((entry) => jsonSchemaType(entry)).filter((type): type is string => !!type && type !== "null"),
    )
    if (types.size === 1) return [...types][0]
  }
  return undefined
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
