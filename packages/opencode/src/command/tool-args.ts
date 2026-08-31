import { positionalToolParam, toolArgumentExcerpt, toolParamSummary, type ToolParam } from "./tool-params"

export type ParsedToolCommand =
  | { ok: true; hidden: boolean; args: Record<string, unknown> }
  | { ok: false; error: string }

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

  const positional = positionalToolParam(params)
  if (!positional) {
    throw new Error(
      `cannot tell which parameter ${JSON.stringify(toolArgumentExcerpt(lead))} is - this tool takes ` +
        `${toolParamSummary(params)}, and none of them is the obvious one, so name it: ` +
        `${params[0]!.name}=${JSON.stringify(toolArgumentExcerpt(lead))}`,
    )
  }
  if (positional.name in args) {
    throw new Error(
      `${JSON.stringify(toolArgumentExcerpt(lead))} has no parameter name in front of it, and ${positional.name} - ` +
        `the one it would have gone to - was already given`,
    )
  }
  args[positional.name] = readValue(lead, positional)
  return args
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
