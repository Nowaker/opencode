import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createPromptAdmission, type AdmissionLookup, type AdmissionSend } from "../../src/prompt/admission"

type Body = { messageID: string; textPartID: string; text: string }

// A server that stores messages by ID the way the session projector does: a second write with the same IDs
// replaces the first one instead of adding another.
function createServer() {
  const messages = new Map<string, string[]>()
  const sends: Body[] = []
  const behaviors: ((body: Body) => Promise<AdmissionSend>)[] = []
  const lookups: (() => Promise<AdmissionLookup> | undefined)[] = []
  const store = (body: Body) => messages.set(body.messageID, [body.textPartID])
  return {
    messages,
    sends,
    /** Next send stores the message and answers ok. */
    accept: () => behaviors.push(async (body) => (store(body), { type: "ok" })),
    /** Next send stores nothing; the server answers with an error. */
    reject: (message = "database is locked") => behaviors.push(async () => ({ type: "rejected", message })),
    /** Next send is stored, but the response is lost on the way back. */
    lose: () => behaviors.push(async (body) => (store(body), { type: "ambiguous", message: "bad gateway" })),
    /** Next send never reaches the server, and nothing comes back. */
    drop: () => behaviors.push(async () => ({ type: "ambiguous", message: "connection reset" })),
    /** Next send stores the message but not its text part, then fails. */
    partial: () =>
      behaviors.push(async (body) => (messages.set(body.messageID, []), { type: "rejected", message: "locked" })),
    /** Next send stays in flight until released. */
    hold: () => {
      const gate = Promise.withResolvers<AdmissionSend>()
      behaviors.push(async (body) => {
        const result = await gate.promise
        if (result.type === "ok") store(body)
        return result
      })
      return gate
    },
    /** Next lookup fails, as if the server were unreachable. */
    unreachable: () => lookups.push(async () => ({ type: "error", message: "connection refused" })),
    store,
    io: {
      pollMs: 10,
      pollLimit: 50,
      slowMs: 5,
      async send(body: Body) {
        sends.push(body)
        const next = behaviors.shift()
        if (!next) throw new Error("unexpected send")
        return next(body)
      },
      async lookup(_sessionID: string, messageID: string): Promise<AdmissionLookup> {
        const override = lookups.shift()?.()
        if (override) return override
        const parts = messages.get(messageID)
        return parts ? { type: "found", partIDs: parts } : { type: "missing" }
      },
    },
  }
}

function setup() {
  const server = createServer()
  const { admission, dispose } = createRoot((dispose) => ({ admission: createPromptAdmission(server.io), dispose }))
  let count = 0
  const submit = (text: string) => {
    count += 1
    const messageID = `msg_${count}`
    const body = { messageID, textPartID: `prt_${count}`, text }
    admission.submit({
      messageID,
      sessionID: "ses_1",
      textPartID: body.textPartID,
      prompt: { input: text, parts: [], mode: "normal" },
      body,
    })
    return messageID
  }
  const state = (messageID: string) => admission.entries().find((entry) => entry.messageID === messageID)?.state
  return { server, admission, dispose, submit, state }
}

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await Bun.sleep(2)
  }
  throw new Error("condition never held")
}

describe("prompt admission", () => {
  test("an accepted prompt stops being tracked", async () => {
    const t = setup()
    t.server.accept()
    const id = t.submit("hello")
    expect(t.state(id)).toBe("sending")
    await until(() => t.state(id) === undefined)
    expect(t.server.messages.size).toBe(1)
    t.dispose()
  })

  test("the message's text part arriving acknowledges it while the request is still open", async () => {
    const t = setup()
    const gate = t.server.hold()
    const id = t.submit("long turn")
    t.admission.acknowledge(id, "prt_other")
    expect(t.state(id)).toBe("sending")
    t.admission.acknowledge(id, "prt_1")
    expect(t.state(id)).toBeUndefined()
    // A failure reported after admission, e.g. the turn ending badly, is not a failed send.
    gate.resolve({ type: "ambiguous", message: "connection reset" })
    await Bun.sleep(20)
    expect(t.admission.entries()).toHaveLength(0)
    t.dispose()
  })

  test("a definite rejection hands the draft back", async () => {
    const t = setup()
    t.server.reject()
    const id = t.submit("keep me")
    await until(() => t.state(id) === "rejected")
    const entry = t.admission.entries()[0]
    expect(entry.error).toBe("database is locked")
    expect(t.admission.release(id)).toEqual({ input: "keep me", parts: [], mode: "normal" })
    expect(t.admission.entries()).toHaveLength(0)
    expect(t.server.sends).toHaveLength(1)
    t.dispose()
  })

  test("an error after the message was stored is not a rejection", async () => {
    const t = setup()
    t.server.lose()
    const id = t.submit("stored anyway")
    await until(() => t.state(id) === undefined)
    expect(t.server.sends).toHaveLength(1)
    expect(t.server.messages.size).toBe(1)
    t.dispose()
  })

  test("a message stored without its text counts as not sent", async () => {
    const t = setup()
    t.server.partial()
    const id = t.submit("half")
    await until(() => t.state(id) === "rejected")
    expect(t.admission.entries()[0].error).toBe("locked (only partly saved)")
    t.dispose()
  })

  test("an ambiguous failure is reconciled by ID, and a resend reuses the ID", async () => {
    const t = setup()
    t.server.drop()
    t.server.unreachable()
    const id = t.submit("did it land?")
    await until(() => t.state(id) === "unknown")

    t.server.lose()
    await t.admission.resend(id)
    await until(() => t.state(id) === undefined)
    expect(t.server.sends.map((body) => body.messageID)).toEqual([id, id])
    expect(t.server.messages.size).toBe(1)
    t.dispose()
  })

  test("a resend that finds the message already stored sends nothing", async () => {
    const t = setup()
    t.server.drop()
    t.server.unreachable()
    const id = t.submit("landed late")
    await until(() => t.state(id) === "unknown")
    t.server.store(t.server.sends[0])
    await t.admission.resend(id)
    expect(t.state(id)).toBeUndefined()
    expect(t.server.sends).toHaveLength(1)
    t.dispose()
  })

  test("a resend does not send when the lookup cannot reach the server", async () => {
    const t = setup()
    t.server.drop()
    t.server.unreachable()
    const id = t.submit("offline")
    await until(() => t.state(id) === "unknown")
    t.server.unreachable()
    await t.admission.resend(id)
    expect(t.state(id)).toBe("unknown")
    expect(t.admission.entries()[0].error).toBe("connection refused")
    expect(t.server.sends).toHaveLength(1)
    t.dispose()
  })

  test("an unknown prompt the server stores later is picked up by polling", async () => {
    const t = setup()
    t.server.drop()
    t.server.unreachable()
    const id = t.submit("slow write")
    await until(() => t.state(id) === "unknown")
    t.server.store(t.server.sends[0])
    await until(() => t.state(id) === undefined)
    expect(t.server.sends).toHaveLength(1)
    t.dispose()
  })

  test("a slow send is marked slow, and a missed event is recovered by lookup", async () => {
    const t = setup()
    const gate = t.server.hold()
    const id = t.submit("no events")
    await until(() => t.admission.entries()[0]?.slow === true)
    t.server.store(t.server.sends[0])
    await until(() => t.state(id) === undefined)
    gate.resolve({ type: "ok" })
    t.dispose()
  })
})
