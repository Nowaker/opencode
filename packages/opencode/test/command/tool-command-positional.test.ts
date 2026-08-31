import { describe, expect, test } from "bun:test"
import { Command } from "@/command"

describe("required positional tool arguments", () => {
  const prompt: Command.ToolParam[] = [
    { name: "session", required: true, type: "string" },
    { name: "prompt", required: true, type: "string" },
    { name: "notify_on_finish", required: false, type: "string" },
  ]

  const transfer: Command.ToolParam[] = [
    { name: "source", required: true, type: "string" },
    { name: "attempts", required: true, type: "number" },
    { name: "enabled", required: true, type: "boolean" },
  ]

  function args(raw: string, params: Command.ToolParam[]) {
    const parsed = Command.parseToolCommandArguments(raw, params)
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.args
  }

  test("binds every required parameter in schema order and lets the last consume spaces", () => {
    expect(args("ses_target continue with the rollout", prompt)).toEqual({
      session: "ses_target",
      prompt: "continue with the rollout",
    })
  })

  test("keeps independently quoted positional values whole", () => {
    expect(args(`"ses target" "continue carefully"`, prompt)).toEqual({
      session: "ses target",
      prompt: "continue carefully",
    })
  })

  test("skips a required parameter that was supplied by name", () => {
    expect(args("continue now session=ses_target", prompt)).toEqual({
      session: "ses_target",
      prompt: "continue now",
    })
  })

  test("keeps named optional arguments after the required positionals", () => {
    expect(args(`ses_target "continue now" notify_on_finish=self`, prompt)).toEqual({
      session: "ses_target",
      prompt: "continue now",
      notify_on_finish: "self",
    })
  })

  test("coerces each positional value with its own schema type", () => {
    expect(args("origin 3 true", transfer)).toEqual({ source: "origin", attempts: 3, enabled: true })
  })

  test("shows every required positional parameter in usage", () => {
    expect(Command.toolCommandUsage("tool-vibeterm-prompt-session", prompt)).toContain(
      "/tool-vibeterm-prompt-session [--hide] <session> <prompt>",
    )
  })
})
