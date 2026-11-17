import assert from "node:assert/strict"
import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import type { CatalogDefault, CatalogOutcome } from "../fixture/catalog-client"
import { model } from "../fixture/local"
import {
  homeBoundSelection,
  catalogError,
  draftText,
  frameText,
  mountCatalogSubmit,
  waitingForModels,
} from "../fixture/catalog-submit"

const defaults: readonly CatalogDefault[] = ["cli", "configured", "recent"]
test("a usable warm selection sends without waiting for unrelated metadata catalogs", async () => {
  await using setup = await mountCatalogSubmit({ gate: "metadata" })
  await Promise.all([
    setup.context.data.location.agent.sync(setup.location.ref),
    setup.context.data.location.model.sync(setup.location.ref),
    setup.context.data.session.sync("ses_observation_a"),
  ])
  expect(setup.local.model.available()).toBe(true)
  setup.renderer.stdin.emit("data", Buffer.from(`${draftText}\r`))
  await setup.wire.received()
  await setup.cleared()
  expect(setup.wire.prompts).toHaveLength(1)
  expect(frameText(setup.captureCharFrame())).not.toMatch(waitingForModels)
})

test("a known Session pair is captured at Enter before a background selection update", async () => {
  await using setup = await mountCatalogSubmit()
  await setup.context.data.session.sync("ses_observation_a")
  await setup.arm()
  const info = setup.context.data.session.get("ses_observation_a")
  assert.ok(info)
  setup.data.session.remember({
    ...info,
    model: { providerID: "provider", id: "alternate", variant: "high" },
  })
  const bound = setup.bound()
  await setup.release()
  await bound
  await setup.wire.received()
  await setup.cleared()
  expect(setup.wire.prompts).toHaveLength(1)
  expect(setup.wire.modelRequests).toEqual([{ providerID: "provider", id: "intended", variant: "low" }])
})

test.each(defaults)("a new Home intent binds the normal %s model before its first send", async (source) => {
  await using setup = await mountCatalogSubmit({ home: true, source })
  expect(setup.context.ui.model.current()).toBeUndefined()
  await setup.arm()
  const observations: { readonly frame: string; readonly writes: number }[] = []
  const bound = setup.bound(() => observations.push({
    frame: frameText(setup.captureCharFrame()),
    writes: setup.wire.writes.length,
  }))
  await setup.release()
  await bound
  await setup.wire.received()
  await setup.cleared()
  expect(frameText(setup.captureCharFrame())).not.toMatch(waitingForModels)
  const visible = observations.at(0)
  const sent = setup.wire.prompts.at(0)
  assert.ok(visible)
  assert.ok(sent)
  expect(visible.frame).toMatch(homeBoundSelection)
  expect(visible.frame).toMatch(waitingForModels)
  expect(visible.writes).toBe(0)
  expect(sent.frame).toMatch(homeBoundSelection)
  expect(setup.wire.prompts).toHaveLength(1)
  expect(setup.wire.creationRequests).toMatchObject([
    { agent: "build", model: { providerID: "provider", id: "intended", variant: "low" } },
  ])
  expect(sent.text).toBe(draftText)
})

test("a later catalog replacement cannot rebind or replay the consumed Home intent", async () => {
  await using setup = await mountCatalogSubmit({ home: true, source: "recent" })
  await setup.arm()
  const bound = setup.bound()
  await setup.release()
  await bound
  await setup.wire.received()
  await setup.cleared()
  const writes = setup.wire.writes.length
  setup.wire.catalog.models = [model("alternate", ["low", "high"]), model("decoy")]
  await setup.refresh()
  await setup.renderOnce()
  expect(setup.context.data.location.model.list(setup.location.ref)?.map((item) => item.id)).toEqual(["alternate", "decoy"])
  expect(setup.wire.creationRequests).toMatchObject([{ model: { id: "intended", variant: "low" } }])
  expect(setup.wire.prompts).toHaveLength(1)
  expect(setup.wire.writes).toHaveLength(writes)
})

const choices = [
  { name: "agent", command: "agent.cycle", agent: "build", model: "intended", variant: "low", label: "Build" },
  { name: "model", command: "model.cycle_recent", agent: "plan", model: "alternate", variant: undefined, label: "alternate" },
  { name: "variant", command: "variant.cycle", agent: "plan", model: "intended", variant: "high", label: "high" },
]
test.each(choices)("a USER $name change in the visible bound frame cancels the intent", async (row) => {
  await using setup = await mountCatalogSubmit()
  await setup.arm()
  const bound = setup.bound(() => setup.context.keymap.dispatch(row.command))
  await setup.release()
  await bound
  await setup.waitForFrame((frame) => !waitingForModels.test(frameText(frame)) && frame.includes(row.label))
  expect(setup.local.agent.current()?.id).toBe(row.agent)
  expect(setup.context.ui.model.current()?.modelID).toBe(row.model)
  expect(setup.context.ui.model.current()?.variant).toBe(row.variant)
  expect(setup.draft().text).toBe(draftText)
  expect(setup.wire.writes).toHaveLength(0)
})

const failures: readonly Exclude<CatalogOutcome, "ready">[] = [
  "empty-model",
  "empty-agent",
  "error-model",
  "error-agent",
]
test.each(failures)("%s shows an error, retains the draft and drops the intent through recovery", async (outcome) => {
  await using setup = await mountCatalogSubmit()
  await setup.arm()
  await setup.release(outcome)
  await setup.waitForFrame((frame) => {
    const visible = frameText(frame)
    return catalogError.test(visible) && !waitingForModels.test(visible)
  })
  expect(setup.draft().text).toBe(draftText)
  expect(setup.wire.writes).toHaveLength(0)
  await setup.refresh()
  await setup.renderOnce()
  expect(setup.local.model.catalogReady).toBe(true)
  expect(setup.local.model.available()).toBe(true)
  expect(setup.draft().text).toBe(draftText)
  expect(setup.wire.writes).toHaveLength(0)
})

test("rejected eventual admission restores the draft and never resends on a catalog refresh", async () => {
  await using setup = await mountCatalogSubmit({ rejectPrompt: true })
  await setup.arm()
  const bound = setup.bound()
  await setup.release()
  await bound
  await setup.wire.received()
  await setup.waitForFrame((frame) => /(?:failed|rejected).*prompt/i.test(frameText(frame)) && setup.draft().text === draftText)
  const writes = setup.wire.writes.length
  await setup.refresh()
  await setup.renderOnce()
  expect(setup.draft().text).toBe(draftText)
  expect(setup.wire.prompts).toHaveLength(1)
  expect(setup.wire.writes).toHaveLength(writes)
})

test.each([44, 100])("the model-list waiting state retains the draft at %s columns without sending", async (width) => {
  await using setup = await mountCatalogSubmit({ width })
  setup.renderer.stdin.emit("data", Buffer.from(draftText))
  await setup.waitForFrame(() => setup.draft().text === draftText)
  const editor = setup.renderer.currentFocusedEditor
  assert.ok(editor instanceof TextareaRenderable)
  const size = { width: editor.width, height: editor.height }
  const draft = setup.draft()
  setup.renderer.stdin.emit("data", Buffer.from("\r"))
  await setup.waitForFrame((frame) => waitingForModels.test(frameText(frame)))
  expect(frameText(setup.captureCharFrame())).toMatch(waitingForModels)
  expect(frameText(setup.captureCharFrame())).toContain(draftText)
  expect(setup.draft().text).toBe(draftText)
  expect(setup.wire.writes).toHaveLength(0)
  expect({ width: editor.width, height: editor.height }).toEqual(size)
  expect(setup.draft()).toEqual(draft)
})
