import { createStore, produce, unwrap } from "solid-js/store"
import { onCleanup } from "solid-js"
import { createSimpleContext } from "../context/helper"
import { useSDK } from "../context/sdk"
import { useEvent } from "../context/event"
import { errorMessage } from "../util/error"
import type { PromptInfo } from "./history"

/*
 * A submitted prompt is held here, with the draft it came from, until the
 * server has stored it. The composer clears at once, as before, but nothing is
 * lost if admission fails.
 *
 * Every submission carries a client-generated message ID, and its leading text
 * parts carry client-generated part IDs. The server upserts messages and parts
 * by ID, so sending the same submission twice stores it once. Admission is
 * acknowledged by the message's text part arriving over the event stream, or
 * by finding it with a lookup by ID; the prompt request itself only returns
 * when the whole turn ends.
 *
 * When the request fails, the message is looked up by ID before anything else:
 *  - found with its text part: it was stored, so the error is not a send
 *    failure and the entry is dropped.
 *  - missing, after the server itself answered: definitely not stored. The
 *    entry becomes "rejected" and the composer takes the draft back.
 *  - missing after a transport or gateway error, or the lookup failed: the
 *    server may still store it. The entry becomes "unknown", is looked up
 *    again periodically, and can be resent; a resend looks it up first and
 *    reuses the same IDs, so it cannot create a second message.
 */

export type Admission<Body> = {
  messageID: string
  sessionID: string
  textPartID: string
  prompt: PromptInfo
  body: Body
  state: "sending" | "checking" | "unknown" | "rejected"
  slow: boolean
  error?: string
}

export type AdmissionSend =
  | { type: "ok" }
  | { type: "rejected"; message: string }
  | { type: "ambiguous"; message: string }

export type AdmissionLookup =
  | { type: "found"; partIDs: string[] }
  | { type: "missing" }
  | { type: "error"; message: string }

export type AdmissionIO<Body> = {
  send(body: Body): Promise<AdmissionSend>
  lookup(sessionID: string, messageID: string): Promise<AdmissionLookup>
  pollMs?: number
  pollLimit?: number
  slowMs?: number
}

export function createPromptAdmission<Body>(io: AdmissionIO<Body>) {
  const [store, setStore] = createStore({ entries: [] as Admission<Body>[] })
  const timers = new Set<ReturnType<typeof setTimeout>>()
  // Each send or ambiguous outcome starts a fresh lookup chain and retires the previous one.
  const chains = new Map<string, number>()

  const find = (messageID: string) => store.entries.find((entry) => entry.messageID === messageID)
  const update = (messageID: string, patch: Partial<Admission<Body>>) =>
    setStore("entries", (entry) => entry.messageID === messageID, patch)
  const remove = (messageID: string) => {
    chains.delete(messageID)
    setStore("entries", (entries) => entries.filter((entry) => entry.messageID !== messageID))
  }
  const later = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, ms)
    timers.add(timer)
  }

  async function attempt(messageID: string) {
    const entry = find(messageID)
    if (!entry) return
    update(messageID, { state: "sending", slow: false, error: undefined })
    later(io.slowMs ?? 400, () => {
      if (find(messageID)?.state === "sending") update(messageID, { slow: true })
    })
    watch(messageID, 0)
    const result = await io.send(entry.body)
    if (!find(messageID)) return
    if (result.type === "ok") return remove(messageID)
    await reconcile(messageID, result)
  }

  async function reconcile(messageID: string, cause: Exclude<AdmissionSend, { type: "ok" }>) {
    const entry = find(messageID)
    if (!entry) return
    update(messageID, { state: "checking", error: cause.message })
    const found = await io.lookup(entry.sessionID, messageID)
    if (!find(messageID)) return
    if (found.type === "found" && found.partIDs.includes(entry.textPartID)) return remove(messageID)
    if (found.type === "found")
      return update(messageID, { state: "rejected", error: `${cause.message} (only partly saved)` })
    if (found.type === "missing" && cause.type === "rejected") return update(messageID, { state: "rejected" })
    update(messageID, { state: "unknown" })
    watch(messageID, 0)
  }

  // Looks a pending submission up by ID now and then. While it is sending this
  // covers a missed event; once it is unknown, the server can still store it
  // for as long as its database write keeps retrying.
  function watch(messageID: string, count: number, chain = (chains.get(messageID) ?? 0) + 1) {
    chains.set(messageID, chain)
    if (count >= (io.pollLimit ?? 24)) return
    later(io.pollMs ?? 5000, async () => {
      const current = () => chains.get(messageID) === chain && find(messageID)
      const entry = current()
      if (!entry || (entry.state !== "unknown" && entry.state !== "sending")) return
      const found = await io.lookup(entry.sessionID, messageID)
      if (!current()) return
      if (found.type === "found" && found.partIDs.includes(entry.textPartID)) return remove(messageID)
      watch(messageID, count + 1, chain)
    })
  }

  onCleanup(() => timers.forEach((timer) => clearTimeout(timer)))

  return {
    entries(sessionID?: string) {
      if (!sessionID) return store.entries
      return store.entries.filter((entry) => entry.sessionID === sessionID)
    },
    submit(entry: Pick<Admission<Body>, "messageID" | "sessionID" | "textPartID" | "prompt" | "body">) {
      setStore(
        produce((draft) => {
          draft.entries.push({ ...entry, state: "sending", slow: false })
        }),
      )
      void attempt(entry.messageID)
    },
    /** The server published the message's text part: it is stored. */
    acknowledge(messageID: string, partID: string) {
      if (find(messageID)?.textPartID === partID) remove(messageID)
    },
    /** Look the submission up by ID, and send it again with the same IDs only if it is not there. */
    async resend(messageID: string) {
      const entry = find(messageID)
      if (entry?.state !== "unknown") return
      update(messageID, { state: "checking" })
      const found = await io.lookup(entry.sessionID, messageID)
      if (!find(messageID)) return
      if (found.type === "found" && found.partIDs.includes(entry.textPartID)) return remove(messageID)
      if (found.type === "error") return update(messageID, { state: "unknown", error: found.message })
      await attempt(messageID)
    },
    /** Stop tracking a submission and hand its draft back. */
    release(messageID: string) {
      const entry = find(messageID)
      if (!entry) return
      const prompt = structuredClone(unwrap(entry.prompt))
      remove(messageID)
      return prompt
    },
  }
}

export const { use: usePromptAdmission, provider: PromptAdmissionProvider } = createSimpleContext({
  name: "PromptAdmission",
  init: () => {
    const sdk = useSDK()
    const event = useEvent()
    type Body = Parameters<typeof sdk.client.session.prompt>[0]
    const admission = createPromptAdmission<Body>({
      async send(body) {
        const result = await sdk.client.session.prompt(body).catch((error: unknown) => ({ thrown: error }))
        if ("thrown" in result) return { type: "ambiguous", message: errorMessage(result.thrown) }
        if (!result.error) return { type: "ok" }
        const message = errorMessage(result.error)
        // A gateway error or a missing response says nothing about whether the
        // server stored the prompt; any other status is the server's own answer.
        const status = result.response?.status
        if (!status || status === 502 || status === 503 || status === 504) return { type: "ambiguous", message }
        return { type: "rejected", message }
      },
      async lookup(sessionID, messageID) {
        const result = await sdk.client.session
          .message({ sessionID, messageID })
          .catch((error: unknown) => ({ thrown: error }))
        if ("thrown" in result) return { type: "error", message: errorMessage(result.thrown) }
        if (result.data) return { type: "found", partIDs: result.data.parts.map((part) => part.id) }
        if (result.response?.status === 404) return { type: "missing" }
        return { type: "error", message: errorMessage(result.error) }
      },
    })
    onCleanup(
      event.on("message.part.updated", (evt) =>
        admission.acknowledge(evt.properties.part.messageID, evt.properties.part.id),
      ),
    )
    return admission
  },
})
