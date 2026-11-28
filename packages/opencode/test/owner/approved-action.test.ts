import { expect, test } from "bun:test"
import { strict } from "node:assert"
import type {
  ApprovedActionActivity,
  ApprovedActionBinding,
  ApprovedActionOwner,
  ApprovedActionReceipt,
} from "@opencode-ai/plugin"
import { createApprovedAction } from "../../src/owner/approved-action"

const binding = {
  sessionID: "ses_approved_action",
  actionID: "qac_0123456789ab",
  messageID: "msg_approved_action",
} as const satisfies ApprovedActionBinding

function fixture(deps: Partial<Pick<Parameters<typeof createApprovedAction>[0], "check" | "hold">> = {}) {
  const lifetime = new AbortController()
  const activity: ApprovedActionActivity[] = []
  const settlements: ApprovedActionReceipt[] = []
  const held: Promise<void>[] = []
  let owner: ApprovedActionOwner = { ownerID: "owner-1", generation: 1 }

  const action = createApprovedAction({
    signal: lifetime.signal,
    check: async () => undefined,
    owner: () => owner,
    hold: (work) => {
      const running = work()
      held.push(running)
      return running
    },
    publish: (event) => {
      activity.push(event)
    },
    settle: async (receipt) => {
      settlements.push(receipt)
      return { kind: "stored", messageID: receipt.messageID, partID: "prt_approved_action" }
    },
    receipt: async () => ({ kind: "missing" }),
    ...deps,
  })

  return {
    action,
    lifetime,
    activity,
    settlements,
    rotateOwner: () => {
      owner = { ...owner, generation: owner.generation + 1 }
    },
    drain: () => Promise.all(held),
    async prepare() {
      const capability = await action.capability({ sessionID: binding.sessionID })
      strict.equal(capability.kind, "ready", JSON.stringify(capability))
      const input = { ...binding, owner: capability.owner }
      const prepared = await action.prepare(input)
      strict.equal(prepared.kind, "prepared", JSON.stringify(prepared))
      return { ...input, preparationID: prepared.preparationID }
    },
  }
}

test("refuses an unconsumed preparation when generation changes during the admission check", async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let checkingAdmit = false
  const owner = fixture({
    check: async () => {
      if (checkingAdmit) {
        entered.resolve()
        await release.promise
      }
      return undefined
    },
  })
  const input = await owner.prepare()
  checkingAdmit = true
  let executions = 0

  const admission = owner.action.admit(input, {
    run: async () => {
      executions += 1
      return undefined
    },
  })
  try {
    const reachedCheck = await Promise.race([entered.promise.then(() => true), admission.then(() => false)])
    expect(reachedCheck).toBe(true)
    owner.rotateOwner()
  } finally {
    release.resolve()
  }
  const result = await admission
  await owner.drain()

  expect(result).toEqual({ kind: "refused", reason: "stale-owner" })
  expect(executions).toBe(0)
})

test("does not consume the same preparation again after the run ends", async () => {
  const owner = fixture()
  const input = await owner.prepare()
  let executions = 0
  const run = async () => {
    executions += 1
    return undefined
  }
  expect(await owner.action.admit(input, { run })).toEqual({ kind: "admitted" })
  await owner.drain()
  expect(executions).toBe(1)

  await owner.action.admit(input, { run })
  await owner.drain()

  expect(executions).toBe(1)
})

test("runs only once when identical admissions overlap", async () => {
  const owner = fixture()
  const input = await owner.prepare()
  const release = Promise.withResolvers<void>()
  let executions = 0
  const run = async () => {
    executions += 1
    await release.promise
    return undefined
  }

  try {
    const results = await Promise.all([owner.action.admit(input, { run }), owner.action.admit(input, { run })])
    expect(results.map((result) => result.kind)).toContain("admitted")
  } finally {
    release.resolve()
    await owner.drain()
  }

  expect(executions).toBe(1)
})

test("does not run or revive a token when the owner rejects the handoff", async () => {
  let sealed = true
  const owner = fixture({
    hold: (work) => {
      const running = work()
      return sealed ? Promise.reject(new Error("sealed")) : running
    },
  })
  const input = await owner.prepare()
  let executions = 0
  const run = async () => {
    executions += 1
    return undefined
  }

  const denied = await owner.action.admit(input, { run })
  sealed = false
  await owner.action.admit(input, { run })

  expect(denied).toEqual({ kind: "refused", reason: "owner-unavailable" })
  expect(executions).toBe(0)
})

test("projects a bounded UTF-8 tail bound to the prepared action", async () => {
  const owner = fixture()
  const input = await owner.prepare()
  const previewBytes = 16 * 1024
  const chunk = "é".repeat(previewBytes / 2)
  const receipt = {
    ...binding,
    outcome: { kind: "exited", exitCode: 0, output: "finished" },
  } satisfies ApprovedActionReceipt

  expect(
    await owner.action.admit(input, {
      run: async ({ stream }) => {
        const first = { sequence: 1, text: chunk, actionID: "not-the-prepared-action" }
        stream(first)
        stream({ sequence: 2, text: "\x1b[31mtail\x1b[0m" })
        return receipt
      },
    }),
  ).toEqual({ kind: "admitted" })
  await owner.drain()

  const previews = owner.activity.filter((event) => event.phase === "running" && event.preview)
  expect(
    previews.map((event) => ({
      sessionID: event.sessionID,
      actionID: event.actionID,
      messageID: event.messageID,
      bytes: Buffer.byteLength(event.preview),
    })),
  ).toEqual([
    { ...binding, bytes: previewBytes },
    { ...binding, bytes: previewBytes },
  ])
  expect(previews.at(-1)?.preview).toBe(`${chunk.slice(2)}tail`)
  expect(owner.settlements).toEqual([receipt])
  expect(owner.activity.at(-1)).toMatchObject({ phase: "settled", outcome: receipt.outcome })
})

test("ignores replayed and skipped chunk sequences without losing the next contiguous chunk", async () => {
  const owner = fixture()
  const input = await owner.prepare()

  expect(
    await owner.action.admit(input, {
      run: async ({ stream }) => {
        stream({ sequence: 1, text: "first" })
        stream({ sequence: 1, text: "replay" })
        stream({ sequence: 3, text: "gap" })
        stream({ sequence: 2, text: " second" })
        return undefined
      },
    }),
  ).toEqual({ kind: "admitted" })
  await owner.drain()

  expect(
    owner.activity
      .filter((event) => event.phase === "running" && event.preview)
      .map((event) => event.preview),
  ).toEqual(["first", "first second"])
})

test.each([
  ["returns undefined", async (): Promise<undefined> => undefined],
  [
    "throws",
    async () => {
      throw new Error("not for projection")
    },
  ],
  [
    "returns a different binding",
    async () => ({
      ...binding,
      messageID: "msg_other",
      outcome: { kind: "exited", exitCode: 0, output: "other action" },
    } satisfies ApprovedActionReceipt),
  ],
] as const)("leaves the action unconfirmed without settling when its callback %s", async (_, run) => {
  const owner = fixture()
  const input = await owner.prepare()

  expect(await owner.action.admit(input, { run })).toEqual({ kind: "admitted" })
  await owner.drain()

  const terminal = owner.activity.filter((event) => event.phase !== "running")
  expect(terminal.map((event) => ({ phase: event.phase, outcome: event.outcome, preview: event.preview }))).toEqual([
    { phase: "unconfirmed", outcome: undefined, preview: "" },
  ])
  expect(owner.settlements).toEqual([])
})

test("aborts an admitted callback with its owner's lifetime", async () => {
  const owner = fixture()
  const input = await owner.prepare()
  const started = Promise.withResolvers<AbortSignal>()
  const release = Promise.withResolvers<void>()

  try {
    expect(
      await owner.action.admit(input, {
        run: async ({ signal }) => {
          started.resolve(signal)
          await release.promise
          return undefined
        },
      }),
    ).toEqual({ kind: "admitted" })
    const signal = await started.promise
    expect(signal.aborted).toBe(false)

    owner.lifetime.abort()

    expect(signal.aborted).toBe(true)
  } finally {
    release.resolve()
    await owner.drain()
  }
})
