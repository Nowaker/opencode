import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { Command } from "@/command"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(
  AppNodeBuilderV1.build(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      Command.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)

const setup = Effect.gen(function* () {
  const instance = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* Effect.promise(() =>
    Bun.write(
      path.join(instance.directory, "opencode.json"),
      JSON.stringify({
        model: "test/test-model",
        provider: {
          test: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: llm.url, apiKey: "fixture" },
            models: {
              "test-model": {
                name: "Fixture",
                limit: { context: 100000, output: 1000 },
                cost: { input: 0, output: 0 },
              },
            },
          },
        },
        command: {
          note: { template: "record $ARGUMENTS", native: true },
          reply: { template: "record $ARGUMENTS" },
          invalid: { template: "delegate", native: true, subtask: true },
          bash: { template: "custom bash", native: true },
        },
      }),
    ),
  )
  yield* llm.text("unexpected model reply")
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Native command fixture" })
  const prompt = yield* SessionPrompt.Service
  return { instance, llm, sessions, chat, prompt }
})

it.instance("native templates persist user content without a provider turn", () =>
  Effect.gen(function* () {
    // Given a native command with a template and a real isolated provider.
    const f = yield* setup
    // When the user invokes it.
    const result = yield* f.prompt.command({ sessionID: f.chat.id, command: "note", arguments: "fixture" })
    // Then only the expanded user message is persisted, with no model call.
    expect(result.info.role).toBe("user")
    expect(result.parts).toContainEqual(expect.objectContaining({ type: "text", text: "record fixture" }))
    expect((yield* f.sessions.messages({ sessionID: f.chat.id })).map((message) => message.info.role)).toEqual(["user"])
    expect(yield* f.llm.calls).toBe(0)
  }),
)

it.instance("generated tool commands execute a real tool without a provider turn", () =>
  Effect.gen(function* () {
    // Given a file and the auto-registered read tool command.
    const f = yield* setup
    const file = path.join(f.instance.directory, "fixture.txt")
    yield* Effect.promise(() => Bun.write(file, "native file contents"))
    // When the user supplies a friendly positional argument.
    const result = yield* Effect.raceFirst(
      f.prompt.command({ sessionID: f.chat.id, command: "tool-read", arguments: file }),
      Effect.gen(function* () {
        yield* f.llm.wait(1)
        expect(yield* f.llm.calls).toBe(0)
        return yield* Effect.never
      }),
    )
    // Then the real read output is persisted without invoking the provider.
    expect(result.info.role).toBe("user")
    expect(result.parts).toContainEqual(
      expect.objectContaining({ type: "text", text: expect.stringContaining("native file contents") }),
    )
    expect(yield* f.llm.calls).toBe(0)
  }),
)

it.instance("ordinary commands still dispatch a provider turn and return its reply", () =>
  Effect.gen(function* () {
    // Given an ordinary command against the isolated provider fixture.
    const f = yield* setup
    // When the command is invoked without the native flag.
    const result = yield* f.prompt.command({ sessionID: f.chat.id, command: "reply", arguments: "fixture" })
    // Then the model reply is returned and its request was sent exactly once.
    expect(result.info.role).toBe("assistant")
    expect(result.parts).toContainEqual(expect.objectContaining({ type: "text", text: "unexpected model reply" }))
    expect(yield* f.llm.calls).toBe(1)
  }),
)

it.instance("hidden tool output is excluded from subsequent model history", () =>
  Effect.gen(function* () {
    // Given a file whose contents must be hidden from a later model turn.
    const f = yield* setup
    const file = path.join(f.instance.directory, "hidden.txt")
    yield* Effect.promise(() => Bun.write(file, "private-fixture-content"))
    // When the hidden command is followed by an ordinary user prompt.
    yield* f.prompt.command({ sessionID: f.chat.id, command: "tool-read", arguments: `--hide ${file}` })
    yield* f.prompt.prompt({ sessionID: f.chat.id, parts: [{ type: "text", text: "continue" }] })
    // Then the provider receives the ordinary prompt, but not the hidden output.
    const inputs = yield* f.llm.inputs
    expect(inputs.length).toBeGreaterThan(0)
    expect(JSON.stringify(inputs.at(-1)?.messages)).not.toContain("private-fixture-content")
  }),
)

it.instance("malformed tool arguments persist an error without executing the tool", () =>
  Effect.gen(function* () {
    const f = yield* setup
    // When malformed JSON is supplied to the generated command.
    const result = yield* f.prompt.command({ sessionID: f.chat.id, command: "tool-read", arguments: "{" })
    // Then the error is visible in the transcript rather than a failed provider turn.
    expect(result.info.role).toBe("user")
    expect(result.parts).toContainEqual(
      expect.objectContaining({ type: "text", text: expect.stringContaining("not valid JSON") }),
    )
    expect(yield* f.llm.calls).toBe(0)
  }),
)

it.instance("native subtask commands reject before creating an unusable user message", () =>
  Effect.gen(function* () {
    const f = yield* setup
    // When a native command also requests a subtask.
    const result = yield* f.prompt
      .command({ sessionID: f.chat.id, command: "invalid", arguments: "" })
      .pipe(Effect.exit)
    // Then the invalid combination fails without dispatch or transcript mutation.
    expect(result._tag).toBe("Failure")
    expect(yield* f.sessions.messages({ sessionID: f.chat.id })).toEqual([])
    expect(yield* f.llm.calls).toBe(0)
  }),
)

it.instance("an existing bare command suppresses duplicate generated tool registration", () =>
  Effect.gen(function* () {
    yield* setup
    const commands = yield* Command.Service
    // When the menu is read after a custom bare bash command was configured.
    const menu = yield* commands.list()
    // Then the custom command is retained without a second spelling for its tool.
    expect(menu.find((command) => command.name === "bash")?.source).toBe("command")
    expect(menu.some((command) => command.name === "tool-bash")).toBe(false)
  }),
)
