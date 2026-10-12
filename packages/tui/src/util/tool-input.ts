export type ToolInputKind = "indent" | "key" | "punctuation" | "string" | "number" | "boolean" | "null" | "fold"
export type ToolInputSegment = { text: string; kind: ToolInputKind }
export type ToolInputRow = ToolInputSegment[]
export type ToolInputFold = (text: string) => { output: string; overflow: boolean }

// The one-line `[key=value, ...]` form a tool's input is shown in by default. It only has room for
// primitive values, so objects and arrays are left out.
export function inlineToolInput(input: Record<string, unknown>, omit?: string[]) {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

// Whether the one-line form shows the whole input readably: nothing but short single-line
// primitives.
export function fitsInline(input: Record<string, unknown>, width = 80) {
  const values = Object.values(input)
  if (values.some((value) => typeof value !== "number" && typeof value !== "boolean" && typeof value !== "string"))
    return false
  if (values.some((value) => typeof value === "string" && value.includes("\n"))) return false
  return inlineToolInput(input).length <= width
}

// A tool's input as YAML-style rows: one key per row, nested objects and arrays indented beneath
// their key, strings unquoted with their escapes already decoded (JSON gave us real newlines,
// tabs and quotes), a multi-line string as its own indented lines. `fold` shortens each string;
// `overflow` reports whether it cut any.
export function formatToolInput(input: Record<string, unknown>, fold: ToolInputFold) {
  const rows: ToolInputRow[] = []
  let overflow = false

  const indent = (depth: number): ToolInputSegment => ({ text: "  ".repeat(depth), kind: "indent" })

  function object(value: Record<string, unknown>, depth: number, head?: ToolInputSegment[]) {
    Object.entries(value).forEach(([key, item], index) => {
      const prefix = index === 0 && head ? head : [indent(depth)]
      entry([...prefix, { text: key, kind: "key" }], depth, item)
    })
  }

  // `head` is the row so far, a key or an array dash, without its separator.
  function entry(head: ToolInputSegment[], depth: number, item: unknown) {
    const separator: ToolInputSegment = { text: head.at(-1)?.kind === "key" ? ": " : " ", kind: "punctuation" }
    const opened = () => rows.push(head.at(-1)?.kind === "key" ? [...head, { text: ":", kind: "punctuation" }] : head)
    if (typeof item === "string") {
      const folded = fold(item)
      overflow ||= folded.overflow
      if (folded.output === "") {
        rows.push([
          ...head,
          separator,
          folded.overflow ? { text: "…", kind: "fold" } : { text: '""', kind: "punctuation" },
        ])
        return
      }
      if (!folded.output.includes("\n")) {
        rows.push([...head, separator, { text: folded.output, kind: "string" }])
        return
      }
      opened()
      for (const line of folded.output.split("\n")) rows.push([indent(depth + 1), { text: line, kind: "string" }])
      return
    }
    if (Array.isArray(item)) {
      if (item.length === 0) {
        rows.push([...head, separator, { text: "[]", kind: "punctuation" }])
        return
      }
      opened()
      for (const element of item) {
        const dash: ToolInputSegment[] = [indent(depth + 1), { text: "-", kind: "punctuation" }]
        if (isRecord(element) && Object.keys(element).length > 0) {
          object(element, depth + 2, [indent(depth + 1), { text: "- ", kind: "punctuation" }])
          continue
        }
        entry(dash, depth + 1, element)
      }
      return
    }
    if (isRecord(item)) {
      if (Object.keys(item).length === 0) {
        rows.push([...head, separator, { text: "{}", kind: "punctuation" }])
        return
      }
      opened()
      object(item, depth + 1)
      return
    }
    rows.push([...head, separator, scalar(item)])
  }

  object(input, 0)
  return { rows, overflow }
}

function scalar(value: unknown): ToolInputSegment {
  if (typeof value === "number") return { text: String(value), kind: "number" }
  if (typeof value === "boolean") return { text: String(value), kind: "boolean" }
  if (value === null || value === undefined) return { text: "null", kind: "null" }
  return { text: String(value), kind: "string" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
