import { describe, expect, test } from "bun:test"
import { Command } from "@/command"

describe("what a tool is called as a slash command", () => {
  test("dashes, because it is typed rather than emitted", () => {
    expect(Command.toolCommandName("vibeterm_restart_tab")).toBe("vibeterm-restart-tab")
    expect(Command.toolCommandName("panel-context_search_code")).toBe("panel-context-search-code")
  })

  test("a single-word tool is unchanged", () => {
    expect(Command.toolCommandName("bash")).toBe("bash")
  })
})

describe("the namespace an auto-registered tool command lives under", () => {
  test("a builtin lands under the prefix, not at the top of the menu", () => {
    expect(Command.toolCommandFullName("bash")).toBe("tool-bash")
    expect(Command.toolCommandFullName("write")).toBe("tool-write")
  })

  test("an MCP tool is prefixed the same way", () => {
    expect(Command.toolCommandFullName("panel-context_search_code")).toBe("tool-panel-context-search-code")
  })

  test("one constant, so nothing can spell the prefix differently", () => {
    expect(Command.TOOL_COMMAND_PREFIX).toBe("tool-")
  })

  test("the skip checks BOTH spellings, prefixed first", () => {
    expect(Command.toolCommandNames("vibeterm_restart_tab")).toEqual([
      "tool-vibeterm-restart-tab",
      "vibeterm-restart-tab",
    ])
  })

  test("the bare spelling is in that list - it is what a plugin registers under", () => {
    // Without it, `/vibeterm-list-sessions` from the plugin's own config hook
    // would not count as taken and every tool would be exposed twice.
    expect(Command.toolCommandNames("vibeterm_list_sessions")).toContain("vibeterm-list-sessions")
  })
})

describe("typing arguments the way a human would", () => {
  const bash: Command.ToolParam[] = [
    { name: "command", required: true, type: "string" },
    { name: "description", required: false, type: "string" },
    { name: "timeout", required: false, type: "number" },
  ]
  const notify: Command.ToolParam[] = [
    { name: "session", required: true, type: "string" },
    { name: "text", required: true, type: "string" },
  ]

  function args(raw: string, params: Command.ToolParam[]) {
    const parsed = Command.parseToolCommandArguments(raw, params)
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.args
  }

  test("a bare value goes to the one required parameter", () => {
    expect(args("git status", bash)).toEqual({ command: "git status" })
  })

  test("key=value and key: value both work, comma or space separated", () => {
    expect(args("command=ls timeout=5", bash)).toEqual({ command: "ls", timeout: 5 })
    expect(args("command: ls, timeout: 5", bash)).toEqual({ command: "ls", timeout: 5 })
  })

  test("an unquoted value runs over spaces until the next real parameter", () => {
    expect(args("command=git commit -m wip timeout=5", bash)).toEqual({
      command: "git commit -m wip",
      timeout: 5,
    })
  })

  test("a word that is not a parameter stays inside the value", () => {
    expect(args("echo nope=1 done", bash)).toEqual({ command: "echo nope=1 done" })
  })

  test("a quoted value is kept whole and never re-read as a number", () => {
    expect(args("timeout='30'", bash)).toEqual({ timeout: "30" })
    expect(args(`command="git commit -m 'timeout=5'"`, bash)).toEqual({
      command: "git commit -m 'timeout=5'",
    })
  })

  test("the declared type decides, not the text", () => {
    expect(args("command=42", bash)).toEqual({ command: "42" })
    expect(args("timeout=42", bash)).toEqual({ timeout: 42 })
  })

  test("--hide still applies in front of friendly arguments", () => {
    const parsed = Command.parseToolCommandArguments("--hide git status", bash)
    expect(parsed).toEqual({ ok: true, hidden: true, args: { command: "git status" } })
  })

  test("JSON is unchanged", () => {
    expect(args('{"command":"git status"}', bash)).toEqual({ command: "git status" })
    expect(Command.parseToolCommandArguments('{"a":1}').ok).toBe(true)
  })

  test("broken JSON is reported as broken JSON, never read as a value", () => {
    const parsed = Command.parseToolCommandArguments('{"command":', bash)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain("not valid JSON")
  })

  test("required parameters take positional values in schema order", () => {
    expect(args("ses_x hello there", notify)).toEqual({ session: "ses_x", text: "hello there" })
  })

  test("multiple required positionals return rather than throwing - a throw here becomes an opaque 500", () => {
    expect(() => Command.parseToolCommandArguments("anything at all", notify)).not.toThrow()
    expect(Command.parseToolCommandArguments("anything at all", notify).ok).toBe(true)
  })

  test("with no parameters known it says arguments must be JSON", () => {
    const parsed = Command.parseToolCommandArguments("git status")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain("written as JSON")
  })
})

describe("reading parameters off a tool's JSON Schema", () => {
  test("takes names, the required list and types", () => {
    expect(
      Command.toolParamsFromJsonSchema({
        type: "object",
        properties: { command: { type: "string" }, timeout: { type: "number" } },
        required: ["command"],
      }),
    ).toEqual([
      { name: "command", required: true, type: "string" },
      { name: "timeout", required: false, type: "number" },
    ])
  })

  test("reads a nullable field as its one real type", () => {
    expect(
      Command.toolParamsFromJsonSchema({
        properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] } },
      }),
    ).toEqual([{ name: "a", required: false, type: "string" }])
  })

  test("survives a schema with nothing in it", () => {
    expect(Command.toolParamsFromJsonSchema(undefined)).toEqual([])
    expect(Command.toolParamsFromJsonSchema({ type: "object" })).toEqual([])
  })
})

describe("the usage shown when arguments could not be read", () => {
  test("offers all three spellings when there is an obvious positional", () => {
    const usage = Command.toolCommandUsage("tool-bash", [
      { name: "command", required: true, type: "string" },
      { name: "timeout", required: false, type: "number" },
    ])
    expect(usage).toContain("/tool-bash [--hide] command=…")
    expect(usage).toContain("/tool-bash [--hide] <command>")
    expect(usage).toContain(`/tool-bash [--hide] {"command":"…"}`)
    expect(usage).toContain("command, [timeout]")
  })

  test("falls back to JSON when the tool's parameters are unknown", () => {
    expect(Command.toolCommandUsage("tool-bash")).toBe(`usage: /tool-bash [--hide] {"key":"value"}`)
  })
})

describe("the one line a / menu shows", () => {
  test("first sentence only - a tool description is written for a model", () => {
    expect(Command.toolCommandDescription("Runs a command. And then a great deal more.")).toBe("Runs a command")
  })

  test("whitespace is collapsed", () => {
    expect(Command.toolCommandDescription("Runs\n\ta command. More.")).toBe("Runs a command")
  })

  test("an enormous first sentence is capped", () => {
    const out = Command.toolCommandDescription("x".repeat(300), 40)
    expect(out.length).toBe(40)
  })

  test("a tool with no description does not produce junk", () => {
    expect(Command.toolCommandDescription(undefined)).toBe("")
  })
})

describe("parsing what was typed after a tool command", () => {
  test("nothing means no arguments, visible to the model", () => {
    expect(Command.parseToolCommandArguments("")).toEqual({ ok: true, hidden: false, args: {} })
  })

  test("a JSON object becomes the tool's arguments", () => {
    expect(Command.parseToolCommandArguments('{"command":"git status"}')).toEqual({
      ok: true,
      hidden: false,
      args: { command: "git status" },
    })
  })

  test("--hide keeps the output out of the model's context", () => {
    expect(Command.parseToolCommandArguments('--hide {"a":1}')).toEqual({ ok: true, hidden: true, args: { a: 1 } })
    expect(Command.parseToolCommandArguments("--hide")).toEqual({ ok: true, hidden: true, args: {} })
  })

  test("--show says the default out loud, and the last flag wins", () => {
    expect(Command.parseToolCommandArguments("--hide --show {}")).toMatchObject({ hidden: false })
    expect(Command.parseToolCommandArguments("--show --hide {}")).toMatchObject({ hidden: true })
  })

  test("a --hide inside the JSON is not the flag", () => {
    expect(Command.parseToolCommandArguments('{"command":"echo --hide"}')).toMatchObject({
      hidden: false,
      args: { command: "echo --hide" },
    })
  })

  test("bad input returns a reason rather than throwing - a throw here becomes an opaque Die", () => {
    const result = Command.parseToolCommandArguments("git status")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("written as JSON")
  })

  test("a leading brace is read as JSON, and a broken one says so rather than being taken as a value", () => {
    expect(Command.parseToolCommandArguments("{}", []).ok).toBe(true)
    const broken = Command.parseToolCommandArguments("{ ", [])
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.error).toContain("not valid JSON")
  })
})

describe("how a run reads in the transcript", () => {
  test("names the tool, its arguments and its output", () => {
    expect(
      Command.formatToolCommandResult({ tool: "bash", args: { command: "echo hi" }, output: "hi\n" }),
    ).toBe('[tool: bash] args={"command":"echo hi"}\n----\nhi\n----')
  })
})
