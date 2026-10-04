import { describe, expect, it } from "bun:test"
import type {
  AgentSideConnection,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationAcceptAction,
  SessionUpdate,
} from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, ManagedRuntime } from "effect"
import { ACPCapability } from "@/acp/capability"
import { ACPEvent } from "@/acp/event"
import { ACPSession } from "@/acp/session"

type QuestionEvent = Extract<Event, { type: "question.asked" }>
type QuestionInfo = QuestionEvent["properties"]["questions"][number]
type ReplyParams = Parameters<OpencodeClient["question"]["reply"]>[0]
type RejectParams = Parameters<OpencodeClient["question"]["reject"]>[0]
type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]

const pollUntil = async (check: () => boolean, message: string, timeoutMs = 2000) => {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function makeSessionService() {
  return ManagedRuntime.make(LayerNode.compile(ACPSession.node)).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

function createHarness(
  createElicitation?: (params: CreateElicitationRequest) => Promise<CreateElicitationResponse>,
  advertised = true,
) {
  ACPCapability.setQuestions(advertised)
  const replies: ReplyParams[] = []
  const rejects: RejectParams[] = []
  const requests: CreateElicitationRequest[] = []
  const updates: SessionUpdateParams[] = []
  const session = makeSessionService()
  const sdk = {
    question: {
      reply: (params: ReplyParams) => {
        replies.push(params)
        return Promise.resolve({ data: true })
      },
      reject: (params: RejectParams) => {
        rejects.push(params)
        return Promise.resolve({ data: true })
      },
    },
    session: {
      message: () => Promise.resolve({ data: undefined }),
    },
  } as unknown as OpencodeClient
  const connection = {
    sessionUpdate: (params: SessionUpdateParams) => {
      updates.push(params)
      return Promise.resolve()
    },
    ...(createElicitation
      ? {
          unstable_createElicitation: (params: CreateElicitationRequest) => {
            requests.push(params)
            return createElicitation(params)
          },
        }
      : {}),
  } satisfies Pick<AgentSideConnection, "sessionUpdate"> &
    Partial<Pick<AgentSideConnection, "unstable_createElicitation">>
  const subscription = new ACPEvent.Subscription({ sdk, connection, session })

  return { connection, rejects, replies, requests, sdk, session, subscription, updates }
}

const accept =
  (content: ElicitationAcceptAction["content"]): (() => Promise<CreateElicitationResponse>) =>
  () =>
    Promise.resolve({ action: "accept", content })

function formOf(request: CreateElicitationRequest | undefined) {
  if (!request || request.mode !== "form") throw new Error("expected a form-mode elicitation")
  return request
}

async function createSession(session: ACPSession.Interface, sessionId: string, cwd = "/workspace") {
  await Effect.runPromise(session.create({ id: sessionId, cwd }))
}

function questionAsked(
  sessionID: string,
  id: string,
  input: {
    questions?: QuestionInfo[]
    tool?: { messageID: string; callID: string }
  } = {},
) {
  return {
    id: `evt_${id}`,
    type: "question.asked",
    properties: {
      id,
      sessionID,
      questions: input.questions ?? [
        {
          question: "Which database?",
          header: "Database",
          options: [
            { label: "Postgres", description: "Relational" },
            { label: "SQLite", description: "Embedded" },
          ],
        },
      ],
      ...(input.tool ? { tool: input.tool } : {}),
    },
  } as QuestionEvent
}

describe("acp questions", () => {
  it("asks the client for a form and replies with the selected label", async () => {
    const harness = createHarness(accept({ q0: "SQLite" }))
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(questionAsked("ses_a", "que_1", { tool: { messageID: "msg_1", callID: "call_1" } }))

    await pollUntil(() => harness.replies.length === 1, "question was never replied")

    expect(harness.requests[0]).toMatchObject({
      mode: "form",
      sessionId: "ses_a",
      toolCallId: "call_1",
      message: "Which database?",
      requestedSchema: {
        type: "object",
        required: ["q0"],
        properties: {
          q0: {
            type: "string",
            title: "Database",
            oneOf: [
              { const: "Postgres", title: "Postgres" },
              { const: "SQLite", title: "SQLite" },
            ],
          },
        },
      },
    })
    expect(harness.replies).toEqual([
      { requestID: "que_1", directory: "/workspace", answers: [["SQLite"]] },
    ])
    expect(harness.rejects).toHaveLength(0)
  })

  it("asks every question of one request as a single form", async () => {
    const harness = createHarness(accept({ q0: "Postgres", q1: ["Alpha", "Beta"] }))
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(
      questionAsked("ses_a", "que_multi", {
        questions: [
          {
            question: "Which database?",
            header: "Database",
            options: [
              { label: "Postgres", description: "Relational" },
              { label: "SQLite", description: "Embedded" },
            ],
          },
          {
            question: "Which environments?",
            header: "Environments",
            multiple: true,
            options: [
              { label: "Alpha", description: "First" },
              { label: "Beta", description: "Second" },
            ],
          },
        ],
      }),
    )

    await pollUntil(() => harness.replies.length === 1, "multi question was never replied")

    expect(harness.requests[0]?.message).toBe("Which database?\n\nWhich environments?")
    expect(formOf(harness.requests[0]).requestedSchema.properties?.["q1"]).toMatchObject({
      type: "array",
      title: "Environments",
      items: {
        anyOf: [
          { const: "Alpha", title: "Alpha" },
          { const: "Beta", title: "Beta" },
        ],
      },
    })
    expect(harness.replies[0]?.answers).toEqual([["Postgres"], ["Alpha", "Beta"]])
  })

  it("carries each option's description into the field description", async () => {
    const harness = createHarness(accept({ q0: "Postgres" }))
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(questionAsked("ses_a", "que_desc"))

    await pollUntil(() => harness.replies.length === 1, "question was never replied")

    expect(formOf(harness.requests[0]).requestedSchema.properties?.["q0"]?.description).toBe(
      "Which database?\n- Postgres: Relational\n- SQLite: Embedded",
    )
  })

  it("answers a question the user skipped as unanswered", async () => {
    const harness = createHarness(accept({}))
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(questionAsked("ses_a", "que_skipped"))

    await pollUntil(() => harness.replies.length === 1, "skipped question was never replied")

    expect(harness.replies[0]?.answers).toEqual([[]])
  })

  it("rejects when the user declines the form", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "decline" }))
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(questionAsked("ses_a", "que_declined"))

    await pollUntil(() => harness.rejects.length === 1, "declined question was never rejected")

    expect(harness.rejects[0]).toMatchObject({ requestID: "que_declined", directory: "/workspace" })
    expect(harness.replies).toHaveLength(0)
  })

  it("rejects when the client has no elicitation support", async () => {
    const harness = createHarness()
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(questionAsked("ses_a", "que_unsupported"))

    await pollUntil(() => harness.rejects.length === 1, "unsupported question was never rejected")

    expect(harness.requests).toHaveLength(0)
    expect(harness.rejects[0]).toMatchObject({ requestID: "que_unsupported" })
  })

  it("rejects when the client did not advertise elicitation at initialize", async () => {
    const harness = createHarness(accept({ q0: "SQLite" }), false)
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(questionAsked("ses_a", "que_uncapable"))

    await pollUntil(() => harness.rejects.length === 1, "uncapable question was never rejected")

    expect(harness.requests).toHaveLength(0)
  })

  it("rejects when the client fails the elicitation", async () => {
    const harness = createHarness(() => Promise.reject(new Error("client form failed")))
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(questionAsked("ses_a", "que_failed"))

    await pollUntil(() => harness.rejects.length === 1, "failed question was never rejected")

    expect(harness.rejects[0]).toMatchObject({ requestID: "que_failed" })
  })

  it("serializes question requests per session", async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<CreateElicitationResponse>((resolve) => {
      releaseFirst = () => resolve({ action: "accept", content: { q0: "Postgres" } })
    })
    const harness = createHarness(() =>
      harness.requests.length === 1 ? first : Promise.resolve({ action: "accept", content: { q0: "SQLite" } }),
    )
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(questionAsked("ses_a", "que_1"))
    harness.subscription.handle(questionAsked("ses_a", "que_2"))

    await pollUntil(() => harness.requests.length === 1, "first question was never asked")
    expect(harness.replies).toHaveLength(0)

    releaseFirst?.()
    await pollUntil(() => harness.replies.length === 2, "serialized questions were not both replied")

    expect(harness.replies.map((reply) => [reply.requestID, reply.answers])).toEqual([
      ["que_1", [["Postgres"]]],
      ["que_2", [["SQLite"]]],
    ])
  })

  it("ignores a question for a session this connection does not own", async () => {
    const harness = createHarness(accept({ q0: "SQLite" }))

    harness.subscription.handle(questionAsked("ses_unknown", "que_orphan"))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(harness.requests).toHaveLength(0)
    expect(harness.replies).toHaveLength(0)
    expect(harness.rejects).toHaveLength(0)
  })

  it("does not let a blocked session A question block session B message updates", async () => {
    let release: (() => void) | undefined
    const blocked = new Promise<CreateElicitationResponse>((resolve) => {
      release = () => resolve({ action: "accept", content: { q0: "Postgres" } })
    })
    const harness = createHarness(() => blocked)
    await createSession(harness.session, "ses_a")
    await createSession(harness.session, "ses_b")
    await Effect.runPromise(
      harness.session.recordPartMetadata({
        sessionId: "ses_b",
        messageId: "msg_b",
        partId: "part_b",
        partType: "text",
        role: "assistant",
      }),
    )

    harness.subscription.handle(questionAsked("ses_a", "que_blocked"))
    await pollUntil(() => harness.requests.length === 1, "blocked question was never asked")

    await harness.subscription.handle({
      id: "evt_b",
      type: "message.part.delta",
      properties: {
        sessionID: "ses_b",
        messageID: "msg_b",
        partID: "part_b",
        field: "text",
        delta: "session_b_message",
      },
    } as Event)

    const text = harness.updates
      .filter((item) => item.sessionId === "ses_b")
      .map((item) => item.update)
      .filter((update): update is Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }> => {
        return update.sessionUpdate === "agent_message_chunk"
      })
      .map((update) => (update.content.type === "text" ? update.content.text : ""))
      .join("")
    expect(text).toBe("session_b_message")
    expect(harness.replies).toHaveLength(0)

    release?.()
    await pollUntil(() => harness.replies.length === 1, "blocked question was never replied after release")
  })
})
