export * as StartupInputBytes from "./input"

// Byte-level tokenizer for the startup editor. It owns raw terminal bytes until a handover asks for a cutoff, so it
// keeps every byte it has not turned into a token: the bytes after the last complete token are returned untouched and
// in order, never decoded to a string and re-encoded. The renderer's own parser starts on them at a token boundary.

export type Key = {
  readonly name: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly super: boolean
}

export type Token =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "key"; readonly key: Key }
  | { readonly type: "paste"; readonly text: string }
  | { readonly type: "ignore" }

const ESC = 0x1b
const PASTE_START = [ESC, 0x5b, 0x32, 0x30, 0x30, 0x7e]
const PASTE_END = [ESC, 0x5b, 0x32, 0x30, 0x31, 0x7e]
const decoder = new TextDecoder("utf-8", { fatal: false })

const key = (name: string, modifiers: Partial<Omit<Key, "name">> = {}): Key => ({
  name,
  ctrl: modifiers.ctrl ?? false,
  alt: modifiers.alt ?? false,
  shift: modifiers.shift ?? false,
  super: modifiers.super ?? false,
})

export function createTokenizer() {
  let buffer = new Uint8Array(0)
  return {
    push(bytes: Uint8Array) {
      if (bytes.length === 0) return
      const next = new Uint8Array(buffer.length + bytes.length)
      next.set(buffer)
      next.set(bytes, buffer.length)
      buffer = next
    },
    /**
     * Takes the next complete token from the front. `single` limits printable text to one code point, so a cutoff
     * never applies text that followed the token it was waiting for. Returns undefined when the front is empty or
     * incomplete.
     */
    next(options: { single?: boolean } = {}): Token | undefined {
      const result = scan(buffer, options.single ?? false)
      if (!result) return
      buffer = buffer.subarray(result.length)
      return result.token
    },
    /**
     * The front is a lone Escape, or Escape plus an introducer that Alt can also produce. At its deadline it becomes
     * that key unless more bytes extend it first.
     */
    get escapePending() {
      return buffer[0] === ESC && buffer.length <= 2 && !scan(buffer, true)
    },
    flushEscape(): Token | undefined {
      if (buffer[0] !== ESC || buffer.length > 2 || scan(buffer, true)) return
      const second = buffer[1]
      buffer = buffer.subarray(buffer.length)
      if (second === undefined) return { type: "key", key: key("escape") }
      return { type: "key", key: printable(String.fromCharCode(second), { alt: true }) }
    },
    /** Whether bytes remain that do not yet form a complete token. */
    get incomplete() {
      return buffer.length > 0 && !scan(buffer, true)
    },
    /** Every byte not consumed by a token, in arrival order. */
    rest() {
      return buffer.slice()
    },
  }
}

export type Tokenizer = ReturnType<typeof createTokenizer>

function scan(bytes: Uint8Array, single: boolean): { token: Token; length: number } | undefined {
  const first = bytes[0]
  if (first === undefined) return
  if (first === ESC) return escape(bytes)
  if (first < 0x20 || first === 0x7f) return { token: { type: "key", key: control(first) }, length: 1 }
  return text(bytes, 0, single)
}

function control(byte: number): Key {
  if (byte === 0x0d) return key("return")
  if (byte === 0x0a) return key("j", { ctrl: true })
  if (byte === 0x09) return key("tab")
  if (byte === 0x7f || byte === 0x08) return key("backspace")
  if (byte === 0x00) return key("space", { ctrl: true })
  return key(String.fromCharCode(byte + 0x60), { ctrl: true })
}

// Printable text up to the next control byte, ending on a complete code point. An invalid byte becomes U+FFFD so a
// stray byte cannot stall the stream.
function text(bytes: Uint8Array, start: number, single: boolean): { token: Token; length: number } | undefined {
  let index = start
  while (index < bytes.length) {
    const byte = bytes[index]
    if (byte === undefined || byte < 0x20 || byte === 0x7f) break
    const width = sequenceLength(byte)
    if (width === 0) {
      if (index === start) return { token: { type: "text", text: "\uFFFD" }, length: index + 1 - start }
      break
    }
    if (index + width > bytes.length) break
    if (!continuation(bytes, index + 1, index + width)) {
      if (index === start) return { token: { type: "text", text: "\uFFFD" }, length: 1 }
      break
    }
    index += width
    if (single) break
  }
  if (index === start) return
  return { token: { type: "text", text: decoder.decode(bytes.subarray(start, index)) }, length: index - start }
}

function sequenceLength(byte: number) {
  if (byte < 0x80) return 1
  if (byte >= 0xc2 && byte <= 0xdf) return 2
  if (byte >= 0xe0 && byte <= 0xef) return 3
  if (byte >= 0xf0 && byte <= 0xf4) return 4
  return 0
}

function continuation(bytes: Uint8Array, from: number, to: number) {
  return bytes.subarray(from, to).every((byte) => (byte & 0xc0) === 0x80)
}

function escape(bytes: Uint8Array): { token: Token; length: number } | undefined {
  const second = bytes[1]
  if (second === undefined) return
  if (second === 0x5b) return csi(bytes)
  if (second === 0x4f) {
    const final = bytes[2]
    if (final === undefined) return
    return { token: ss3(final), length: 3 }
  }
  // OSC, DCS, APC and PM strings end with BEL or ST. The startup owner sends no queries, so any reply is ignored.
  if (second === 0x5d || second === 0x50 || second === 0x5f || second === 0x5e) {
    for (let index = 2; index < bytes.length; index++) {
      if (bytes[index] === 0x07) return { token: { type: "ignore" }, length: index + 1 }
      if (bytes[index] === ESC && index + 1 < bytes.length && bytes[index + 1] === 0x5c)
        return { token: { type: "ignore" }, length: index + 2 }
    }
    return
  }
  if (second === ESC) return { token: { type: "key", key: key("escape", { alt: true }) }, length: 2 }
  if (second < 0x20 || second === 0x7f) {
    const base = control(second)
    return { token: { type: "key", key: { ...base, alt: true } }, length: 2 }
  }
  const rest = text(bytes, 1, true)
  if (!rest || rest.token.type !== "text") return
  return { token: { type: "key", key: printable(rest.token.text, { alt: true }) }, length: 1 + rest.length }
}

function printable(char: string, modifiers: Partial<Omit<Key, "name">>): Key {
  const lower = char.toLowerCase()
  const shift = modifiers.shift ?? (char !== lower && char.length === 1)
  return key(char === " " ? "space" : lower, { ...modifiers, shift })
}

function csi(bytes: Uint8Array): { token: Token; length: number } | undefined {
  if (startsWith(bytes, PASTE_START)) {
    const end = indexOf(bytes, PASTE_END, PASTE_START.length)
    if (end < 0) return
    return {
      token: { type: "paste", text: decoder.decode(bytes.subarray(PASTE_START.length, end)) },
      length: end + PASTE_END.length,
    }
  }
  let index = 2
  let final = bytes[index]
  while (final !== undefined && final >= 0x20 && final <= 0x3f) final = bytes[++index]
  if (final === undefined) return
  // A malformed sequence ends at the first byte that cannot continue it; it is dropped, not replayed as text.
  if (final < 0x40 || final > 0x7e) return { token: { type: "ignore" }, length: index }
  const params = String.fromCharCode(...bytes.subarray(2, index))
  return { token: sequence(params, String.fromCharCode(final)), length: index + 1 }
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
  if (bytes.length < prefix.length) return prefix.every((byte, index) => index >= bytes.length || bytes[index] === byte)
  return prefix.every((byte, index) => bytes[index] === byte)
}

function indexOf(bytes: Uint8Array, needle: number[], from: number) {
  for (let index = from; index + needle.length <= bytes.length; index++)
    if (needle.every((byte, offset) => bytes[index + offset] === byte)) return index
  return -1
}

function ss3(final: number): Token {
  const name = FINAL_KEYS[String.fromCharCode(final)]
  return name ? { type: "key", key: key(name) } : { type: "ignore" }
}

const FINAL_KEYS: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
}

const TILDE_KEYS: Record<string, string> = {
  "1": "home",
  "2": "insert",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "7": "home",
  "8": "end",
}

const KITTY_KEYS: Record<number, string> = {
  9: "tab",
  13: "return",
  27: "escape",
  127: "backspace",
  57399: "0",
  57414: "return",
}

function modifiers(value: string | undefined) {
  const bits = Math.max(0, (Number.parseInt(value ?? "1", 10) || 1) - 1)
  return { shift: (bits & 1) !== 0, alt: (bits & 2) !== 0, ctrl: (bits & 4) !== 0, super: (bits & 8) !== 0 }
}

function sequence(params: string, final: string): Token {
  // A private marker (<, =, >, ?) means a mouse report or terminal reply, never a key.
  if (/^[<=>?]/.test(params)) return { type: "ignore" }
  const fields = params.split(";")
  if (final === "u") {
    const code = (fields[0] ?? "").split(":")[0]
    const [mods, event] = (fields[1] ?? "").split(":")
    if (event === "3") return { type: "ignore" }
    const number = codePoint(code)
    if (number === undefined) return { type: "ignore" }
    const modifier = modifiers(mods)
    const named = KITTY_KEYS[number]
    if (named) return { type: "key", key: key(named, modifier) }
    if (number >= 0xe000 && number <= 0xf8ff) return { type: "ignore" }
    return { type: "key", key: printable(String.fromCodePoint(number), modifier) }
  }
  if (final === "~") {
    // modifyOtherKeys: CSI 27 ; modifiers ; code ~
    if (fields[0] === "27" && fields.length >= 3) {
      const number = codePoint(fields[2])
      if (number === undefined) return { type: "ignore" }
      const modifier = modifiers(fields[1])
      const named = KITTY_KEYS[number]
      if (named) return { type: "key", key: key(named, modifier) }
      return { type: "key", key: printable(String.fromCodePoint(number), modifier) }
    }
    const name = TILDE_KEYS[fields[0] ?? ""]
    if (!name) return { type: "ignore" }
    return { type: "key", key: key(name, modifiers(fields[1])) }
  }
  const name = FINAL_KEYS[final]
  if (!name) return { type: "ignore" }
  return { type: "key", key: key(name, modifiers(fields[1])) }
}

// A reported key code, when it is a Unicode scalar value. Anything else is a malformed report.
function codePoint(field: string | undefined) {
  const number = Number.parseInt(field ?? "", 10)
  if (!Number.isInteger(number) || number < 0 || number > 0x10ffff) return
  if (number >= 0xd800 && number <= 0xdfff) return
  return number
}
