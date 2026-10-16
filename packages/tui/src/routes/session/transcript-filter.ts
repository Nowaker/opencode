export * as TranscriptFilter from "./transcript-filter"

import { createSignal } from "solid-js"
import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import type { TuiConfig } from "../../config"
import { bashFileAction } from "../../util/file-output"

// What the session transcript shows, one entry kind per row of the transcript filter dialog, most
// important first. Ticked shows. Two kinds have a second level used while they are unticked:
// tool calls by tool name ("only show these", with "other" for the rest) and file actions by what
// they do.
export const Kinds = [
  { key: "prompts", label: "Prompts" },
  { key: "answers", label: "Final answers" },
  { key: "questions", label: "Questions" },
  { key: "errors", label: "Errors" },
  { key: "notices", label: "Notices" },
  { key: "todos", label: "Todos" },
  { key: "subagents", label: "Subagents" },
  { key: "notes", label: "Progress notes" },
  { key: "file_actions", label: "File actions" },
  { key: "tools", label: "Tool calls" },
  { key: "thinking", label: "Thinking" },
  { key: "compaction", label: "Compaction markers" },
  { key: "footers", label: "Turn footers" },
] as const
export type Kind = (typeof Kinds)[number]["key"]

export const FileActions = [
  { key: "edits", label: "Edits, writes and patches" },
  { key: "reads", label: "Reads" },
  { key: "searches", label: "Searches" },
] as const
export type FileAction = (typeof FileActions)[number]["key"]

// `only` holds the second level's decisions by name; a name without one follows `other`.
export type Group = { shown: boolean; only: Readonly<Record<string, boolean>>; other: boolean }
export type Selection = Readonly<Record<Kind, Group>>

export type Entry = { kind: Kind; name?: string }

type KV = { get(key: string, fallback?: unknown): any; set(key: string, value: unknown): void }
type Config = Pick<TuiConfig.Info, "transcript">

export const KVKey = "transcript_filter"
// Kinds that already had a toggle before this filter keep its kv.json key.
const legacyKeys: Partial<Record<Kind, string>> = {
  tools: "tool_details_visibility",
  footers: "assistant_metadata_visibility",
}
// "Hide tool details" hid these too, so until one is chosen on its own it follows that toggle.
const followsToolDetails: readonly Kind[] = ["file_actions", "todos", "questions", "subagents"]

const shown: Group = { shown: true, only: {}, other: false }

// A kind set in tui.json (`transcript.show`) decides on every start, and its toggle then lasts
// until opencode exits; unset, the toggles are remembered in kv.json.
const [overrides, setOverrides] = createSignal<Partial<Record<Kind, Group>>>({})

// Every group is a fresh copy, since a store holding the selection may change it in place.
export function resolve(config: Config, kv: KV): Selection {
  const current = overrides()
  return Object.fromEntries(
    Kinds.map((kind) => {
      const group = current[kind.key] ?? configured(config, kind.key) ?? saved(kv, kind.key)
      return [kind.key, { shown: group.shown, other: group.other, only: { ...group.only } }]
    }),
  ) as Record<Kind, Group>
}

export function filtering(selection: Selection) {
  return Kinds.some((kind) => !selection[kind.key].shown)
}

export function shows(selection: Selection, entry: Entry) {
  const group = selection[entry.kind]
  if (group.shown) return true
  if (entry.name === undefined) return false
  return group.only[entry.name] ?? group.other
}

// A running call always shows, so the turn is never silent while it works, and a failed one also
// shows while errors do.
export function showsTool(selection: Selection, part: ToolPart, entry = toolEntry(part)) {
  if (part.state.status === "pending" || part.state.status === "running") return true
  if (shows(selection, entry)) return true
  return part.state.status === "error" && selection.errors.shown
}

export function toolEntry(part: ToolPart): Entry {
  if (part.tool === "question") return { kind: "questions" }
  if (part.tool === "todowrite" || part.tool === "todoread") return { kind: "todos" }
  if (part.tool === "task") return { kind: "subagents" }
  const action = fileAction(part)
  if (action) return { kind: "file_actions", name: action }
  return { kind: "tools", name: part.tool }
}

function fileAction(part: ToolPart): FileAction | undefined {
  if (part.tool === "read") return "reads"
  if (["edit", "write", "apply_patch", "multiedit", "patch"].includes(part.tool)) return "edits"
  if (["grep", "glob", "list"].includes(part.tool)) return "searches"
  if (part.tool !== "bash") return
  const command = part.state.input?.command
  const action = typeof command === "string" ? bashFileAction(command) : undefined
  if (action === "read") return "reads"
  if (action === "search") return "searches"
}

// A user message is a notice when every text it shows is marked for the reader only, as Vibeterm's
// user_message is; otherwise a prompt.
export function userKind(parts: readonly Part[]): "prompts" | "notices" {
  const texts = parts.filter((part) => part.type === "text" && !part.synthetic)
  return texts.length > 0 && texts.every((part) => part.type === "text" && part.ignored) ? "notices" : "prompts"
}

export function finalAnswer(message: Message) {
  return message.role === "assistant" && !!message.finish && !["tool-calls", "unknown"].includes(message.finish)
}

// Whether anything loaded would be drawn, from the newest message back so the usual answer is quick.
export function anyShown(
  messages: readonly Message[],
  partsOf: (messageID: string) => readonly Part[],
  selection: Selection,
) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const parts = partsOf(message.id)
    if (message.role === "user") {
      if (parts.some((part) => part.type === "text" && !part.synthetic) && selection[userKind(parts)].shown) return true
      if (parts.some((part) => part.type === "compaction") && selection.compaction.shown) return true
      continue
    }
    if (!message.time.completed) return true
    if (selection.footers.shown) return true
    if (message.error && message.error.name !== "MessageAbortedError" && selection.errors.shown) return true
    const text = finalAnswer(message) ? selection.answers.shown : selection.notes.shown
    for (const part of parts) {
      if (part.type === "text" && part.text.trim() && text) return true
      if (part.type === "reasoning" && part.text.trim() && selection.thinking.shown) return true
      if (part.type === "tool" && showsTool(selection, part)) return true
    }
  }
  return false
}

export type Counts = {
  kinds: Record<Kind, number>
  tools: { name: string; count: number }[]
  files: Record<FileAction, number>
}

// Counted once when the dialog opens: every finished entry loaded, and tool calls by name, most
// used first.
export function count(messages: readonly Message[], partsOf: (messageID: string) => readonly Part[]): Counts {
  const kinds = Object.fromEntries(Kinds.map((kind) => [kind.key, 0])) as Record<Kind, number>
  const files = Object.fromEntries(FileActions.map((action) => [action.key, 0])) as Record<FileAction, number>
  const tools = new Map<string, number>()
  for (const message of messages) {
    const parts = partsOf(message.id)
    if (message.role === "user") {
      if (parts.some((part) => part.type === "text" && !part.synthetic)) kinds[userKind(parts)]++
      if (parts.some((part) => part.type === "compaction")) kinds.compaction++
      continue
    }
    if (message.time.completed) kinds.footers++
    if (message.error && message.error.name !== "MessageAbortedError") kinds.errors++
    for (const part of parts) {
      if (part.type === "text" && part.text.trim()) kinds[finalAnswer(message) ? "answers" : "notes"]++
      if (part.type === "reasoning" && part.text.trim()) kinds.thinking++
      if (part.type !== "tool") continue
      if (part.state.status === "error") kinds.errors++
      const entry = toolEntry(part)
      kinds[entry.kind]++
      if (entry.kind === "file_actions") files[entry.name as FileAction]++
      if (entry.kind === "tools") tools.set(entry.name!, (tools.get(entry.name!) ?? 0) + 1)
    }
  }
  return {
    kinds,
    files,
    tools: [...tools.entries()]
      .map(([name, count]) => ({ name, count }))
      .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}

export function toggleKind(config: Config, kv: KV, kind: Kind) {
  return update(config, kv, kind, (group) => ({ ...group, shown: !group.shown }))
}

// One second-level name, or every name without its own decision when `name` is undefined ("other").
// Names in `pin` keep what they show as "other" changes, since the dialog lists them on their own.
export function toggleName(
  config: Config,
  kv: KV,
  kind: "tools" | "file_actions",
  name?: string,
  pin: readonly string[] = [],
) {
  return update(config, kv, kind, (group) => {
    if (name !== undefined) return { ...group, only: { ...group.only, [name]: !(group.only[name] ?? group.other) } }
    const pinned = pin.filter((item) => group.only[item] === undefined).map((item) => [item, group.other])
    return { ...group, other: !group.other, only: { ...group.only, ...Object.fromEntries(pinned) } }
  })
}

// Returns the message to show when the change lasts only until exit.
function update(config: Config, kv: KV, kind: Kind, change: (group: Group) => Group) {
  const current = resolve(config, kv)[kind]
  const next = change(current)
  const decided = configured(config, kind)
  if (!decided) return persist(kv, kind, current, next)
  const restored = same(next, decided)
  setOverrides((all) => {
    const copy = { ...all }
    if (restored) delete copy[kind]
    else copy[kind] = next
    return copy
  })
  if (restored) return
  const label = Kinds.find((item) => item.key === kind)!.label
  return `${label} filter changed until opencode exits: tui.json sets transcript.show.${kind}`
}

function persist(kv: KV, kind: Kind, current: Group, next: Group) {
  const legacy = legacyKeys[kind]
  const stored = { ...kv.get(KVKey) }
  // The kinds still following "Hide tool details" keep what they show when Tool calls changes.
  if (kind === "tools" && next.shown !== current.shown)
    for (const follower of followsToolDetails)
      if (stored[follower]?.shown === undefined)
        stored[follower] = { ...stored[follower], shown: saved(kv, follower).shown }
  const entry = { ...stored[kind] }
  if (next.shown !== current.shown && !legacy) entry.shown = next.shown
  if (next.other !== current.other) entry.other = next.other
  if (next.only !== current.only) entry.only = next.only
  if (Object.keys(entry).length > 0) stored[kind] = entry
  if (Object.keys(stored).length > 0) kv.set(KVKey, stored)
  if (next.shown !== current.shown && legacy) kv.set(legacy, next.shown)
}

function saved(kv: KV, kind: Kind): Group {
  const stored = kv.get(KVKey)?.[kind] ?? {}
  const legacy = legacyKeys[kind]
  const fallback = followsToolDetails.includes(kind) ? kv.get("tool_details_visibility", true) : true
  return {
    shown: (legacy ? kv.get(legacy, true) : (stored.shown ?? fallback)) === true,
    only: typeof stored.only === "object" && stored.only ? stored.only : {},
    other: stored.other === true,
  }
}

function configured(config: Config, kind: Kind): Group | undefined {
  const value = config.transcript?.show?.[kind]
  if (value === undefined) return
  if (typeof value === "boolean") return value ? shown : { shown: false, only: {}, other: false }
  return { shown: false, only: Object.fromEntries(value.map((name) => [name, true])), other: false }
}

export function same(a: Group, b: Group) {
  if (a.shown !== b.shown || a.other !== b.other) return false
  const names = new Set([...Object.keys(a.only), ...Object.keys(b.only)])
  return [...names].every((name) => (a.only[name] ?? a.other) === (b.only[name] ?? b.other))
}
