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
    if (!result.ok) expect(result.error).toContain("expected a JSON object")
  })

  test("an array or a scalar is refused, naming which it got", () => {
    const arr = Command.parseToolCommandArguments("[1]")
    expect(arr.ok).toBe(false)
    if (!arr.ok) expect(arr.error).toContain("array")
    const num = Command.parseToolCommandArguments("42")
    expect(num.ok).toBe(false)
    if (!num.ok) expect(num.error).toContain("number")
  })
})

describe("how a run reads in the transcript", () => {
  test("names the tool, its arguments and its output", () => {
    expect(
      Command.formatToolCommandResult({ tool: "bash", args: { command: "echo hi" }, output: "hi\n" }),
    ).toBe('[tool: bash] args={"command":"echo hi"}\n----\nhi\n----')
  })
})
