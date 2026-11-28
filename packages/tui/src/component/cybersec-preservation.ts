import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Option, Schema } from "effect"
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { errorMessage } from "../util/error"
import { useEvent } from "../context/event"
import { bodyMessage, settle } from "./prompt/auto-switch"

// Per-session cybersec preservation: which Meridian accounts carry this session's Claude quota.
// The engine owner reads and writes it at `GET`/`PUT /session/{sessionID}/cybersec-preservation`;
// this side shows what the owner acknowledged and asks it for a change.

const Preference = Schema.Literals(["inherit", "on", "off"])
const Status = Schema.Struct({ preference: Preference, revision: NonNegativeInt })

export type CybersecPreference = typeof Preference.Type
export type CybersecStatus = typeof Status.Type

// What one response says. `unconfirmed` means a save may or may not have reached the owner.
export type CybersecReply =
  | { type: "status"; status: CybersecStatus }
  | { type: "unavailable" }
  | { type: "unsupported" }
  | { type: "invalid" }
  | { type: "rejected"; message: string }
  | { type: "unconfirmed"; message: string }

export type CybersecRequest = (sessionID: string, preference?: CybersecPreference) => Promise<CybersecReply>

// A save already sent, with what it asked for, so its answer is applied only to that session and checked against it.
export type CybersecSave = { sessionID: string; preference: CybersecPreference; reply: Promise<CybersecReply> }

const decodeStatus = Schema.decodeUnknownOption(Status)

// The body is decoded here, not trusted from the generated types, so an engine on another contract fails closed.
function interpret(code: number, body: unknown): CybersecReply {
  if (code === 405 || code === 501) return { type: "unsupported" }
  if (code === 503) return { type: "unavailable" }
  if (code >= 200 && code < 300)
    return Option.match(decodeStatus(body), {
      onNone: () => ({ type: "invalid" }),
      onSome: (status) => ({ type: "status", status }),
    })
  if (code >= 400 && code < 500) return { type: "rejected", message: bodyMessage(body) ?? `HTTP ${code}` }
  return { type: "unconfirmed", message: `HTTP ${code}` }
}

// Every request first asks the engine whether it serves the route: an older one can pass the session
// path to a catch-all proxy, so without the capability neither route is ever sent. A redirect is
// refused rather than followed, so a moved route is never read or written somewhere else.
export function cybersecTransport(sdk: { client: OpencodeClient }): CybersecRequest {
  return async (sessionID, preference) => {
    const health = await settle(sdk.client.global.health({ redirect: "error" }))
    if (!health.response) return { type: "rejected", message: `engine unreachable: ${errorMessage(health.error)}` }
    if (!health.response.ok) return { type: "rejected", message: `engine health HTTP ${health.response.status}` }
    if (health.data?.cybersecPreservation !== 1) return { type: "unsupported" }
    const result = await settle(
      preference
        ? sdk.client.session.cybersecPreservation.update({ sessionID, preference }, { redirect: "error" })
        : sdk.client.session.cybersecPreservation.status({ sessionID }, { redirect: "error" }),
    )
    if (!result.response) return { type: "unconfirmed", message: errorMessage(result.error) }
    return interpret(result.response.status, result.response.ok ? result.data : result.error)
  }
}

function cybersecFailure(reply: Exclude<CybersecReply, { type: "status" }>) {
  switch (reply.type) {
    case "unsupported":
      return "Not saved: cybersec needs a newer engine"
    case "unavailable":
      return "Not saved: owner unavailable"
    case "invalid":
      return "Save unconfirmed"
    case "rejected":
      return `Not saved (${reply.message})`
    case "unconfirmed":
      return `Save unconfirmed (${reply.message})`
  }
}

// Why a save did not take, or nothing when the owner acknowledged exactly what was asked.
function cybersecSaveFailure(preference: CybersecPreference, reply: CybersecReply) {
  if (reply.type !== "status") return cybersecFailure(reply)
  if (reply.status.preference !== preference) return `Not saved: owner kept ${reply.status.preference}`
}

export function startCybersecSave(request: CybersecRequest, sessionID: string, preference: CybersecPreference): CybersecSave {
  const reply = request(sessionID, preference).catch(
    (error): CybersecReply => ({ type: "unconfirmed", message: errorMessage(error) }),
  )
  return { sessionID, preference, reply }
}

// One save made where no control shows its result, so the outcome is reported as a toast.
export async function saveCybersec(sdk: { client: OpencodeClient }, sessionID: string, preference: CybersecPreference) {
  const reply = await startCybersecSave(cybersecTransport(sdk), sessionID, preference).reply
  const failure = cybersecSaveFailure(preference, reply)
  if (failure) return { saved: false, message: failure, variant: "error" } as const
  return { saved: true, message: `Cybersec: ${preference} for this session`, variant: "success" } as const
}

export type CybersecCommand = { type: "set"; preference: CybersecPreference } | { type: "choose" } | { type: "usage" }

export const cybersecUsage = "Usage: /cybersec on|off|inherit"

// `/cybersec` and its argument; `/cybersec-preservation`, the machine default's command, is not this one.
export function parseCybersecCommand(text: string): CybersecCommand | undefined {
  const match = /^\/cybersec(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return
  const argument = match[1]?.trim().toLowerCase() ?? ""
  if (!argument) return { type: "choose" }
  if (argument === "on" || argument === "off" || argument === "inherit") return { type: "set", preference: argument }
  return { type: "usage" }
}

type State = {
  phase: "loading" | "ready" | "unavailable" | "unsupported" | "invalid" | "error"
  status?: CybersecStatus
  saving: boolean
}

export function createCybersecPreservation(input: {
  sessionID: Accessor<string | undefined>
  request: CybersecRequest
  onFailure: (message: string) => void
}) {
  const [state, setState] = createStore<State>({ phase: "loading", saving: false })
  const event = useEvent()
  let reads = 0

  createEffect(
    on(input.sessionID, () => {
      reads++
      setState({ phase: "loading", status: undefined, saving: false })
      refresh()
    }),
  )

  // The owner publishes this after it committed a change; an older revision is one already shown.
  onCleanup(
    event.on("vibeterm.session.cybersec_preservation.updated", (evt) => {
      if (evt.properties.sessionID !== input.sessionID()) return
      if (state.status && evt.properties.revision <= state.status.revision) return
      refresh()
    }),
  )

  function refresh() {
    const sessionID = input.sessionID()
    if (!sessionID) return
    const read = ++reads
    void send(sessionID).then((reply) => {
      if (read !== reads || sessionID !== input.sessionID()) return
      if (reply.type === "status") return accept(reply.status)
      if (reply.type === "unavailable" || reply.type === "unsupported" || reply.type === "invalid")
        return setState({ phase: reply.type, status: undefined })
      // A failed read leaves an acknowledged status in place; without one the value is unknown.
      if (!state.status) setState("phase", "error")
    })
  }

  function send(sessionID: string) {
    return input
      .request(sessionID)
      .catch((error): CybersecReply => ({ type: "unconfirmed", message: errorMessage(error) }))
  }

  function accept(status: CybersecStatus) {
    if (state.status && status.revision < state.status.revision) return
    setState({ phase: "ready", status })
  }

  // Follows a save, including one started before this control existed, such as in the choice dialog.
  // A save for another session is not this control's to show.
  function track(save: CybersecSave) {
    if (save.sessionID !== input.sessionID()) return
    setState("saving", true)
    void save.reply.then((reply) => {
      if (save.sessionID !== input.sessionID()) return
      // A save outlives a read that started before it.
      reads++
      setState("saving", false)
      const failure = cybersecSaveFailure(save.preference, reply)
      if (failure) input.onFailure(failure)
      // An acknowledgement of another value is still the owner's truth, so it is shown.
      if (reply.type === "status") return accept(reply.status)
      if (reply.type === "unavailable" || reply.type === "unsupported")
        return setState({ phase: reply.type, status: undefined })
      refresh()
    })
  }

  return {
    get status() {
      return state.status
    },
    view: createMemo(() => {
      if (state.saving) return "Cybersec: saving..."
      if (state.phase === "ready" && state.status) return `Cybersec: ${state.status.preference}`
      if (state.phase === "loading") return "Cybersec: loading"
      if (state.phase === "unavailable" || state.phase === "unsupported") return `Cybersec: ${state.phase}`
      return "Cybersec: unknown"
    }),
    // Why a change cannot start now, or nothing when it can.
    refusal() {
      if (state.saving) return "Cybersec preservation is still saving"
      if (state.phase === "unsupported") return "Cybersec preservation needs a newer engine"
      if (state.phase === "unavailable") return "Cybersec can't be changed: owner unavailable"
      if (state.phase === "loading") return "Cybersec preservation is still loading"
      if (state.phase !== "ready") return "Cybersec preservation unknown; reopen to retry"
    },
    track,
  }
}
