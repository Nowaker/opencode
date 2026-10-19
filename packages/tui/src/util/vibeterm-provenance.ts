// Vibeterm delivery provenance on a user text part: the message text keeps a compact
// `[vibeterm_metadata]` block for the model, and `part.metadata.vibeterm` carries the full record
// for the reader. The model never sees part metadata, only `part.text`.
//
// This mirrors opencode-tools `_lib/vibeterm-provenance` (readVibetermProvenance, readPartProvenance,
// parseProvenanceBlock, fullProvenanceText) exactly, because the TUI cannot import it at runtime.
// test/util/vibeterm-provenance.test.ts checks parity against a fixture that codec produced.

export type MetadataPair = { readonly key: string; readonly value: string }

export type MetadataValue =
  | { readonly kind: "scalar"; readonly value: string }
  | { readonly kind: "map"; readonly entries: readonly MetadataPair[] }
  | { readonly kind: "records"; readonly records: readonly (readonly MetadataPair[])[] }

export type MetadataEntry = { readonly key: string; readonly value: MetadataValue }

export type VibetermProvenance = {
  readonly block: string
  readonly entries: readonly MetadataEntry[]
  readonly displayText?: string
  /** The exact `part.text` the record was written for; any other text means the record is stale. */
  readonly modelText: string
}

const OPEN = "[vibeterm_metadata]"
const CLOSE = "[/vibeterm_metadata]"
const TOP_LEVEL_LINE = /^([A-Za-z0-9_.-]+):[ \t]*(.*?)\s*$/
const RECORD_START_LINE = /^-[ \t]+([A-Za-z0-9_.-]+):[ \t]*(.*?)\s*$/
const NESTED_LINE = /^[ \t]+([A-Za-z0-9_.-]+):[ \t]*(.*?)\s*$/
const LEADING_BLOCK = /^\[vibeterm_metadata\]\r?\n[\s\S]*?\r?\n\[\/vibeterm_metadata\](?=$|\r?\n)/

type ProvenancePart = { readonly text: string; readonly metadata?: unknown }

// What the TUI shows for a part: the record and its full text, or nothing.
export function provenanceView(part: ProvenancePart) {
  const provenance = readPartProvenance(part)
  if (!provenance) return
  return { provenance, fullText: fullProvenanceText(part) }
}

// The record only while it still describes this part: the text starts with the compact block and is
// exactly the text the record was written for. An edit anywhere, wrapper or body, makes it stale, so
// metadata left over from an earlier text never stands in for what the user now sees.
export function readPartProvenance(part: ProvenancePart): VibetermProvenance | undefined {
  if (!LEADING_BLOCK.test(part.text)) return
  const provenance = readVibetermProvenance(part.metadata)
  if (provenance?.modelText !== part.text) return
  return provenance
}

export function readVibetermProvenance(metadata: unknown): VibetermProvenance | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.vibeterm)) return
  const envelope = metadata.vibeterm
  if (envelope.schema !== 1 || !isRecord(envelope.provenance)) return
  const provenance = envelope.provenance
  if (typeof provenance.block !== "string") return
  const parsed = parseProvenanceBlock(provenance.block)
  if (!parsed) return
  if (!isArrayOf(provenance.entries, isEntry)) return
  // Entries that disagree with their own block are not trusted; the block is authoritative.
  if (entryFingerprint(provenance.entries) !== entryFingerprint(parsed)) return
  if (provenance.displayText !== undefined && typeof provenance.displayText !== "string") return
  if (typeof provenance.modelText !== "string") return
  return {
    block: provenance.block,
    entries: parsed,
    ...(provenance.displayText === undefined ? {} : { displayText: provenance.displayText }),
    modelText: provenance.modelText,
  }
}

export function parseProvenanceBlock(block: string): readonly MetadataEntry[] | undefined {
  const lines = block.split(/\r?\n/)
  if (lines.shift() !== OPEN || lines.pop() !== CLOSE) return
  if (lines.some((line) => line === OPEN || line === CLOSE)) return
  const builders: { key: string; scalar: string; map: MetadataPair[]; records: MetadataPair[][] }[] = []
  let container: (typeof builders)[number] | undefined
  for (const line of lines) {
    const top = TOP_LEVEL_LINE.exec(line)
    if (top) {
      const builder = { key: top[1] ?? "", scalar: top[2] ?? "", map: [], records: [] }
      builders.push(builder)
      container = builder.scalar ? undefined : builder
      continue
    }
    if (!container) continue
    const recordStart = RECORD_START_LINE.exec(line)
    if (recordStart) {
      container.records.push([{ key: recordStart[1] ?? "", value: recordStart[2] ?? "" }])
      continue
    }
    const nested = NESTED_LINE.exec(line)
    if (!nested) continue
    const pair = { key: nested[1] ?? "", value: nested[2] ?? "" }
    const record = container.records.at(-1)
    if (record) record.push(pair)
    if (!record) container.map.push(pair)
  }
  return builders.map(
    (builder): MetadataEntry => ({
      key: builder.key,
      value:
        builder.records.length > 0
          ? { kind: "records", records: builder.records }
          : builder.map.length > 0
            ? { kind: "map", entries: builder.map }
            : { kind: "scalar", value: builder.scalar },
    }),
  )
}

// The full text a human saw: `displayText` when the record has it, otherwise the compact block at
// the start of the text swapped for the full block, the rest kept byte for byte. Text the record
// does not describe (see readPartProvenance) comes back unchanged, whatever the metadata says.
export function fullProvenanceText(part: ProvenancePart) {
  const leading = LEADING_BLOCK.exec(part.text)
  if (!leading) return part.text
  const provenance = readPartProvenance(part)
  if (!provenance) return part.text
  if (provenance.displayText !== undefined) return provenance.displayText
  return `${provenance.block}${part.text.slice(leading[0].length)}`
}

// Every entry as `key: value` lines, maps indented and each record a `- ` item, the shape the
// block itself uses.
export function provenanceFields(entries: readonly MetadataEntry[]) {
  return entries
    .flatMap((entry) => {
      if (entry.value.kind === "scalar") return [`${entry.key}: ${entry.value.value}`]
      if (entry.value.kind === "map") return [`${entry.key}:`, ...entry.value.entries.map((pair) => `  ${pair.key}: ${pair.value}`)]
      return [
        `${entry.key}:`,
        ...entry.value.records.flatMap((record) =>
          record.map((pair, index) => `${index === 0 ? "- " : "  "}${pair.key}: ${pair.value}`),
        ),
      ]
    })
    .join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isArrayOf<Value>(value: unknown, matches: (item: unknown) => item is Value): value is readonly Value[] {
  return Array.isArray(value) && value.every(matches)
}

function isPair(value: unknown): value is MetadataPair {
  return isRecord(value) && typeof value.key === "string" && typeof value.value === "string"
}

function isPairs(value: unknown): value is readonly MetadataPair[] {
  return isArrayOf(value, isPair)
}

function isValue(value: unknown): value is MetadataValue {
  if (!isRecord(value)) return false
  if (value.kind === "scalar") return typeof value.value === "string"
  if (value.kind === "map") return isPairs(value.entries)
  if (value.kind === "records") return isArrayOf(value.records, isPairs)
  return false
}

function isEntry(value: unknown): value is MetadataEntry {
  return isRecord(value) && typeof value.key === "string" && isValue(value.value)
}

// Key order normalized and unknown properties ignored; entry and record order and duplicates kept.
function entryFingerprint(entries: readonly MetadataEntry[]) {
  return JSON.stringify(entries, ["key", "value", "kind", "entries", "records"])
}
