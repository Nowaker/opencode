import { expect, test } from "bun:test"
import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import { TranscriptFilter } from "../../../src/routes/session/transcript-filter"
import { bashFileAction } from "../../../src/util/file-output"

function store(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    set: (key: string, value: unknown) => void values.set(key, value),
    values,
  }
}

function tool(
  name: string,
  input: Record<string, unknown> = {},
  status: "completed" | "running" | "error" = "completed",
) {
  const state =
    status === "completed"
      ? { status, input, output: "", title: "", metadata: {}, time: { start: 1, end: 2 } }
      : status === "running"
        ? { status, input, time: { start: 1 } }
        : { status, input, error: "boom", time: { start: 1, end: 2 } }
  return {
    id: `prt_${name}`,
    sessionID: "ses",
    messageID: "msg",
    type: "tool",
    callID: name,
    tool: name,
    state,
  } as ToolPart
}

const user = (id: string) => ({ id, sessionID: "ses", role: "user", time: { created: 1 } }) as Message
const assistant = (id: string, finish: string) =>
  ({ id, sessionID: "ses", role: "assistant", finish, time: { created: 1, completed: 2 } }) as Message
const text = (messageID: string, value: string, extra: Record<string, unknown> = {}) =>
  ({ id: `prt_${messageID}`, sessionID: "ses", messageID, type: "text", text: value, ...extra }) as Part

test("bash commands that only read or search files count as file actions", () => {
  expect(bashFileAction("cat src/a.ts")).toBe("read")
  expect(bashFileAction("sed -n '1,20p' a.ts | head")).toBe("read")
  expect(bashFileAction("cd src && rg -n foo")).toBe("search")
  expect(bashFileAction("git show HEAD:src/a.ts")).toBe("read")
  expect(bashFileAction("git show HEAD")).toBeUndefined()
  expect(bashFileAction("cat a.ts > b.ts")).toBeUndefined()
  expect(bashFileAction("sed -i 's/a/b/' a.ts")).toBeUndefined()
  expect(bashFileAction("bun test")).toBeUndefined()
})

test("tool calls are sorted into their kinds", () => {
  expect(TranscriptFilter.toolEntry(tool("question"))).toEqual({ kind: "questions" })
  expect(TranscriptFilter.toolEntry(tool("todowrite"))).toEqual({ kind: "todos" })
  expect(TranscriptFilter.toolEntry(tool("task"))).toEqual({ kind: "subagents" })
  expect(TranscriptFilter.toolEntry(tool("apply_patch"))).toEqual({ kind: "file_actions", name: "edits" })
  expect(TranscriptFilter.toolEntry(tool("glob"))).toEqual({ kind: "file_actions", name: "searches" })
  expect(TranscriptFilter.toolEntry(tool("bash", { command: "head -5 a.ts" }))).toEqual({
    kind: "file_actions",
    name: "reads",
  })
  expect(TranscriptFilter.toolEntry(tool("bash", { command: "bun test" }))).toEqual({ kind: "tools", name: "bash" })
})

test("everything shows by default, and the old 'Hide tool details' still hides what it hid", () => {
  const all = TranscriptFilter.resolve({}, store())
  expect(TranscriptFilter.filtering(all)).toBe(false)
  const legacy = TranscriptFilter.resolve({}, store({ tool_details_visibility: false }))
  expect(TranscriptFilter.Kinds.filter((kind) => !legacy[kind.key].shown).map((kind) => kind.key)).toEqual([
    "questions",
    "todos",
    "subagents",
    "file_actions",
    "tools",
  ])
})

test("unticking tool calls and ticking one shows only that tool, remembered in kv.json", () => {
  const kv = store()
  TranscriptFilter.toggleKind({}, kv, "tools")
  expect(kv.values.get("tool_details_visibility")).toBe(false)
  TranscriptFilter.toggleName({}, kv, "tools", "bash")
  const selection = TranscriptFilter.resolve({}, kv)
  expect(TranscriptFilter.showsTool(selection, tool("bash", { command: "bun test" }))).toBe(true)
  expect(TranscriptFilter.showsTool(selection, tool("webfetch"))).toBe(false)
  expect(TranscriptFilter.showsTool(selection, tool("webfetch", {}, "running"))).toBe(true)
  expect(TranscriptFilter.showsTool(selection, tool("webfetch", {}, "error"))).toBe(true)
  // The kinds that used to follow "Hide tool details" stay shown.
  expect(selection.todos.shown).toBe(true)
  expect(kv.values.get("transcript_filter")).toEqual({
    file_actions: { shown: true },
    todos: { shown: true },
    questions: { shown: true },
    subagents: { shown: true },
    tools: { only: { bash: true } },
  })
})

test("'Other tools' keeps the listed tools as they were", () => {
  const kv = store({ tool_details_visibility: false })
  TranscriptFilter.toggleName({}, kv, "tools", undefined, ["bash", "read"])
  const group = TranscriptFilter.resolve({}, kv).tools
  expect(group.other).toBe(true)
  expect(TranscriptFilter.shows(TranscriptFilter.resolve({}, kv), { kind: "tools", name: "bash" })).toBe(false)
  expect(TranscriptFilter.shows(TranscriptFilter.resolve({}, kv), { kind: "tools", name: "skill" })).toBe(true)
})

test("a kind set in tui.json decides on every start, and its toggle lasts until exit", () => {
  const config = { transcript: { show: { thinking: false, file_actions: ["edits" as const] } } }
  const kv = store({ transcript_filter: { thinking: { shown: true } } })
  expect(TranscriptFilter.resolve(config, kv).thinking.shown).toBe(false)
  expect(TranscriptFilter.toggleKind(config, kv, "thinking")).toContain("until opencode exits")
  expect(TranscriptFilter.resolve(config, kv).thinking.shown).toBe(true)
  // Toggling back to what tui.json says clears the override.
  expect(TranscriptFilter.toggleKind(config, kv, "thinking")).toBeUndefined()
  expect(TranscriptFilter.resolve({}, kv).thinking.shown).toBe(true)
  const files = TranscriptFilter.resolve(config, kv)
  expect(TranscriptFilter.shows(files, { kind: "file_actions", name: "edits" })).toBe(true)
  expect(TranscriptFilter.shows(files, { kind: "file_actions", name: "reads" })).toBe(false)
  expect(kv.values.get("transcript_filter")).toEqual({ thinking: { shown: true } })
})

test("notices are user messages whose text the model never sees", () => {
  expect(TranscriptFilter.userKind([text("m", "hi")])).toBe("prompts")
  expect(TranscriptFilter.userKind([text("m", "for you", { ignored: true })])).toBe("notices")
})

test("counting and the all-hidden check", () => {
  const messages = [user("m1"), assistant("m2", "tool-calls"), assistant("m3", "stop")]
  const parts: Record<string, Part[]> = {
    m1: [text("m1", "do it")],
    m2: [text("m2", "looking"), tool("read"), tool("bash", { command: "bun test" }), tool("bash", { command: "ls" })],
    m3: [text("m3", "done")],
  }
  const counts = TranscriptFilter.count(messages, (id) => parts[id] ?? [])
  expect(counts.kinds.prompts).toBe(1)
  expect(counts.kinds.notes).toBe(1)
  expect(counts.kinds.answers).toBe(1)
  expect(counts.files.reads).toBe(1)
  expect(counts.tools).toEqual([{ name: "bash", count: 2 }])
  const kv = store({
    tool_details_visibility: false,
    assistant_metadata_visibility: false,
    transcript_filter: Object.fromEntries(TranscriptFilter.Kinds.map((kind) => [kind.key, { shown: false }])),
  })
  expect(TranscriptFilter.anyShown(messages, (id) => parts[id] ?? [], TranscriptFilter.resolve({}, kv))).toBe(false)
  TranscriptFilter.toggleKind({}, kv, "answers")
  expect(TranscriptFilter.anyShown(messages, (id) => parts[id] ?? [], TranscriptFilter.resolve({}, kv))).toBe(true)
})
