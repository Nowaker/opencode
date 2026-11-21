import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { createRoot, createSignal } from "solid-js"
import {
  autoSwitchTransport,
  createAutoSwitch,
  describeAutoSwitch,
  interpretAutoSwitch,
  type AutoSwitchMutation,
  type AutoSwitchReply,
  type AutoSwitchStatus,
} from "../../src/component/prompt/auto-switch"

const opus = { agent: "build", providerID: "anthropic", modelID: "claude-opus-5-5", variant: "high" }
const sol = { agent: "build", providerID: "openai", modelID: "sol", variant: "xhigh" }

function status(patch: Partial<AutoSwitchStatus> = {}): AutoSwitchStatus {
  return {
    version: 1,
    sessionID: "ses_a",
    availability: "available",
    ownerEpoch: "epoch-1",
    revision: 3,
    preference: "inherit",
    enabled: true,
    reason: "default-on",
    returnPending: false,
    preferred: opus,
    effective: opus,
    ...patch,
  }
}

describe("interpretAutoSwitch", () => {
  test("reads a status, a conflict and an unavailable owner", () => {
    expect(interpretAutoSwitch(200, status())).toEqual({ type: "status", status: status() })
    expect(interpretAutoSwitch(409, status({ revision: 4 }))).toEqual({
      type: "conflict",
      status: status({ revision: 4 }),
    })
    const unavailable = status({ availability: "unavailable", ownerEpoch: null, revision: null })
    expect(interpretAutoSwitch(503, unavailable)).toEqual({ type: "unavailable", status: unavailable })
    expect(interpretAutoSwitch(503, "busy")).toEqual({ type: "unavailable" })
  })

  test("treats a missing endpoint as an older engine", () => {
    expect(interpretAutoSwitch(404, "not found")).toEqual({ type: "unsupported" })
    expect(interpretAutoSwitch(405, undefined)).toEqual({ type: "unsupported" })
  })

  test("refuses an unreadable body instead of guessing", () => {
    expect(interpretAutoSwitch(200, { ...status(), version: 2 })).toEqual({ type: "invalid" })
    expect(interpretAutoSwitch(200, { ...status(), reason: "made-up" })).toEqual({ type: "invalid" })
    expect(interpretAutoSwitch(200, { ...status(), effective: { ...sol, agent: undefined } })).toEqual({
      type: "invalid",
    })
  })

  test("separates a refused request from one whose outcome is unknown", () => {
    expect(interpretAutoSwitch(400, { name: "BadRequest", data: { message: "bad preference" } })).toEqual({
      type: "rejected",
      message: "bad preference",
    })
    expect(interpretAutoSwitch(500, "boom")).toEqual({ type: "unconfirmed", message: "HTTP 500" })
  })
})

// The automatic-return fields a newer owner adds, all together.
const automatic = {
  returnPreference: "inherit",
  returnEnabled: true,
  returnState: "preferred",
  next: opus,
} satisfies Partial<AutoSwitchStatus>

describe("automatic return", () => {
  test("an owner without it keeps the auto-switch toggle and shows no auto-return", () => {
    const view = describeAutoSwitch({ phase: "ready", status: status() })
    expect(view.autoReturn).toBeUndefined()
    expect(view.disabled).toBeUndefined()
    expect(interpretAutoSwitch(200, status())).toEqual({ type: "status", status: status() })
  })

  test("a partial set of its fields counts as none", () => {
    const { next: _, ...partial } = automatic
    expect(describeAutoSwitch({ phase: "ready", status: status(partial) }).autoReturn).toBeUndefined()
  })

  test("labels the auto-return toggle and where it came from", () => {
    expect(describeAutoSwitch({ phase: "ready", status: status(automatic) }).autoReturn).toEqual({
      text: "Auto-return: On",
      on: true,
      detail: "default",
    })
    expect(
      describeAutoSwitch({
        phase: "ready",
        status: status({ ...automatic, returnPreference: "off", returnEnabled: false, returnState: "return-off" }),
      }).autoReturn,
    ).toEqual({ text: "Auto-return: Off", on: false, detail: undefined })
  })

  test("previews the next route without calling it the current one", () => {
    expect(
      describeAutoSwitch({ phase: "ready", status: status({ ...automatic, next: sol }) }).active,
    ).toEqual({ using: undefined, preferred: "claude-opus-5-5 high", next: "sol xhigh", returning: false, canReturn: false })
    expect(
      describeAutoSwitch({
        phase: "ready",
         status: status({ ...automatic, effective: sol, returnState: "returning", next: opus }),
      }).active,
    ).toMatchObject({ using: "sol xhigh", preferred: "claude-opus-5-5 high", next: undefined,
      planned: "claude-opus-5-5 high", context: "returning: Claude has allowance", returning: true, canReturn: false })
    expect(
      describeAutoSwitch({
        phase: "ready",
        status: status({ ...automatic, effective: sol, returnEnabled: false, returnState: "return-off", next: sol }),
      }).active,
    ).toMatchObject({ using: "sol xhigh", next: undefined, planned: "sol xhigh",
      context: "preferred: claude-opus-5-5 high (return off)", returning: false, canReturn: true })
  })
})

describe("autoSwitchTransport", () => {
  function engine(capability: { autoSwitch?: number }, answers: Response[]) {
    const seen: { method: string; path: string; directory: string | null; body: unknown }[] = []
    const client = createOpencodeClient({
      baseUrl: "http://test",
      directory: "/tmp/project",
      fetch: (async (request: Request) => {
        const url = new URL(request.url)
        if (url.pathname === "/global/health")
          return Response.json({ healthy: true, version: "test", sessionUnpauseSelection: true, ...capability })
        seen.push({
          method: request.method,
          path: url.pathname,
          directory: url.searchParams.get("directory") ?? request.headers.get("x-opencode-directory"),
          body: request.method === "PUT" ? await request.json() : undefined,
        })
        return answers.shift()!
      }) as typeof fetch,
    })
    return { request: autoSwitchTransport({ client }), seen }
  }

  test("goes through the generated client and reads each kind of answer", async () => {
    const test = engine({ autoSwitch: 1 }, [
      Response.json(status()),
      Response.json(status({ revision: 9 }), { status: 409 }),
      Response.json(status({ availability: "unavailable", ownerEpoch: null, revision: null }), { status: 503 }),
    ])
    const mutation = { action: "return-to-preferred", ownerEpoch: "epoch-1", revision: 3 } as const
    expect(await test.request("ses_a")).toEqual({ type: "status", status: status() })
    expect(await test.request("ses_a", mutation)).toEqual({ type: "conflict", status: status({ revision: 9 }) })
    expect(await test.request("ses_a")).toMatchObject({ type: "unavailable", status: { ownerEpoch: null } })
    expect(test.seen.slice(0, 2)).toEqual([
      { method: "GET", path: "/session/ses_a/auto-switch", directory: "/tmp/project", body: undefined },
      { method: "PUT", path: "/session/ses_a/auto-switch", directory: "%2Ftmp%2Fproject", body: mutation },
    ])
  })

  test("never sends a session route to an engine without the capability", async () => {
    for (const capability of [{}, { autoSwitch: 2 }]) {
      const test = engine(capability, [])
      expect(await test.request("ses_a")).toEqual({ type: "unsupported" })
      expect(
        await test.request("ses_a", { action: "set-preference", preference: "on", ownerEpoch: "e", revision: 1 }),
      ).toEqual({ type: "unsupported" })
      expect(test.seen).toEqual([])
    }
  })
})

describe("describeAutoSwitch", () => {
  test("labels the setting and where it came from", () => {
    expect(describeAutoSwitch({ phase: "ready", status: status() })).toMatchObject({
      text: "Auto-switch: On",
      on: true,
      detail: "default",
    })
    expect(
      describeAutoSwitch({ phase: "ready", status: status({ enabled: false, reason: "rule-off" }) }),
    ).toMatchObject({ text: "Auto-switch: Off", on: false, detail: "by rule" })
    const explicit = describeAutoSwitch({
      phase: "ready",
      status: status({ preference: "on", reason: "session-on" }),
    })
    expect(explicit.detail).toBeUndefined()
    expect(explicit.disabled).toBeUndefined()
  })

  test("gives a stable reason when the toggle cannot be used", () => {
    expect(describeAutoSwitch({ phase: "loading" })).toMatchObject({ text: "Auto-switch: ...", disabled: expect.any(String) })
    expect(describeAutoSwitch({ phase: "unsupported" })).toMatchObject({
      text: "Auto-switch: unsupported",
      disabled: "Auto-switch needs a newer engine",
    })
    expect(
      describeAutoSwitch({ phase: "ready", status: status({ enabled: false, reason: "pinned" }) }),
    ).toMatchObject({ text: "Auto-switch: Off", detail: "pinned", disabled: "This session's route is pinned" })
    expect(
      describeAutoSwitch({
        phase: "unavailable",
        status: status({ availability: "unavailable", ownerEpoch: null, revision: null, reason: "owner-unavailable" }),
      }),
    ).toMatchObject({ disabled: "The session's engine owner is unavailable" })
  })

  test("shows the alternate in use beside the preferred route", () => {
    const view = describeAutoSwitch({
      phase: "ready",
      status: status({ reason: "alternate-active", effective: { ...sol, agent: "oracle" } }),
    })
    expect(view.active).toEqual({
      using: "Oracle sol xhigh",
      preferred: "Build claude-opus-5-5 high",
      returning: false,
      canReturn: true,
    })
    const returning = describeAutoSwitch({
      phase: "ready",
      status: status({ enabled: false, reason: "return-pending", returnPending: true, effective: sol }),
    })
    expect(returning.active).toMatchObject({ using: "sol xhigh", returning: true, canReturn: false })
    expect(returning.detail).toBeUndefined()
    expect(
      describeAutoSwitch({ phase: "ready", status: status({ reason: "return-pending", returnPending: true }) }).detail,
    ).toBe("returning at next step")
  })

  test("keeps the acknowledged value visible while saving", () => {
    expect(
      describeAutoSwitch({ phase: "ready", status: status(), pending: { kind: "switch", preference: "off" } }),
    ).toMatchObject({
      text: "Auto-switch: On",
      saving: true,
      detail: "Saving...",
    })
  })
})

function rig(initial = "ses_a") {
  const calls: { sessionID: string; mutation?: AutoSwitchMutation; resolve(reply: AutoSwitchReply): void }[] = []
  // The recheck the controller has scheduled, run by the test instead of a clock.
  const recheck = { run: undefined as (() => void) | undefined }
  return createRoot((dispose) => {
    const [sessionID, setSessionID] = createSignal<string | undefined>(initial)
    const control = createAutoSwitch({
      sessionID,
      request: (sessionID, mutation) =>
        new Promise<AutoSwitchReply>((resolve) => calls.push({ sessionID, mutation, resolve })),
      every: (run) => {
        recheck.run = run
        return () => {
          if (recheck.run === run) recheck.run = undefined
        }
      },
    })
    return { control, calls, setSessionID, dispose, recheck }
  })
}

async function flush() {
  for (let index = 0; index < 5; index++) await Promise.resolve()
}

describe("createAutoSwitch", () => {
  test("reads status for the session and sends the owner's epoch and revision with a toggle", async () => {
    const test = rig()
    expect(test.calls).toHaveLength(1)
    expect(test.control.view().text).toBe("Auto-switch: ...")
    test.calls[0]!.resolve({ type: "status", status: status() })
    await flush()
    expect(test.control.view().text).toBe("Auto-switch: On")

    expect(test.control.toggle()).toBeUndefined()
    expect(test.calls[1]!.mutation).toEqual({
      action: "set-preference",
      preference: "off",
      ownerEpoch: "epoch-1",
      revision: 3,
    })
    expect(test.control.view()).toMatchObject({ text: "Auto-switch: On", saving: true })
    expect(test.control.toggle()).toBe("Auto-switch is saving")
    expect(test.calls).toHaveLength(2)

    test.calls[1]!.resolve({
      type: "status",
      status: status({ preference: "off", enabled: false, reason: "session-off", revision: 4 }),
    })
    await flush()
    expect(test.control.view()).toMatchObject({ text: "Auto-switch: Off", saving: false })
    expect(test.control.view().notice).toBeUndefined()
    test.dispose()
  })

  test("a conflict shows the owner's current state, not the requested one", async () => {
    const test = rig()
    test.calls[0]!.resolve({ type: "status", status: status() })
    await flush()
    test.control.toggle()
    test.calls[1]!.resolve({ type: "conflict", status: status({ revision: 5, reason: "rule-on" }) })
    await flush()
    expect(test.control.view()).toMatchObject({
      text: "Auto-switch: On",
      saving: false,
      notice: { kind: "stale", text: "Not saved: changed elsewhere" },
    })
    test.dispose()
  })

  test("an unknown outcome keeps the prior value and rereads before saying anything was saved", async () => {
    const test = rig()
    test.calls[0]!.resolve({ type: "status", status: status() })
    await flush()
    test.control.toggle()
    test.calls[1]!.resolve({ type: "unconfirmed", message: "HTTP 502" })
    await flush()
    expect(test.control.view()).toMatchObject({
      text: "Auto-switch: On",
      notice: { kind: "unconfirmed", text: "Save unconfirmed (HTTP 502)" },
    })
    expect(test.calls[2]!.mutation).toBeUndefined()
    test.calls[2]!.resolve({ type: "status", status: status() })
    await flush()
    expect(test.control.view().notice).toEqual({ kind: "failed", text: "Not saved" })
    test.dispose()
  })

  test("an unknown outcome that did save clears the notice once the reread shows it", async () => {
    const test = rig()
    test.calls[0]!.resolve({ type: "status", status: status() })
    await flush()
    test.control.toggle()
    test.calls[1]!.resolve({ type: "unconfirmed", message: "HTTP 502" })
    await flush()
    test.calls[2]!.resolve({
      type: "status",
      status: status({ preference: "off", enabled: false, reason: "session-off", revision: 4 }),
    })
    await flush()
    expect(test.control.view()).toMatchObject({ text: "Auto-switch: Off" })
    expect(test.control.view().notice).toBeUndefined()
    test.dispose()
  })

  test("a refused, unavailable or unsupported save never claims success", async () => {
    const test = rig()
    test.calls[0]!.resolve({ type: "status", status: status() })
    await flush()
    test.control.toggle()
    test.calls[1]!.resolve({ type: "rejected", message: "bad preference" })
    await flush()
    expect(test.control.view()).toMatchObject({
      text: "Auto-switch: On",
      notice: { kind: "failed", text: "Not saved (bad preference)" },
    })
    test.control.toggle()
    test.calls[2]!.resolve({ type: "unavailable" })
    await flush()
    expect(test.control.view()).toMatchObject({
      text: "Auto-switch: unavailable",
      notice: { kind: "failed", text: "Not saved: owner unavailable" },
    })
    expect(test.control.toggle()).toBe("The session's engine owner is unavailable")
    test.dispose()
  })

  test("a read that lands after a newer save is ignored", async () => {
    const test = rig()
    test.calls[0]!.resolve({ type: "status", status: status() })
    await flush()
    test.control.refresh()
    test.control.toggle()
    test.calls[2]!.resolve({
      type: "status",
      status: status({ preference: "off", enabled: false, reason: "session-off", revision: 4 }),
    })
    await flush()
    test.calls[1]!.resolve({ type: "status", status: status() })
    await flush()
    expect(test.control.view().text).toBe("Auto-switch: Off")
    test.dispose()
  })

  test("return and default send their own actions; return needs an alternate in use", async () => {
    const test = rig()
    test.calls[0]!.resolve({ type: "status", status: status({ preference: "on", reason: "session-on" }) })
    await flush()
    expect(test.control.returnToPreferred()).toBe("Already using the preferred route")
    expect(test.control.useDefault()).toBeUndefined()
    expect(test.calls[1]!.mutation).toEqual({
      action: "set-preference",
      preference: "inherit",
      ownerEpoch: "epoch-1",
      revision: 3,
    })
    test.calls[1]!.resolve({ type: "status", status: status({ reason: "alternate-active", effective: sol, revision: 4 }) })
    await flush()
    expect(test.control.useDefault()).toBe("Auto-switch already follows the default")
    expect(test.control.returnToPreferred()).toBeUndefined()
    expect(test.calls[2]!.mutation).toEqual({ action: "return-to-preferred", ownerEpoch: "epoch-1", revision: 4 })
    expect(test.control.view().active).toMatchObject({ returning: true, canReturn: false })
    test.dispose()
  })

  test("auto-return sends its own preference and needs an owner that reports it", async () => {
    const old = rig()
    old.calls[0]!.resolve({ type: "status", status: status() })
    await flush()
    expect(old.control.toggleAutoReturn()).toBe("Auto-return needs a newer engine owner")
    expect(old.calls).toHaveLength(1)
    old.dispose()

    const test = rig()
    test.calls[0]!.resolve({ type: "status", status: status(automatic) })
    await flush()
    expect(test.control.useAutoReturnDefault()).toBe("Auto-return already follows the default")
    expect(test.control.toggleAutoReturn()).toBeUndefined()
    expect(test.calls[1]!.mutation).toEqual({
      action: "set-return-preference",
      preference: "off",
      ownerEpoch: "epoch-1",
      revision: 3,
    })
    expect(test.control.view()).toMatchObject({
      detail: "default",
      autoReturn: { text: "Auto-return: On", detail: "Saving..." },
    })
    test.calls[1]!.resolve({
      type: "status",
      status: status({ ...automatic, returnPreference: "off", returnEnabled: false, returnState: "return-off", revision: 4 }),
    })
    await flush()
    expect(test.control.view().autoReturn).toEqual({ text: "Auto-return: Off", on: false, detail: undefined })
    test.dispose()
  })

  test("rereads on a schedule only while an alternate or a different next route is shown", async () => {
    const test = rig()
    test.calls[0]!.resolve({ type: "status", status: status(automatic) })
    await flush()
    expect(test.recheck.run).toBeUndefined()
    test.control.refresh()
    test.calls[1]!.resolve({ type: "status", status: status({ ...automatic, effective: sol, returnState: "alternate", next: sol, revision: 4 }) })
    await flush()
    expect(test.recheck.run).toBeDefined()
    test.recheck.run!()
    expect(test.calls[2]!.mutation).toBeUndefined()
    test.calls[2]!.resolve({ type: "status", status: status({ ...automatic, revision: 5 }) })
    await flush()
    expect(test.control.view().active).toBeUndefined()
    expect(test.recheck.run).toBeUndefined()
    test.dispose()
  })

  test("a reply for the previous session does not reach the next one", async () => {
    const test = rig()
    test.setSessionID("ses_b")
    expect(test.calls[1]!.sessionID).toBe("ses_b")
    test.calls[0]!.resolve({ type: "status", status: status() })
    await flush()
    expect(test.control.view().text).toBe("Auto-switch: ...")
    test.calls[1]!.resolve({ type: "status", status: status({ sessionID: "ses_b", enabled: false, reason: "default-off" }) })
    await flush()
    expect(test.control.view().text).toBe("Auto-switch: Off")
    test.dispose()
  })
})
