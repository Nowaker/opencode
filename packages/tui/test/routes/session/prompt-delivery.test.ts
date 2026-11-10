import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2"
import { promptDeliveries } from "../../../src/routes/session/prompt-delivery"

const sessionID = "ses_test"

function user(id: string): Message {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  }
}

function assistant(id: string, parentID: string, finish?: string): Message {
  return {
    id,
    sessionID,
    role: "assistant",
    time: finish ? { created: 0, completed: 1 } : { created: 0 },
    parentID,
    modelID: "test",
    providerID: "test",
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish,
  }
}

const states = (messages: Message[], busy: boolean) => Object.fromEntries(promptDeliveries(messages, busy))

describe("promptDeliveries", () => {
  test("a prompt sent while a step streams is queued until a step reads it", () => {
    expect(states([user("p"), assistant("a1", "p"), user("q")], true)).toEqual({ q: "queued" })
  })

  test("a prompt read by the next step after tool calls was read mid-turn", () => {
    const messages = [user("p"), assistant("a1", "p", "tool-calls"), user("q"), assistant("a2", "q")]
    expect(states(messages, true)).toEqual({ q: "mid-turn" })
  })

  test("two prompts read at the same tool boundary were both read mid-turn", () => {
    const messages = [user("p"), assistant("a1", "p", "tool-calls"), user("q1"), user("q2"), assistant("a2", "q2")]
    expect(states(messages, true)).toEqual({ q1: "mid-turn", q2: "mid-turn" })
  })

  test("a prompt the turn steps past stays queued, and is not mid-turn once the next turn reads it", () => {
    const held = [user("p"), assistant("a1", "p", "tool-calls"), user("q"), assistant("a2", "p")]
    expect(states(held, true)).toEqual({ q: "queued" })
    expect(states([...held.slice(0, 3), assistant("a2", "p", "stop"), assistant("a3", "q", "stop")], false)).toEqual(
      {},
    )
  })

  test("a prompt answered after the turn's final answer was not read mid-turn", () => {
    const messages = [user("p"), assistant("a1", "p", "stop"), user("q"), assistant("a2", "q", "stop")]
    expect(states(messages, false)).toEqual({})
  })

  test("the prompt that starts a turn is never queued, and nothing is queued while idle", () => {
    expect(states([user("p"), assistant("a1", "p", "stop"), user("q")], true)).toEqual({})
    expect(states([user("p"), assistant("a1", "p"), user("q")], false)).toEqual({})
  })
})
