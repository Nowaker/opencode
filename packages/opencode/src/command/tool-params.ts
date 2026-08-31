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

export function positionalToolParams(params: readonly ToolParam[]): readonly ToolParam[] {
  const required = params.filter((param) => param.required)
  if (required.length > 0) return required
  return params.length === 1 ? params : []
}

export function toolArgumentExcerpt(text: string, limit = 40) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}

export function toolParamSummary(params: readonly ToolParam[]) {
  return params.map((param) => (param.required ? param.name : `[${param.name}]`)).join(", ")
}

/** The three spellings, shown when something could not be read. */
export function toolCommandUsage(commandName: string, params?: readonly ToolParam[]) {
  if (!params || params.length === 0) return `usage: /${commandName} [--hide] {"key":"value"}`

  const required = params.filter((param) => param.required)
  const shown = (required.length > 0 ? required : params).slice(0, 3)
  const first = shown[0]?.name ?? "key"
  const lines = [`usage: /${commandName} [--hide] ${shown.map((param) => `${param.name}=…`).join(" ")}`]

  const positional = positionalToolParams(params)
  if (positional.length > 0) {
    lines.push(`       /${commandName} [--hide] ${positional.map((param) => `<${param.name}>`).join(" ")}`)
  }
  lines.push(`       /${commandName} [--hide] {${JSON.stringify(first)}:"…"}`)
  if (params.length > 1) lines.push(`parameters: ${toolParamSummary(params)}  ([optional])`)
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
