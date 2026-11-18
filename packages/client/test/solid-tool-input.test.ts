import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

test("replaces streamed tool input with the authoritative end and parsed call", async () => {
  const sessionID = "ses_tool_input"
  const assistantMessageID = "msg_tool_input"
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (new URL(request.url).pathname !== `/api/session/${sessionID}/message`)
        throw new Error(`Unexpected request: ${request.url}`)
      return Response.json({
        data: [
          {
            id: assistantMessageID,
            type: "assistant",
            agent: "build",
            model: { providerID: "provider", id: "model" },
            time: { created: 1 },
            content: [],
          },
        ],
        cursor: {},
      })
    },
  })
  using setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    [Symbol.dispose]: dispose,
  }))
  const emit = (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event }))
  const part = () => {
    const message = setup.data.session.message.get(sessionID, assistantMessageID)
    if (message?.type !== "assistant") throw new Error("Expected the seeded assistant message")
    const tool = message.content.find((item) => item.type === "tool" && item.id === "call_write")
    if (tool?.type !== "tool") throw new Error("Expected the streamed write tool")
    return tool
  }
  const ref = { sessionID, assistantMessageID, id: "call_write" }
  const input = { path: "target.txt", content: "Hello from the streamed write" }
  const raw = JSON.stringify(input)
  await setup.data.session.message.sync(sessionID)

  emit({
    id: "evt_input_started",
    created: 2,
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    type: "session.tool.input.started",
    data: { ...ref, name: "write" },
  })
  expect(part().state).toEqual({ status: "streaming", input: "" })
  for (const [index, delta] of [raw.slice(0, 5), raw.slice(5, 11), raw.slice(11, -4)].entries())
    emit({
      id: `evt_input_delta_${index}`,
      created: 3 + index,
      type: "session.tool.input.delta",
      data: { ...ref, delta },
    })
  expect(part().state).toEqual({ status: "streaming", input: raw.slice(0, -4) })

  emit({
    id: "evt_input_ended",
    created: 6,
    durable: { aggregateID: sessionID, seq: 2, version: 1 },
    type: "session.tool.input.ended",
    data: { ...ref, text: raw },
  })
  expect(part().state).toEqual({ status: "streaming", input: raw })
  emit({
    id: "evt_tool_called",
    created: 7,
    durable: { aggregateID: sessionID, seq: 3, version: 1 },
    type: "session.tool.called",
    data: { ...ref, input, executed: false },
  })
  expect(part().state).toEqual({ status: "running", input, metadata: {} })
})
