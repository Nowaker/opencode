import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import {
  DeliveryLabel,
  LATER_WAKE_DELAY_MS,
  deliveryBadge,
  inboxWake,
  promptDeliveries,
  type InboxWake,
} from "../../../src/routes/session/prompt-delivery"

const sessionID = "ses_test"

function user(id: string, created = 0): Message {
  return {
    id,
    sessionID,
    role: "user",
    time: { created },
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

const deliveries = (
  messages: Message[],
  busy: boolean,
  options: { paused?: boolean; inbox?: Record<string, InboxWake> } = {},
) =>
  promptDeliveries(messages, {
    busy,
    paused: options.paused ?? false,
    inbox: (messageID) => options.inbox?.[messageID],
  })

const states = (messages: Message[], busy: boolean, options: Parameters<typeof deliveries>[2] = {}) =>
  Object.fromEntries([...deliveries(messages, busy, options)].map(([id, delivery]) => [id, delivery.state]))

function text(body: string): Part {
  return { id: "prt_1", sessionID, messageID: "msg_1", type: "text", text: body }
}

const delivered = (fields: string[]) =>
  text(["[vibeterm_metadata]", "call: vibeterm_prompt_session", ...fields, "[/vibeterm_metadata]", "", "---", "", "body"].join("\n"))

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

  test("a prompt held while the session is paused reads PAUSED, busy or idle", () => {
    const busy = [user("p"), assistant("a1", "p"), user("q")]
    expect(states(busy, true, { paused: true })).toEqual({ q: "paused" })
    const stopped = [user("p"), assistant("a1", "p", "tool-calls"), user("q1"), user("q2")]
    expect(states(stopped, false, { paused: true })).toEqual({ q1: "paused", q2: "paused" })
  })

  test("a paused session's read prompts carry no badge", () => {
    const messages = [user("p"), assistant("a1", "p", "stop"), user("q"), assistant("a2", "q", "stop")]
    expect(states(messages, false, { paused: true })).toEqual({})
  })

  test("a note that starts no turn reads INBOX until a step reads it, busy, idle or paused", () => {
    const inbox = { q: "never" as const }
    expect(states([user("p"), assistant("a1", "p", "stop"), user("q")], false, { inbox })).toEqual({ q: "inbox" })
    expect(states([user("p"), assistant("a1", "p"), user("q")], true, { inbox })).toEqual({ q: "inbox" })
    expect(states([user("p"), assistant("a1", "p", "stop"), user("q")], false, { inbox, paused: true })).toEqual({
      q: "inbox",
    })
    const read = [user("p"), assistant("a1", "p", "stop"), user("q"), assistant("a2", "q", "stop")]
    expect(states(read, false, { inbox })).toEqual({})
    const readMidTurn = [user("p"), assistant("a1", "p", "tool-calls"), user("q"), assistant("a2", "q", "stop")]
    expect(states(readMidTurn, false, { inbox })).toEqual({ q: "mid-turn" })
  })

  test("a wake=later note wakes 30 minutes after the earliest unread wake=later note, and not while paused", () => {
    const messages = [user("p"), assistant("a1", "p", "stop"), user("q1", 1_000), user("q2", 5_000), user("q3", 9_000)]
    const inbox = { q1: "never" as const, q2: "later" as const, q3: "later" as const }
    const result = deliveries(messages, false, { inbox })
    expect(result.get("q1")).toEqual({ state: "inbox" })
    expect(result.get("q2")).toEqual({ state: "inbox", wakesAt: 5_000 + LATER_WAKE_DELAY_MS })
    expect(result.get("q3")).toEqual({ state: "inbox", wakesAt: 5_000 + LATER_WAKE_DELAY_MS })
    expect(deliveries(messages, false, { inbox, paused: true }).get("q2")).toEqual({ state: "inbox" })
  })
})

describe("inboxWake", () => {
  test("reads the wake a Vibeterm delivery asked for", () => {
    expect(inboxWake([delivered(["wake: never"])])).toBe("never")
    expect(inboxWake([delivered(["wake: later"])])).toBe("later")
    expect(inboxWake([delivered(["delivery: queued without starting a turn - you read it at the next tool step"])])).toBe(
      "never",
    )
  })

  test("a typed prompt, a wake=now delivery or a question answer starts a turn", () => {
    expect(inboxWake([text("plain prompt")])).toBeUndefined()
    expect(inboxWake([delivered(["effect: delivered as a user message"])])).toBeUndefined()
    expect(inboxWake([delivered(["delivery: delivered, and a turn was started so you would read it now"])])).toBeUndefined()
    expect(inboxWake([delivered(["continuation_dispatch: {}"])])).toBeUndefined()
  })
})

describe("deliveryBadge", () => {
  const time = (at: number) => `t${at}`
  test("each state reads its label, and a wake=later note names its wake", () => {
    expect(deliveryBadge({ state: "queued" }, time)).toBe(DeliveryLabel.queued)
    expect(deliveryBadge({ state: "paused" }, time)).toBe(DeliveryLabel.paused)
    expect(deliveryBadge({ state: "inbox" }, time)).toBe(DeliveryLabel.inbox)
    expect(deliveryBadge({ state: "inbox", wakesAt: 42 }, time)).toBe(`${DeliveryLabel.inbox} - wakes t42`)
    expect(deliveryBadge({ state: "mid-turn" }, time)).toBeUndefined()
  })
})
