import { beforeEach, expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { createRoot } from "solid-js"
import type { ComposerObservation } from "@opencode/plugin/tui/context"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { mountComposer } from "./fixture/composer"
import { directory, json } from "./fixture/tui-client"

beforeEach(() => takeDraft(undefined))

test("subscriptions created by a Solid owner end with that owner while the TUI stays active", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  const values: ComposerObservation[] = []
  using owner = createRoot((dispose) => {
    setup.composer.subscribe((value) => values.push(value))
    return { [Symbol.dispose]: dispose }
  })
  expect(values).toHaveLength(1)
  owner[Symbol.dispose]()
  await setup.mockInput.typeText("after owner cleanup")
  expect(values).toHaveLength(1)
  expect(setup.composer.current()).toMatchObject({ status: "ready", draft: { text: "after owner cleanup" } })
})

test("a selected session with no mounted final composer explicitly reports not-mounted", async () => {
  const form = {
    id: "frm_observation",
    sessionID: "ses_observation_a",
    title: "Pending question",
    fields: [{ key: "answer", type: "string", title: "Question answer" }],
  }
  await using setup = await mountComposer({
    args: { sessionID: form.sessionID },
    fetch: (url) => (url.pathname === `/api/session/${form.sessionID}/form` ? json({ data: [form] }) : undefined),
  })
  await setup.waitForFrame((frame) => frame.includes(form.title))
  await setup.mockInput.typeText("question text")
  expect(setup.composer.current()).toEqual({ status: "unavailable", reason: "not-mounted" })
  setup.events.emit({
    id: "evt_observation_settled",
    created: 1,
    type: "form.replied",
    location: { directory },
    data: { id: form.id, sessionID: form.sessionID, answer: { answer: "question text" } },
  })
  await setup.waitFor(() => setup.composer.current().status === "ready")
  expect(setup.composer.current()).toMatchObject({
    sessionID: "ses_observation_a",
    draft: { text: "", caret: 0, selection: { anchor: 0, focus: 0 } },
  })
})

test("deactivation disposes setup subscriptions and retained API access without stale callbacks", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  await setup.mockInput.typeText("draft")
  setup.mockInput.pressKey("p", { ctrl: true })
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
  await setup.mockInput.typeText("plugins")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("fixture.composer-observation"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
  await setup.mockInput.typeText("composer-observation")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("inactive"))
  expect(setup.composer.current()).toEqual({ status: "unavailable", reason: "disposed" })
  const count = setup.changes.length
  setup.mockInput.pressEscape()
  await setup.mockInput.typeText(" after unload")
  expect(setup.changes).toHaveLength(count)
})
