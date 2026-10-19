import { describe, expect, test } from "bun:test"
import fixtures from "../fixture/vibeterm-provenance.json"
import {
  fullProvenanceText,
  parseProvenanceBlock,
  provenanceFields,
  provenanceView,
  readPartProvenance,
  readVibetermProvenance,
} from "../../src/util/vibeterm-provenance"

// Cases of opencode-tools _lib/vibeterm-provenance/fixtures/tui-fork.json, the shared codec's
// fixture. Every case must read and restore exactly as that codec does.
describe("vibeterm provenance codec parity", () => {
  for (const [index, fixture] of fixtures.entries()) {
    test(`fixture ${index}`, () => {
      expect<unknown>(readVibetermProvenance(fixture.metadata)?.entries ?? null).toEqual(fixture.expectedEntries)
      expect(fullProvenanceText(fixture)).toBe(fixture.expectedFullText)
    })
  }
})

const block = "[vibeterm_metadata]\ncall: vibeterm_prompt_session\nsent_at: 2026-10-19T08:58:07Z\nsent_at_local: 2026-10-19T03:58:07-05:00\n[/vibeterm_metadata]"
const compact = "[vibeterm_metadata]\ncall: vibeterm_prompt_session\n[/vibeterm_metadata]"
const metadata = (provenance: Record<string, unknown>, schema: unknown = 1) => ({ vibeterm: { schema, provenance } })
const body = `${compact}\n\n---\n\nbody\n`
const valid = { block, entries: parseProvenanceBlock(block), modelText: body }

describe("readVibetermProvenance", () => {
  test("reads the inner record", () => {
    expect(readVibetermProvenance(metadata(valid))).toEqual({ block, entries: valid.entries!, modelText: body })
  })

  test("rejects a missing envelope, another schema and malformed records", () => {
    expect(readVibetermProvenance(undefined)).toBeUndefined()
    expect(readVibetermProvenance({})).toBeUndefined()
    expect(readVibetermProvenance({ vibeterm: "x" })).toBeUndefined()
    expect(readVibetermProvenance(metadata(valid, 2))).toBeUndefined()
    expect(readVibetermProvenance(metadata(valid, "1"))).toBeUndefined()
    expect(readVibetermProvenance(metadata({ ...valid, block: "call: x" }))).toBeUndefined()
    expect(readVibetermProvenance(metadata({ ...valid, entries: "x" }))).toBeUndefined()
    expect(readVibetermProvenance(metadata({ ...valid, entries: [{ key: "a", value: { kind: "list", value: "x" } }] }))).toBeUndefined()
    expect(readVibetermProvenance(metadata({ ...valid, entries: [{ key: "a", value: { kind: "map", entries: [{ key: "b", value: 1 }] } }] }))).toBeUndefined()
    expect(readVibetermProvenance(metadata({ ...valid, displayText: 7 }))).toBeUndefined()
    expect(readVibetermProvenance(metadata({ ...valid, entries: valid.entries!.slice(1) }))).toBeUndefined()
    expect(readVibetermProvenance(metadata({ ...valid, entries: [...valid.entries!].reverse() }))).toBeUndefined()
    expect(readVibetermProvenance(metadata({ block, entries: valid.entries }))).toBeUndefined()
    expect(readVibetermProvenance(metadata({ ...valid, modelText: 1 }))).toBeUndefined()
  })
})

describe("readPartProvenance and provenanceView", () => {
  test("restores the full block and keeps the body byte for byte", () => {
    expect(provenanceView({ text: body, metadata: metadata(valid) })?.fullText).toBe(`${block}\n\n---\n\nbody\n`)
  })

  test("prefers displayText", () => {
    const text = `${compact}\nshort`
    const part = { text, metadata: metadata({ ...valid, modelText: text, displayText: `${block}\nthe whole question` }) }
    expect(provenanceView(part)?.fullText).toBe(`${block}\nthe whole question`)
  })

  test("a record is stale once the text differs from modelText anywhere, wrapper or body", () => {
    const edited = (text: string) => ({ text, metadata: metadata({ ...valid, displayText: "the original" }) })
    for (const text of [`${compact}\n\n---\n\nbody edited\n`, body.replace("call:", "call: x"), `${body} `]) {
      expect(readPartProvenance(edited(text))).toBeUndefined()
      expect(provenanceView(edited(text))).toBeUndefined()
      expect(fullProvenanceText(edited(text))).toBe(text)
    }
  })

  test("shows nothing without a valid record or a leading compact block", () => {
    expect(provenanceView({ text: body })).toBeUndefined()
    expect(provenanceView({ text: body, metadata: metadata(valid, 2) })).toBeUndefined()
    expect(provenanceView({ text: "edited body", metadata: metadata({ ...valid, modelText: "edited body" }) })).toBeUndefined()
    expect(provenanceView({ text: ` ${body}`, metadata: metadata({ ...valid, modelText: ` ${body}` }) })).toBeUndefined()
  })
})

test("provenanceFields lists every entry in the block's own shape", () => {
  const entries = parseProvenanceBlock(
    "[vibeterm_metadata]\ncall: x\nmap:\n  item: first\n  item: second\nrecords:\n- id: one\n  at_local: kept\n- id: two\n[/vibeterm_metadata]",
  )!
  expect(provenanceFields(entries)).toBe(
    "call: x\nmap:\n  item: first\n  item: second\nrecords:\n- id: one\n  at_local: kept\n- id: two",
  )
})
