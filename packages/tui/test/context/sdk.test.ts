import { expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { createEventBatcher, EVENT_BATCH_INTERVAL_MS } from "../../src/context/sdk"

const sessionID = "ses_stream"
const messageID = "msg_stream"
const partID = "prt_stream"

function delta(id: string, text: string): GlobalEvent {
  return {
    directory: "/tmp/opencode",
    project: "proj_test",
    payload: {
      id,
      type: "message.part.delta",
      properties: {
        sessionID,
        messageID,
        partID,
        field: "text",
        delta: text,
      },
    },
  }
}

test("coalesces rapid part deltas until the next render interval", () => {
  let now = 1_000
  let scheduled: { readonly delay: number; readonly run: () => void } | undefined
  const emitted: GlobalEvent[][] = []
  const batcher = createEventBatcher({
    emit: (events) => emitted.push([...events]),
    now: () => now,
    schedule: (run, delay) => {
      scheduled = { delay, run }
      return 1
    },
    cancel: () => {},
  })

  batcher.push(delta("evt_a", "a"))
  now += 20
  batcher.push(delta("evt_b", "b"))
  now += 20
  batcher.push(delta("evt_c", "c"))

  expect(emitted.map((events) => events.map((event) => event.payload))).toEqual([[delta("evt_a", "a").payload]])
  expect(scheduled?.delay).toBe(EVENT_BATCH_INTERVAL_MS - 20)

  now = 1_000 + EVENT_BATCH_INTERVAL_MS
  scheduled?.run()

  expect(emitted.map((events) => events.map((event) => event.payload))).toEqual([
    [delta("evt_a", "a").payload],
    [delta("evt_c", "bc").payload],
  ])
})
