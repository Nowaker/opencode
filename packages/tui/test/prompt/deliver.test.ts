import { expect, test } from "bun:test"
import { createPromptSend } from "../../src/prompt/deliver"

type Input = Parameters<typeof createPromptSend>[0]

function send() {
  const submitted: { body: { parts: unknown[] } }[] = []
  const input = {
    local: {
      agent: { current: () => ({ name: "build" }) },
      model: { current: () => ({ providerID: "p", modelID: "m" }), variant: { current: () => undefined } },
    },
    admission: { submit: (entry: { body: { parts: unknown[] } }) => submitted.push(entry) },
    sync: { session: { get: () => undefined } },
    project: { workspace: { status: () => "connected" } },
  } as unknown as Input
  return { send: createPromptSend(input), submitted }
}

const request = { sessionID: "ses_x", text: "hello", messageID: "msg_x", partID: "prt_x" }

test("stores metadata on the delivered text part", () => {
  const f = send()
  const metadata = { vibeterm: { schema: 1 } }
  expect(f.send({ ...request, metadata })).toEqual({ status: "submitted", messageID: "msg_x", partID: "prt_x" })
  expect(f.submitted[0].body.parts).toEqual([{ id: "prt_x", type: "text", text: "hello", metadata }])
})

test("without metadata the text part is what it always was", () => {
  const f = send()
  f.send(request)
  expect(JSON.stringify(f.submitted[0].body.parts)).toBe(JSON.stringify([{ id: "prt_x", type: "text", text: "hello" }]))
})
