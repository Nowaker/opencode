import { afterEach, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Schema } from "effect"
import path from "node:path"
import type { rpc } from "@/cli/tui/worker"
import { Server } from "@/server/server"
import { SessionID } from "@/session/schema"
import { Rpc } from "@/util/rpc"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("an unbound server reports auto-switch unavailable and refuses writes for a persisted session", async () => {
  // Pin registration before issuing requests so a missing route cannot fall through to the external UI proxy.
  const spec = await Server.openapi()
  expect(spec.paths["/session/{sessionID}/auto-switch"]?.get?.responses["200"]).toBeDefined()
  expect(spec.paths["/session/{sessionID}/auto-switch"]?.put?.responses["503"]).toBeDefined()

  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const app = Server.Default().app
  const health = await app.request("/global/health")
  expect(health.status).toBe(200)
  expect(await health.json()).toMatchObject({ healthy: true, autoSwitch: 1 })
  const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
  const created = await app.request("/session", { method: "POST", headers, body: JSON.stringify({}) })
  expect(created.status).toBe(200)
  const session = Schema.decodeUnknownSync(Schema.Struct({ id: SessionID }))(await created.json())
  const path = `/session/${session.id}/auto-switch`

  const read = await app.request(path, { headers })
  expect(read.status).toBe(200)
  const status: unknown = await read.json()
  expect(status).toMatchObject({
    version: 1,
    sessionID: session.id,
    availability: "unavailable",
    ownerEpoch: null,
    revision: null,
    enabled: false,
    returnPending: false,
    returnPreference: "inherit",
    returnEnabled: false,
    returnState: "preferred",
    next: null,
  })

  const write = await app.request(path, {
    method: "PUT",
    headers,
    body: JSON.stringify({ action: "set-preference", preference: "on", ownerEpoch: "unbound", revision: 0 }),
  })
  expect(write.status).toBe(503)
  expect(await write.json()).toEqual(status)
})

test("the native worker keeps return and switch preferences independent and leaves both unchanged on stale writes", async () => {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const policy = path.join(tmp.path, "auto-switch-policy.mjs")
  await Bun.write(policy, `
    export function readAutoSwitchPolicy({ preference }) {
      return {
        enabled: preference === "on",
        reason: preference === "on" ? "session-on" : "default-off",
        alternates: [],
        policyRevision: "test",
      }
    }
  `)
  const worker = new Worker(new URL("../../src/cli/tui/worker.ts", import.meta.url), {
    env: { ...process.env, VIBETERM_AUTO_SWITCH_POLICY_MODULE: policy },
  })
  const transport = Rpc.client<typeof rpc>(worker)
  try {
    const listener = await transport.call("server", { hostname: "127.0.0.1", port: 0 })
    const client = createOpencodeClient({ baseUrl: listener.url, directory: tmp.path })
    const route = { agent: "build", providerID: "test", modelID: "preferred", variant: null } as const
    const root = (
      await client.session.create(
        { title: "Owner", agent: route.agent, model: { providerID: route.providerID, id: route.modelID } },
        { throwOnError: true },
      )
    ).data.id
    const other = (await client.session.create({ title: "Unrelated" }, { throwOnError: true })).data.id
    expect(await transport.call("bindAutoSwitchOwner", { sessionID: root })).toBe(true)
    expect(await transport.call("bindAutoSwitchOwner", { sessionID: other })).toBe(false)

    const read = await client.session.autoSwitch.status({ sessionID: root }, { throwOnError: true })
    expect(read.data).toMatchObject({
      availability: "available",
      sessionID: root,
      preference: "inherit",
      revision: 0,
      returnPreference: "inherit",
      returnEnabled: true,
      returnState: "preferred",
      next: route,
    })
    if (read.data.ownerEpoch === null || read.data.revision === null) throw new Error("owner capability not issued")
    const mutation = {
      action: "set-preference",
      preference: "on",
      ownerEpoch: read.data.ownerEpoch,
      revision: read.data.revision,
    } as const

    const unrelated = await client.session.autoSwitch.update({ sessionID: other, autoSwitchMutation: mutation })
    expect(unrelated.response.status).toBe(503)
    expect(unrelated.error).toMatchObject({ sessionID: other, reason: "owner-unavailable", ownerEpoch: null })
    expect(unrelated.error).toEqual((await client.session.autoSwitch.status({ sessionID: other })).data)

    const update = await client.session.autoSwitch.update({ sessionID: root, autoSwitchMutation: mutation })
    expect(update.response.status).toBe(200)
    expect(update.data).toMatchObject({ sessionID: root, preference: "on", enabled: true, revision: 1 })

    const stale = await client.session.autoSwitch.update({ sessionID: root, autoSwitchMutation: mutation })
    expect(stale.response.status).toBe(409)
    expect(stale.error).toEqual(update.data)

    const returnMutation = { ...mutation, action: "set-return-preference", preference: "off", revision: 1 } as const
    const returnUpdate = await client.session.autoSwitch.update(
      { sessionID: root, autoSwitchMutation: returnMutation },
      { throwOnError: true },
    )
    expect(returnUpdate.response.status).toBe(200)
    expect(returnUpdate.data).toMatchObject({
      sessionID: root,
      preference: "on",
      enabled: true,
      returnPreference: "off",
      returnEnabled: false,
      returnState: "preferred",
      next: route,
      revision: 2,
    })

    const staleReturn = await client.session.autoSwitch.update({
      sessionID: root,
      autoSwitchMutation: { ...returnMutation, preference: "on" },
    })
    expect(staleReturn.response.status).toBe(409)
    expect(staleReturn.error).toEqual(returnUpdate.data)
    expect((await client.session.autoSwitch.status({ sessionID: root }, { throwOnError: true })).data).toEqual(
      returnUpdate.data,
    )
  } finally {
    worker.terminate()
  }
})
