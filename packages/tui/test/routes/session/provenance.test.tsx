/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { testRender } from "@opentui/solid"
import type { Part } from "@opencode-ai/sdk/v2"
import { TuiConfigProvider } from "../../../src/config"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import {
  messageProvenance,
  provenanceExpanded,
  ProvenanceView,
  setProvenance,
  toggleAllProvenance,
} from "../../../src/routes/session/provenance"
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
const compact = "[vibeterm_metadata]\ncall: vibeterm_prompt_session\n[/vibeterm_metadata]\n\nbody"

function textPart(id: string, text: string, metadata?: unknown) {
  return { id, sessionID: "ses_x", messageID: "msg_x", type: "text", text, metadata } as Part
}
const record = { vibeterm: { schema: 1, provenance: { block, entries: parseProvenanceBlock(block), modelText: compact } } }

test("messageProvenance keeps only text parts with a valid record and a leading compact block", () => {
  const views = messageProvenance([
    textPart("prt_a", compact, record),
    textPart("prt_b", compact),
    textPart("prt_c", compact, { vibeterm: { schema: 2, provenance: record.vibeterm.provenance } }),
    textPart("prt_d", "edited", record),
    { ...textPart("prt_e", compact, record), synthetic: true } as Part,
  ])
  expect(views.map((view) => view.id)).toEqual(["prt_a"])
  expect(views[0].fullText).toBe(`${block}\n\nbody`)
})

test("expansion: one view at a time, the session-wide toggle resets them", () => {
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

test("renders a collapsed row, and the full text and every field once expanded", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  const view = messageProvenance([textPart("prt_render", compact, record)])[0]
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <ProvenanceView id={view.id} provenance={view.provenance}>
                <text>{view.fullText}</text>
              </ProvenanceView>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 30 },
  )
  const frame = async (expect: string) => {
    const start = Date.now()
    while (!app.captureCharFrame().includes(expect)) {
      if (Date.now() - start > 2000) throw new Error(`never rendered: ${expect}\n${app.captureCharFrame()}`)
      await app.renderOnce()
      await Bun.sleep(10)
    }
    return app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
  }
  try {
    expect(await frame("Click to expand")).toEqual(["▸ Delivery provenance · 3 fields · Click to expand"])
    setProvenance([view.id], true)
    expect(await frame("Click to collapse")).toEqual([
      "▾ Delivery provenance · 3 fields · Click to collapse",
      "  [vibeterm_metadata]",
      "  call: vibeterm_prompt_session",
      "  sent_at_local: 2026-10-19T03:58:07-05:00",
      "  records:",
      "  - id: one",
      "    at: first",
      "  [/vibeterm_metadata]",
      "  body",
      "  Fields",
      "  call: vibeterm_prompt_session",
      "  sent_at_local: 2026-10-19T03:58:07-05:00",
      "  records:",
      "  - id: one",
      "    at: first",
    ])
  } finally {
    app.renderer.destroy()
  }
})
