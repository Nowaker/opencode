/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { MouseButton } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Part } from "@opencode-ai/sdk/v2"
import { TuiConfigProvider } from "../../../src/config"
import { ClipboardProvider } from "../../../src/context/clipboard"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import {
  messageProvenance,
  provenanceExpanded,
  setProvenance,
  toggleAllProvenance,
  vibetermHead,
  VibetermSection,
  type VibetermHead,
} from "../../../src/routes/session/provenance"
import { ToastProvider } from "../../../src/ui/toast"
import { parseProvenanceBlock } from "../../../src/util/vibeterm-provenance"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const block = [
  "[vibeterm_metadata]",
  "call: vibeterm_prompt_session",
  "sent_at_local: 2026-10-19T03:58:07-05:00",
  "records:",
  "- id: one",
  "  at: first",
  "[/vibeterm_metadata]",
].join("\n")
const compact = "[vibeterm_metadata]\ncall: vibeterm_prompt_session\n[/vibeterm_metadata]\n\n---\n\nbody"

function textPart(id: string, text: string, metadata?: unknown) {
  return { id, sessionID: "ses_x", messageID: "msg_x", type: "text", text, metadata } as Part
}
const record = (modelText = compact, displayText?: string) => ({
  vibeterm: {
    schema: 1,
    provenance: { block, entries: parseProvenanceBlock(block), modelText, ...(displayText ? { displayText } : {}) },
  },
})

test("messageProvenance keeps only text parts with a valid record and a leading compact block", () => {
  const views = messageProvenance([
    textPart("prt_a", compact, record()),
    textPart("prt_b", compact),
    textPart("prt_c", compact, { vibeterm: { schema: 2, provenance: record().vibeterm.provenance } }),
    textPart("prt_d", "edited", record()),
    { ...textPart("prt_e", compact, record()), synthetic: true } as Part,
  ])
  expect(views.map((view) => view.id)).toEqual(["prt_a"])
  expect(views[0].fullText).toBe(`${block}\n\n---\n\nbody`)
})

test("expansion: one section at a time, the session-wide toggle resets them", () => {
  setProvenance(["prt_1"], true)
  expect(provenanceExpanded("prt_1")).toBe(true)
  expect(provenanceExpanded("prt_2")).toBe(false)
  toggleAllProvenance()
  expect(provenanceExpanded("prt_2")).toBe(true)
  setProvenance(["prt_2"], false)
  expect(provenanceExpanded("prt_2")).toBe(false)
  toggleAllProvenance()
  expect(provenanceExpanded("prt_1")).toBe(false)
  expect(provenanceExpanded("prt_2")).toBe(false)
})

test("vibetermHead splits the compact fields from the body and reads the stored record", () => {
  expect(vibetermHead([textPart("prt_a", compact, record())])).toEqual({
    id: "prt_a",
    head: "[vibeterm_metadata]\ncall: vibeterm_prompt_session\n[/vibeterm_metadata]",
    fields: "call: vibeterm_prompt_session",
    body: "body",
    full: {
      head: block,
      fields: block.split("\n").slice(1, -1).join("\n"),
      count: 3,
      body: undefined,
    },
  })
})

test("vibetermHead without a stored record, with a stale one, and without a block", () => {
  expect(vibetermHead([textPart("prt_a", compact)])?.full).toBeUndefined()
  expect(vibetermHead([textPart("prt_a", `${compact} edited`, record())])).toMatchObject({ body: "body edited", full: undefined })
  expect(vibetermHead([textPart("prt_a", "plain prompt", record("plain prompt"))])).toBeUndefined()
  expect(vibetermHead([textPart("prt_a", ` ${compact}`)])).toBeUndefined()
})

test("vibetermHead folds several leading blocks into one section and keeps later text parts in the body", () => {
  const text = "[vibeterm_metadata]\nprofile_override: p\n[/vibeterm_metadata]\n\n" + compact
  const found = vibetermHead([
    textPart("prt_a", text),
    { ...textPart("prt_s", "synthetic"), synthetic: true } as Part,
    textPart("prt_b", "second part"),
  ])
  expect(found).toMatchObject({ fields: "profile_override: p\ncall: vibeterm_prompt_session", body: "body\n\nsecond part" })
})

test("vibetermHead keeps the full body a record carries when it differs from what the model saw", () => {
  const found = vibetermHead([textPart("prt_a", compact, record(compact, `${block}\n\n---\n\nthe whole question`))])
  expect(found?.full?.body).toBe("the whole question")
})

async function render(root: string, head: VibetermHead) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  const copied: string[] = []
  let below = 0
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <ToastProvider>
                <ClipboardProvider value={{ write: async (text) => void copied.push(text) }}>
                  <box>
                    <VibetermSection head={head}>
                      <text>{head.full?.body ?? ""}</text>
                    </VibetermSection>
                    <box onMouseUp={() => below++}>
                      <text>agent section</text>
                    </box>
                  </box>
                </ClipboardProvider>
              </ToastProvider>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 20 },
  )
  const frame = async (expected: string) => {
    const start = Date.now()
    while (!app.captureCharFrame().includes(expected)) {
      if (Date.now() - start > 2000) throw new Error(`never rendered: ${expected}\n${app.captureCharFrame()}`)
      await app.renderOnce()
      await Bun.sleep(10)
    }
    return app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
  }
  return { app, frame, copied, below: () => below }
}

test("renders the compact fields without tags; a click anywhere in the section opens the full record", async () => {
  await using tmp = await tmpdir()
  const view = await render(tmp.path, vibetermHead([textPart("prt_render", compact, record())])!)
  try {
    expect(await view.frame("Click to expand")).toEqual([
      "┃",
      "┃  call: vibeterm_prompt_session",
      "┃  ▸ 3 fields in the full record · Click to expand",
      "┃",
      "agent section",
    ])
    // Row 0 is the section's top padding: a click there still belongs to the section.
    await view.app.mockMouse.click(30, 0)
    expect(await view.frame("Click to collapse")).toEqual([
      "┃",
      "┃  call: vibeterm_prompt_session",
      "┃  sent_at_local: 2026-10-19T03:58:07-05:00",
      "┃  records:",
      "┃  - id: one",
      "┃    at: first",
      "┃  ▾ Click to collapse",
      "┃",
      "agent section",
    ])
    // Row 7 is the bottom padding, right above the agent section.
    await view.app.mockMouse.click(30, 7)
    await view.frame("Click to expand")
    expect(view.below()).toBe(0)
    await view.app.mockMouse.click(5, 1, MouseButton.RIGHT)
    await Bun.sleep(20)
    expect(view.copied).toEqual([block])
    expect(view.below()).toBe(0)
    await view.app.mockMouse.click(2, 4)
    expect(view.below()).toBe(1)
  } finally {
    view.app.renderer.destroy()
  }
})

test("a section without a stored record shows the compact fields and does not expand", async () => {
  await using tmp = await tmpdir()
  const view = await render(tmp.path, vibetermHead([textPart("prt_plain", compact)])!)
  try {
    const before = await view.frame("call:")
    expect(before).toEqual(["┃", "┃  call: vibeterm_prompt_session", "┃", "agent section"])
    await view.app.mockMouse.click(10, 1)
    await view.app.renderOnce()
    expect(await view.frame("call:")).toEqual(before)
    expect(view.below()).toBe(0)
  } finally {
    view.app.renderer.destroy()
  }
})
