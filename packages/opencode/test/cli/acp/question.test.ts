import { describe, expect } from "bun:test"
import type { CreateElicitationRequest, PromptResponse } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"
import { expectOk } from "./acp-test-client"
import { createAcpClient, initialize, newSession, verifierConfig } from "./helpers"

const questions = [
  {
    question: "Which database?",
    header: "Database",
    options: [
      { label: "Postgres", description: "Relational" },
      { label: "SQLite", description: "Embedded" },
    ],
  },
]

describe("opencode acp question subprocess", () => {
  cliIt.live(
    "asks the client to answer a question tool call and continues the turn",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const forms: CreateElicitationRequest[] = []
        const acp = yield* createAcpClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
          {
            "elicitation/create": (params) => {
              forms.push(params as CreateElicitationRequest)
              return { action: "accept", content: { q0: "SQLite" } }
            },
          },
        )
        yield* initialize(acp, { elicitation: { form: {} } })
        const session = yield* newSession(acp, home)

        yield* llm.tool("question", { questions })
        yield* llm.text("going with SQLite")

        const result = expectOk(
          yield* acp.request<PromptResponse>("session/prompt", {
            sessionId: session.sessionId,
            prompt: [{ type: "text", text: "pick a database" }],
          }),
        )

        expect(result.stopReason).toBe("end_turn")
        expect(forms).toHaveLength(1)
        expect(forms[0]).toMatchObject({
          mode: "form",
          sessionId: session.sessionId,
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

        // The answer is only proven delivered once the model sees it: the tool
        // result carrying the chosen label has to appear in a later request body.
        const answered = (yield* llm.inputs)
          .map((body) => JSON.stringify(body))
          .filter((body) => body.includes("has answered your questions"))
        expect(answered).toHaveLength(1)
        expect(answered[0]).toContain("SQLite")
        expect(answered[0]).not.toContain("Unanswered")
      }),
    60_000,
  )

  cliIt.live(
    "offers the question tool only when the client can answer one",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const withForms = yield* createAcpClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
          { "elicitation/create": () => ({ action: "decline" }) },
        )
        yield* initialize(withForms, { elicitation: { form: {} } })
        const capable = yield* newSession(withForms, home)
        yield* llm.text("capable")
        expectOk(
          yield* withForms.request<PromptResponse>("session/prompt", {
            sessionId: capable.sessionId,
            prompt: [{ type: "text", text: "hello" }],
          }),
        )
        expect(offeredTools(yield* llm.inputs)).toContain("question")

        yield* llm.reset
        const withoutForms = yield* createAcpClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        yield* initialize(withoutForms)
        const incapable = yield* newSession(withoutForms, home)
        yield* llm.text("incapable")
        expectOk(
          yield* withoutForms.request<PromptResponse>("session/prompt", {
            sessionId: incapable.sessionId,
            prompt: [{ type: "text", text: "hello" }],
          }),
        )
        expect(offeredTools(yield* llm.inputs)).not.toContain("question")
      }),
    60_000,
  )

  cliIt.live(
    "reports a declined question to the agent instead of hanging the turn",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
          { "elicitation/create": () => ({ action: "decline" }) },
        )
        yield* initialize(acp, { elicitation: { form: {} } })
        const session = yield* newSession(acp, home)

        yield* llm.tool("question", { questions })

        const result = expectOk(
          yield* acp.request<PromptResponse>("session/prompt", {
            sessionId: session.sessionId,
            prompt: [{ type: "text", text: "pick a database" }],
          }),
        )

        expect(result.stopReason).toBeDefined()
        expect(acp.handled().filter((item) => item.method === "elicitation/create")).toHaveLength(1)
      }),
    60_000,
  )
})

function offeredTools(inputs: ReadonlyArray<Record<string, unknown>>) {
  return inputs.flatMap((body) => {
    if (!Array.isArray(body["tools"])) return []
    return body["tools"].flatMap((tool) => {
      const fn = tool && typeof tool === "object" && "function" in tool ? tool.function : undefined
      const name = fn && typeof fn === "object" && "name" in fn ? fn.name : undefined
      return typeof name === "string" ? [name] : []
    })
  })
}
