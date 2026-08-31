const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

// Printable ASCII and newline are each exactly one display column, so a run of them
// carries no grapheme ambiguity and its width is its length. Sticky so the scan stops
// at the first character needing segmentation without copying the prefix out.
const plainRun = /[\x20-\x7e\n]*/y
const whitespace = /\s/

function plainPrefixLength(value: string) {
  plainRun.lastIndex = 0
  plainRun.exec(value)
  return plainRun.lastIndex
}

function graphemeWidth(segment: string) {
  // Textarea offsets count newlines as one position; Bun.stringWidth counts them as zero.
  return segment === "\n" ? 1 : Bun.stringWidth(segment)
}

// Resume segmentation one character before the plain run ends: the last plain character
// can be the base of a cluster that continues past it, such as "e" followed by U+0301.
function segmentStart(plain: number) {
  return plain === 0 ? 0 : plain - 1
}

export function promptOffsetWidth(value: string) {
  const plain = plainPrefixLength(value)
  if (plain === value.length) return plain

  const start = segmentStart(plain)
  let width = start
  for (const part of graphemes.segment(value.slice(start))) {
    width += graphemeWidth(part.segment)
  }
  return width
}

function displayOffsetIndex(value: string, offset: number) {
  if (offset <= 0) return 0

  const plain = plainPrefixLength(value)
  if (plain === value.length) return Math.min(offset, plain)
  if (offset < plain) return offset

  const start = segmentStart(plain)
  let width = start
  for (const part of graphemes.segment(value.slice(start))) {
    const next = width + graphemeWidth(part.segment)
    if (next > offset) return start + part.index
    width = next
  }

  return value.length
}

export function displaySlice(value: string, start = 0, end = promptOffsetWidth(value)) {
  return value.slice(displayOffsetIndex(value, start), displayOffsetIndex(value, end))
}

export function displayCharAt(value: string, offset: number) {
  // Needs the next character to be plain too, otherwise it may continue this cluster.
  if (offset >= 0 && offset + 1 < plainPrefixLength(value)) return value[offset]

  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + graphemeWidth(part.segment)
    if (offset === width || offset < next) return part.segment
    width = next
  }
}

export function mentionTriggerIndex(value: string, offset = promptOffsetWidth(value)) {
  const cursor = displayOffsetIndex(value, offset)

  // The trigger can only be the "@" opening the final whitespace-free run before the
  // cursor: an "@" later in that run has a non-space in front of it, and one before the
  // run has whitespace between itself and the cursor. Bounding the scan to that run
  // keeps a keystroke proportional to the word being typed, not to the whole buffer.
  let start = cursor
  while (start > 0 && !whitespace.test(value[start - 1])) start--

  if (start === cursor || value[start] !== "@") return
  if (value.slice(start + 1, cursor).includes("@")) return
  return promptOffsetWidth(value.slice(0, start))
}
