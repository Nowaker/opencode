export * as InstantKeys from "./keys"

// A small terminal input parser for the instant startup prompt. It understands
// what a terminal sends to a raw-mode reader once the prompt has enabled SGR
// mouse reports, bracketed paste and the kitty "disambiguate" flag: legacy
// control bytes, CSI/SS3 cursor keys, kitty CSI u, xterm modifyOtherKeys,
// SGR mouse and pasted text. Anything else is skipped.

export type Key = {
  name: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  super: boolean
}

export type Event =
  | { type: "key"; key: Key }
  | { type: "text"; text: string }
  | { type: "paste"; text: string }
  | { type: "mouse"; button: number; x: number; y: number; action: "press" | "release" | "drag" | "move" | "wheel" }

const PASTE_START = "\x1b[200~"
const PASTE_END = "\x1b[201~"

const CSI_NAMES: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" }
const TILDE_NAMES: Record<string, string> = {
  "1": "home",
  "2": "insert",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "7": "home",
  "8": "end",
}
const CODEPOINT_NAMES: Record<number, string> = {
  8: "backspace",
  9: "tab",
  13: "return",
  27: "escape",
  32: "space",
  127: "backspace",
  57414: "return",
}

export function key(name: string, mods: Partial<Omit<Key, "name">> = {}): Key {
  return { name, ctrl: false, alt: false, shift: false, super: false, ...mods }
}

function modifiers(value: number | undefined) {
  const bits = Math.max(0, (value ?? 1) - 1)
  return { shift: (bits & 1) !== 0, alt: (bits & 2) !== 0, ctrl: (bits & 4) !== 0, super: (bits & 8) !== 0 }
}

function codepointKey(code: number, mods: ReturnType<typeof modifiers>): Event {
  const named = CODEPOINT_NAMES[code]
  if (named) return { type: "key", key: key(named, mods) }
  const char = String.fromCodePoint(code)
  if (!mods.ctrl && !mods.alt && !mods.super) return { type: "text", text: mods.shift ? char.toUpperCase() : char }
  return { type: "key", key: key(char.toLowerCase(), mods) }
}

function controlKey(code: number, alt: boolean): Event | undefined {
  if (code === 13) return { type: "key", key: key("return", { alt }) }
  if (code === 10) return { type: "key", key: key("j", { ctrl: true, alt }) }
  if (code === 9) return { type: "key", key: key("tab", { alt }) }
  if (code === 127 || code === 8) return { type: "key", key: key("backspace", { alt }) }
  if (code === 0) return { type: "key", key: key("space", { ctrl: true, alt }) }
  if (code >= 1 && code <= 26) return { type: "key", key: key(String.fromCharCode(code + 96), { ctrl: true, alt }) }
  if (code >= 28 && code <= 31) return { type: "key", key: key("\\]^-"[code - 28], { ctrl: true, alt }) }
}

function csi(params: string, final: string, alt: boolean): Event | undefined {
  if (params.startsWith("<") && (final === "M" || final === "m")) {
    const [raw, x, y] = params.slice(1).split(";").map(Number)
    const motion = (raw & 32) !== 0
    const wheel = (raw & 64) !== 0
    const button = raw & 3
    const action = wheel ? "wheel" : final === "m" ? "release" : motion ? (button === 3 ? "move" : "drag") : "press"
    return { type: "mouse", button: wheel ? raw & 67 : button, x: x - 1, y: y - 1, action }
  }
  if (!/^[\d;:]*$/.test(params)) return
  const fields = params.split(";")
  if (final === "u") {
    const code = Number(fields[0]?.split(":")[0])
    const [mod, kind] = (fields[1] ?? "1").split(":").map(Number)
    if (kind === 3 || Number.isNaN(code)) return
    const event = codepointKey(code, modifiers(mod))
    if (alt && event.type === "key") event.key.alt = true
    return event
  }
  if (final === "~") {
    if (fields[0] === "27") return codepointKey(Number(fields[2]), modifiers(Number(fields[1])))
    const name = TILDE_NAMES[fields[0]]
    if (!name) return
    return { type: "key", key: key(name, { ...modifiers(Number(fields[1] || 1)), ...(alt ? { alt } : {}) }) }
  }
  if (final === "Z") return { type: "key", key: key("tab", { shift: true }) }
  const name = CSI_NAMES[final]
  if (!name) return
  const mods = modifiers(fields.length > 1 ? Number(fields[1]) : 1)
  return { type: "key", key: key(name, { ...mods, alt: mods.alt || alt }) }
}

export function createParser() {
  const decoder = new TextDecoder()
  let buffer = ""
  let paste: string | undefined

  // How many characters from `start` make up one complete escape sequence, or
  // 0 while it is still incomplete.
  function sequenceLength(input: string, start: number): number {
    const next = input[start + 1]
    if (next === undefined) return 0
    if (next === "[") {
      for (let i = start + 2; i < input.length; i++) {
        const code = input.charCodeAt(i)
        if (code >= 0x40 && code <= 0x7e) return i - start + 1
      }
      return 0
    }
    if (next === "O") return input.length > start + 2 ? 3 : 0
    if (next === "]" || next === "P" || next === "_" || next === "^") {
      for (let i = start + 2; i < input.length; i++) {
        if (input[i] === "\x07") return i - start + 1
        if (input[i] === "\x1b" && input[i + 1] === "\\") return i - start + 2
      }
      return 0
    }
    if (next === "\x1b") {
      const inner = sequenceLength(input, start + 1)
      return inner > 0 ? inner + 1 : inner
    }
    return 2
  }

  function parseSequence(seq: string, alt = false): Event | undefined {
    if (seq.startsWith("\x1b\x1b")) return parseSequence(seq.slice(1), true)
    if (seq[1] === "[") return csi(seq.slice(2, -1), seq[seq.length - 1], alt)
    if (seq[1] === "O") {
      const name = CSI_NAMES[seq[2]]
      return name ? { type: "key", key: key(name, { alt }) } : undefined
    }
    if (seq[1] === "]" || seq[1] === "P" || seq[1] === "_" || seq[1] === "^") return
    const char = seq.slice(1)
    const control = controlKey(char.charCodeAt(0), true)
    if (control) return control
    return { type: "key", key: key(char.toLowerCase(), { alt: true, shift: char !== char.toLowerCase() }) }
  }

  function drain(events: Event[]) {
    let text = ""
    const flushText = () => {
      if (!text) return
      events.push({ type: "text", text })
      text = ""
    }
    let i = 0
    while (i < buffer.length) {
      if (paste !== undefined) {
        const end = buffer.indexOf(PASTE_END, i)
        if (end < 0) {
          const keep = Math.max(i, buffer.length - (PASTE_END.length - 1))
          paste += buffer.slice(i, keep)
          i = keep
          break
        }
        events.push({ type: "paste", text: paste + buffer.slice(i, end) })
        paste = undefined
        i = end + PASTE_END.length
        continue
      }
      const char = buffer[i]
      if (char === "\x1b") {
        const length = sequenceLength(buffer, i)
        if (length === 0) break
        flushText()
        const seq = buffer.slice(i, i + length)
        i += length
        if (seq === PASTE_START) {
          paste = ""
          continue
        }
        const event = parseSequence(seq)
        if (event?.type === "text") text += event.text
        if (event && event.type !== "text") events.push(event)
        continue
      }
      const code = buffer.charCodeAt(i)
      if (code < 0x20 || code === 0x7f) {
        flushText()
        const event = controlKey(code, false)
        if (event) events.push(event)
        i++
        continue
      }
      text += char
      i++
    }
    flushText()
    buffer = buffer.slice(i)
  }

  return {
    feed(bytes: Uint8Array): Event[] {
      buffer += decoder.decode(bytes, { stream: true })
      const events: Event[] = []
      drain(events)
      return events
    },
    // A lone Escape stays buffered until more input arrives; flush() reports
    // it as the Escape key once the caller decides no more bytes are coming.
    flush(): Event[] {
      if (buffer !== "\x1b") return []
      buffer = ""
      return [{ type: "key", key: key("escape") }]
    },
    // Input this parser has consumed from the stream but not yet turned into
    // events, so a new reader can be handed exactly what is still unprocessed.
    pending(): string {
      return (paste !== undefined ? PASTE_START + paste : "") + buffer
    },
  }
}
