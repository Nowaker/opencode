import { randomUUID } from "node:crypto"
import { stripVTControlCharacters } from "node:util"
import type {
  ApprovedAction,
  ApprovedActionActivity,
  ApprovedActionBinding,
  ApprovedActionFailure,
  ApprovedActionOwner,
  ApprovedActionReceipt,
  ApprovedActionRefused,
} from "@opencode-ai/plugin"

type Dependencies = {
  readonly signal: AbortSignal
  readonly check: (sessionID: string) => Promise<ApprovedActionRefused | undefined>
  readonly owner: () => ApprovedActionOwner
  readonly hold: (work: () => Promise<void>) => Promise<void>
  readonly publish: (event: ApprovedActionActivity) => void
  readonly settle: ApprovedAction["settle"]
  readonly receipt: ApprovedAction["receipt"]
}

type Preparation = {
  readonly binding: ApprovedActionBinding
  readonly owner: ApprovedActionOwner
  readonly expiresAt: number
  readonly deadline: number
  consumed: boolean
}

type Run = Parameters<ApprovedAction["admit"]>[1]["run"]

const preparationLifetime = 30_000
const preparationLimit = 1024
const projectionBytes = 16 * 1024
const failures = {
  "owner-lost": true,
  "pane-unavailable": true,
  "claim-unavailable": true,
  "launch-refused": true,
  "result-unavailable": true,
} satisfies Record<ApprovedActionFailure, true>

export function createApprovedAction(deps: Dependencies): ApprovedAction {
  const preparations = new Map<string, Preparation>()
  const active = new Set<ApprovedActionBinding>()

  function ownerRefusal(owner: ApprovedActionOwner) {
    if (deps.signal.aborted) return refused("owner-unavailable")
    if (!sameOwner(owner, deps.owner())) return refused("stale-owner")
  }

  async function check(sessionID: string) {
    try {
      return await deps.check(sessionID)
    } catch {
      return refused("owner-unavailable")
    }
  }

  function activeRefusal(binding: ApprovedActionBinding) {
    for (const current of active) {
      if (current.sessionID === binding.sessionID) return refused("busy")
      if (overlaps(current, binding)) return refused("conflict")
    }
  }

  async function execute(preparation: Preparation, run: Run) {
    const binding = preparation.binding
    let sequence = 0
    let chunkSequence = 0
    let preview = ""
    let streaming = true
    let outcome: ApprovedActionReceipt["outcome"] | undefined
    const publish = (phase: ApprovedActionActivity["phase"]) => {
      sequence += 1
      deps.publish({ ...binding, sequence, phase, preview, ...(outcome && { outcome }) })
    }

    try {
      if (ownerRefusal(preparation.owner)) return
      publish("running")
      if (ownerRefusal(preparation.owner)) return
      const result = await run({
        signal: deps.signal,
        stream: (chunk) => {
          if (!streaming || ownerRefusal(preparation.owner)) return
          if (chunk.sequence !== chunkSequence + 1 || !Number.isSafeInteger(chunk.sequence)) return
          if (typeof chunk.text !== "string" || Buffer.byteLength(chunk.text) > projectionBytes) return
          preview = utf8Tail(preview + sanitize(chunk.text))
          chunkSequence = chunk.sequence
          publish("running")
        },
      })
      streaming = false
      const receipt = normalizeApprovedActionReceipt(result)
      if (!receipt || !sameBinding(binding, receipt) || ownerRefusal(preparation.owner)) return
      const stored = await deps.settle(receipt)
      if (
        stored.kind === "stored" &&
        stored.messageID === binding.messageID &&
        engineID(stored.partID, "prt") &&
        !ownerRefusal(preparation.owner)
      ) {
        outcome = receipt.outcome
      }
    } finally {
      streaming = false
      publish(outcome ? "settled" : "unconfirmed")
    }
  }

  return {
    version: 1,
    async capability({ sessionID }) {
      if (!engineID(sessionID, "ses")) return refused("invalid-binding")
      if (deps.signal.aborted) return refused("owner-unavailable")
      const owner = copyOwner(deps.owner())
      const denied = await check(sessionID)
      return ownerRefusal(owner) ?? denied ?? { kind: "ready", owner }
    },
    async prepare(input) {
      const binding = copyBinding(input)
      if (!isApprovedActionBinding(binding)) return refused("invalid-binding")
      const owner = copyOwner(input.owner)
      const unavailable = ownerRefusal(owner)
      if (unavailable) return unavailable
      const denied = await check(binding.sessionID)
      const blocked = ownerRefusal(owner) ?? denied ?? activeRefusal(binding)
      if (blocked) return blocked

      const now = performance.now()
      for (const [preparationID, prior] of preparations) {
        if (prior.deadline <= now || !sameOwner(prior.owner, owner)) {
          preparations.delete(preparationID)
          continue
        }
        if (overlaps(prior.binding, binding)) {
          if (!sameBinding(prior.binding, binding) || prior.consumed) return refused("conflict")
          return { kind: "prepared", preparationID, expiresAt: prior.expiresAt }
        }
        if (!prior.consumed && prior.binding.sessionID === binding.sessionID) return refused("busy")
      }
      if (preparations.size >= preparationLimit) return refused("busy")
      const preparationID = randomUUID()
      if (preparations.has(preparationID)) return refused("conflict")
      const expiresAt = Date.now() + preparationLifetime
      preparations.set(preparationID, { binding, owner, expiresAt, deadline: now + preparationLifetime, consumed: false })
      return { kind: "prepared", preparationID, expiresAt }
    },
    async admit(input, { run }) {
      const binding = copyBinding(input)
      if (!isApprovedActionBinding(binding)) return refused("invalid-binding")
      const { preparationID } = input
      const owner = copyOwner(input.owner)
      const unavailable = ownerRefusal(owner)
      if (unavailable) return unavailable
      const denied = await check(binding.sessionID)
      const blocked = ownerRefusal(owner) ?? denied
      if (blocked) return blocked

      const preparation = preparations.get(preparationID)
      if (!preparation || preparation.deadline <= performance.now()) return refused("expired-preparation")
      if (!sameOwner(preparation.owner, owner)) return refused("stale-owner")
      if (preparation.consumed || !sameBinding(preparation.binding, binding)) return refused("conflict")
      const busy = activeRefusal(binding)
      if (busy) return busy
      preparation.consumed = true
      active.add(preparation.binding)

      // Do not invoke the runner until hold has returned and accepted the handoff.
      const handoff = Promise.withResolvers<boolean>()
      let entered = false
      let rejected = false
      try {
        void deps.hold(async () => {
          if (entered) return
          entered = true
          if (!(await handoff.promise)) return
          await execute(preparation, run).catch(() => undefined)
          active.delete(preparation.binding)
        }).catch(() => {
          rejected = true
        })
      } catch {
        rejected = true
      }
      // An already rejected hold is not a transfer, even if it invoked the thunk.
      if (entered && !rejected) await Promise.resolve()
      const failed = ownerRefusal(owner) ?? (!entered || rejected ? refused("owner-unavailable") : undefined)
      if (failed) {
        active.delete(preparation.binding)
        handoff.resolve(false)
        return failed
      }
      handoff.resolve(true)
      return { kind: "admitted" }
    },
    async settle(receipt) {
      const normalized = normalizeApprovedActionReceipt(receipt)
      return normalized ? deps.settle(normalized) : refused("invalid-binding")
    },
    async receipt(receipt) {
      const normalized = normalizeApprovedActionReceipt(receipt)
      return normalized ? deps.receipt(normalized) : refused("invalid-binding")
    },
  }
}

export function isApprovedActionBinding(input: unknown): input is ApprovedActionBinding {
  if (typeof input !== "object" || input === null) return false
  if (!("sessionID" in input) || !engineID(input.sessionID, "ses")) return false
  if (!("messageID" in input) || !engineID(input.messageID, "msg")) return false
  if (!("actionID" in input) || typeof input.actionID !== "string") return false
  return input.actionID.length === 16 && /^qac_[A-Za-z0-9_-]{12}$/.test(input.actionID)
}

export function normalizeApprovedActionReceipt(receipt: unknown): ApprovedActionReceipt | undefined {
  if (!isApprovedActionBinding(receipt) || !("outcome" in receipt)) return
  const outcome = receipt.outcome
  if (typeof outcome !== "object" || outcome === null || !("kind" in outcome)) return
  switch (outcome.kind) {
    case "exited": {
      if (!("exitCode" in outcome) || !("output" in outcome)) return
      const { exitCode, output } = outcome
      if (typeof exitCode !== "number" || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) return
      if (typeof output !== "string") return
      return { ...copyBinding(receipt), outcome: { kind: "exited", exitCode, output: utf8Tail(sanitize(output)) } }
    }
    case "not-run":
    case "unknown": {
      if (!("reason" in outcome) || !isFailure(outcome.reason)) return
      return { ...copyBinding(receipt), outcome: { kind: outcome.kind, reason: outcome.reason } }
    }
    default:
      return undefined
  }
}

function isFailure(reason: unknown): reason is ApprovedActionFailure {
  return typeof reason === "string" && Object.hasOwn(failures, reason)
}

function engineID(id: unknown, prefix: "ses" | "msg" | "prt") {
  if (typeof id !== "string" || id.length <= prefix.length || id.length >= 128) return false
  return id.startsWith(prefix) && !/[^!-~]/.test(id)
}

function copyBinding({ sessionID, actionID, messageID }: ApprovedActionBinding): ApprovedActionBinding {
  return { sessionID, actionID, messageID }
}

function copyOwner({ ownerID, generation }: ApprovedActionOwner): ApprovedActionOwner {
  return { ownerID, generation }
}

function overlaps(left: ApprovedActionBinding, right: ApprovedActionBinding) {
  return left.actionID === right.actionID || left.messageID === right.messageID
}

function sameBinding(left: ApprovedActionBinding, right: ApprovedActionBinding) {
  return left.sessionID === right.sessionID && left.actionID === right.actionID && left.messageID === right.messageID
}

function sameOwner(left: ApprovedActionOwner, right: ApprovedActionOwner) {
  return left.ownerID === right.ownerID && left.generation === right.generation
}

function sanitize(text: string) {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
}

function utf8Tail(text: string) {
  const bytes = Buffer.from(text.slice(-projectionBytes))
  let start = Math.max(0, bytes.length - projectionBytes)
  while (((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1
  return bytes.toString("utf8", start)
}

function refused(reason: ApprovedActionRefused["reason"]): ApprovedActionRefused {
  return { kind: "refused", reason }
}
