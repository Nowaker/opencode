import { expect, test } from "bun:test"
import { Session } from "@opencode/schema/session"
import type { RouteSwitch } from "@opencode/schema/route-switch"
import { createAppFixture } from "./fixture/app"
import { directory, json, worktree, type FetchHandler } from "./fixture/tui-client"

const sessionID = Session.ID.make("ses_route_control")
const retryEndpoint = `/api/experimental/session/${sessionID}/auto-switch/retry`
const location = { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } }
const preferred = { agent: "build", providerID: "source", modelID: "primary", variant: "high" }
const alternate = { agent: "build", providerID: "target", modelID: "backup", variant: "medium" }
const initial = {
  version: 1,
  sessionID,
  availability: "available",
  ownerEpoch: "owner-a",
  revision: 1,
  preference: "off",
  reason: "session-off",
  enabled: false,
  preferred,
  effective: preferred,
  next: preferred,
  returnPreference: "inherit",
  returnEnabled: false,
  returnPending: false,
  returnState: "preferred",
} as const satisfies RouteSwitch.Status
const endpoint = `/api/experimental/session/${sessionID}/auto-switch`

function mount(handler: FetchHandler, supported: boolean | "retry" = true) {
  return createAppFixture({
    width: 86,
    height: 26,
    args: { sessionID },
    config: { animations: false, tabs: { enabled: false } },
    fetch: async (url, request) => {
      const result = await handler(url, request)
      if (result) return result
      if (url.pathname === "/api/info" && supported)
        return json({
          version: "test",
          capabilities: { autoSwitch: true, ...(supported === "retry" ? { autoSwitchRetry: true } : {}) },
        })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "source", name: "Source" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            {
              id: "primary",
              providerID: "source",
              name: "Preferred model",
              variants: [{ id: "high" }],
              cost: [],
              time: { released: 0 },
            },
          ],
        })
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            title: "Routing control fixture",
            projectID: "proj_test",
            location: { directory },
            agent: "build",
            model: { providerID: "source", id: "primary", variant: "high" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname.startsWith(`/api/session/${sessionID}/`) && request.method === "GET")
        return json({ data: [], cursor: {} })
    },
  })
}

async function click(setup: Awaited<ReturnType<typeof mount>>, text: string) {
  const lines = setup.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  const x = lines[y]?.indexOf(text)
  if (x === undefined || x < 0) throw new Error(`Control not rendered: ${text}`)
  await setup.mockMouse.click(x + 2, y)
}

test("session policy stays Off while saving and changes only on the owner's acknowledgement", async () => {
  const edit = Promise.withResolvers<Response>()
  const requested = Promise.withResolvers<unknown>()
  await using setup = await mount(async (url, request) => {
    if (url.pathname !== endpoint) return
    if (request.method === "GET") return json({ data: initial })
    requested.resolve(await request.json())
    return edit.promise
  })
  try {
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("Auto-switch: Off"))
    await click(setup, "Auto-switch: Off")
    await setup.waitForFrame((frame) => frame.includes("Auto-switch: Off") && frame.includes("Saving..."))
    expect(await requested.promise).toEqual({
      action: "set-preference",
      preference: "on",
      ownerEpoch: "owner-a",
      revision: 1,
    })

    edit.resolve(json({ data: { ...initial, revision: 2, preference: "on", reason: "session-on", enabled: true } }))
    await setup.waitForFrame((frame) => frame.includes("Auto-switch: On") && frame.includes("Saved"))
  } finally {
    edit.resolve(new Response(null, { status: 500 }))
  }
})

test.each([
  {
    status: 409,
    tag: "AutoSwitchConflict",
    message: "Not saved: changed elsewhere",
    current: {
      ...initial,
      revision: 7,
      enabled: true,
      preference: "inherit",
      reason: "rule-on",
    } satisfies RouteSwitch.Status,
    label: "Auto-switch: On by rule",
  },
  {
    status: 503,
    tag: "AutoSwitchUnavailable",
    message: "Not saved: auto-switch unavailable",
    current: {
      ...initial,
      availability: "unavailable",
      reason: "owner-unavailable",
      ownerEpoch: null,
      revision: null,
    } satisfies RouteSwitch.Status,
    label: "Auto-switch: unavailable (owner unavailable)",
  },
  {
    status: 200,
    message: "Save unconfirmed",
    current: { ...initial, revision: 9 } satisfies RouteSwitch.Status,
    label: "Auto-switch: Off",
  },
])("HTTP $status does not claim an unacknowledged edit saved", async (scenario) => {
  await using setup = await mount((url, request) => {
    if (url.pathname !== endpoint) return
    if (request.method === "GET") return json({ data: initial })
    return json(
      { ...(scenario.tag ? { _tag: scenario.tag } : {}), data: scenario.current },
      { status: scenario.status },
    )
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Auto-switch: Off"))
  await click(setup, "Auto-switch: Off")
  const frame = await setup.waitForFrame((text) => text.includes(scenario.message))
  expect(frame).toContain(scenario.label)
  expect(frame).not.toContain("Saved")
})

test("an older engine does not get session route-switch requests", async () => {
  const requests: string[] = []
  await using setup = await mount((url, request) => {
    if (url.pathname !== endpoint) return
    requests.push(request.method)
    return json({ data: initial })
  }, false)
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Auto-switch: unsupported"))
  await click(setup, "Auto-switch: unsupported")
  await setup.renderOnce()
  expect(requests).toEqual([])
})

test("an expired preview becomes unverified and does not block the manual return command", async () => {
  const snapshot = {
    ...initial,
    effective: alternate,
    next: preferred,
    returnState: "returning",
    previewExpiresAt: 1,
  } satisfies RouteSwitch.Status
  let edit: unknown
  await using setup = await mount(async (url, request) => {
    if (url.pathname !== endpoint) return
    if (request.method === "GET") return json({ data: snapshot })
    edit = await request.json()
    return json({ data: { ...snapshot, revision: 2, returnPending: true } })
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Next: unverified"))
  await setup.mockInput.typeText("/auto-switch-return")
  await setup.waitForFrame((text) => text.includes("Return to preferred model"))
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((text) => text.includes("Return to preferred requested"))
  expect(frame).toContain("Next: unverified")
  expect(edit).toEqual({ action: "return-to-preferred", ownerEpoch: "owner-a", revision: 1 })
})

test("quota retry sends only the guarded native action and reports acceptance, not completion", async () => {
  const submitted = Promise.withResolvers<unknown>()
  const response = Promise.withResolvers<Response>()
  const snapshot = {
    ...initial,
    quotaStop: { route: preferred, reason: "quota_exhausted" },
  } as const satisfies RouteSwitch.Status
  await using setup = await mount(async (url, request) => {
    if (url.pathname === endpoint) return json({ data: snapshot })
    if (url.pathname !== retryEndpoint || request.method !== "POST") return
    submitted.resolve(await request.json())
    return response.promise
  }, "retry")
  try {
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("Retry quota-stopped step"))
    await click(setup, "Retry quota-stopped step")
    await setup.waitForFrame((frame) => frame.includes("Requesting retry..."))
    expect(await submitted.promise).toEqual({ ownerEpoch: "owner-a", revision: 1 })
    response.resolve(json({ data: { ...snapshot, revision: 2 } }))
    const frame = await setup.waitForFrame((text) => text.includes("Retry requested"))
    expect(frame).toContain("Quota stopped:")
    expect(frame).not.toContain("Saved")
  } finally {
    response.resolve(new Response(null, { status: 500 }))
  }
})

test("a session invalidation updates the exact routes while the draft still submits its preferred model", async () => {
  let snapshot: RouteSwitch.Status = initial
  const submitted = Promise.withResolvers<{ text: unknown; model: unknown }>()
  let model: unknown
  await using setup = await mount(async (url, request) => {
    if (url.pathname === endpoint) return json({ data: snapshot })
    if (url.pathname === `/api/session/${sessionID}/model` && request.method === "POST") {
      model = await request.json()
      return new Response(null, { status: 204 })
    }
    if (url.pathname === `/api/session/${sessionID}/prompt`) {
      submitted.resolve({ text: (await request.json()).text, model })
      return json({ data: { id: "msg_route_submit" } })
    }
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Preferred model") && frame.includes("Auto-switch: Off"))
  await setup.mockInput.typeText("Keep the preferred route")
  snapshot = {
    ...initial,
    revision: 2,
    effective: alternate,
    quotaStop: { route: { ...alternate, modelID: "refused", variant: "low" }, reason: "reserve_held" },
  }
  setup.events.emit({
    id: "evt_route_switch",
    created: Date.now(),
    type: "session.route-switch.updated",
    data: { sessionID },
  })
  const frame = await setup.waitForFrame((text) => text.includes("Quota stopped:"))
  expect(frame).toContain("Using backup medium (preferred: primary high)")
  expect(frame).toContain("Next: primary high")
  expect(frame).toContain("Quota stopped: Build target/refused low (reserve held)")
  expect(frame).toContain("Keep the preferred route")

  setup.mockInput.pressEnter()
  expect(await submitted.promise).toEqual({
    text: "Keep the preferred route",
    model: { model: { providerID: "source", id: "primary", variant: "high" } },
  })
})
