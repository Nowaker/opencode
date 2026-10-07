import { describe, expect, test } from "bun:test"
import type { TuiComposerCaret, TuiPromptInfo, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { createPromptControl } from "../src/plugin/prompt-control"

function fixture() {
  let revision = 0
  let current: TuiPromptInfo = { input: "", parts: [], mode: "normal" }
  let submits = 0
  const flags = { dialog: false, ready: true, sessionID: null }
  const handoff = { visible: true, disabled: false, ready: true }
  const ref: TuiPromptRef = {
    focused: true,
    get current() { return current },
    get handoff() { return { revision, ...handoff, submit: () => { submits++ } } },
    set(prompt) { current = prompt; revision++ },
    reset() {}, blur() {}, focus() {},
    submit() { submits++ },
  }
  let active: TuiPromptRef | undefined = ref
  const control = createPromptControl(() => active, () => flags)
  return { control, ref, flags, handoff, bind: (next?: TuiPromptRef) => { active = next }, edit: (text: string) => ref.set({ input: text, parts: [] }), settle: () => { revision++ }, submits: () => submits }
}

describe("prompt compare and set", () => {
  test("accepts complete Unicode and multiline input", () => {
    const f = fixture()
    const before = f.control.snapshot()
    const text = "α🙂\n\t漢字 ".repeat(10000)
    const result = f.control.replace({ ...before, correlationId: "one", text })
    expect(result.status).toBe("accepted")
    expect(result.snapshot.inputBytes).toBe(Buffer.byteLength(text))
    expect(result.snapshot.sha256).toBe(new Bun.CryptoHasher("sha256").update(text).digest("hex"))
  })

  test("accepts a guard the composer still satisfies after an edit was undone", () => {
    const f = fixture()
    const before = f.control.snapshot()
    f.edit("user edit")
    f.edit("")
    expect(f.control.replace({ ...before, correlationId: "one", text: "incoming" }).status).toBe("accepted")
  })

  test("refuses a swapped attachment that leaves the text and the count equal", () => {
    const f = fixture()
    f.ref.set({ input: "", parts: [{ type: "agent", name: "build" }] })
    const before = f.control.snapshot()
    f.ref.set({ input: "", parts: [{ type: "agent", name: "plan" }] })
    const result = f.control.replace({ ...before, correlationId: "one", text: "incoming" })
    expect(result.status).toBe("conflict")
    expect(result.snapshot.parts).toBe(before.parts)
  })

  test("retries an accepted operation without overwriting later user edits", () => {
    const f = fixture()
    const request = { ...f.control.snapshot(), correlationId: "one", text: "incoming" }
    const receipt = f.control.replace(request)
    expect(f.control.replace(request)).toEqual(receipt)
    f.edit("real user edit")
    expect(f.control.replace(request).status).toBe("conflict")
  })

  test("retries after the write's own settle advances the revision", () => {
    const f = fixture()
    const request = { ...f.control.snapshot(), correlationId: "one", text: "incoming" }
    const receipt = f.control.replace(request)
    f.settle()
    expect(f.control.replace(request)).toEqual(receipt)
  })

  test("submits a receipt once across duplicate requests", () => {
    const f = fixture()
    const accepted = f.control.replace({ ...f.control.snapshot(), correlationId: "one", text: "incoming" })
    const request = { ...accepted.snapshot, correlationId: "submit-one" }
    expect(f.control.submit(request).status).toBe("submitted")
    expect(f.control.submit(request).status).toBe("submitted")
    expect(f.submits()).toBe(1)
  })

  test("rejects attachment changes even when text is equal", () => {
    const f = fixture()
    const before = f.control.snapshot()
    f.ref.set({ input: "", parts: [{ type: "agent", name: "build" }] })
    expect(f.control.replace({ ...before, correlationId: "one", text: "incoming" }).status).toBe("conflict")
    expect(f.control.snapshot().parts).toBe(1)
  })

  test("rejects the old generation after the active composer is replaced", () => {
    const f = fixture()
    const before = f.control.snapshot()
    f.bind({ ...f.ref })
    expect(f.control.replace({ ...before, correlationId: "one", text: "incoming" }).status).toBe("conflict")
  })

  test("reports an unsupported custom ref without replacing it", () => {
    const f = fixture()
    f.bind({ ...f.ref, handoff: undefined })
    const before = f.control.snapshot()
    expect(before.reason).toBe("unsupported")
    expect(f.control.replace({ ...before, correlationId: "one", text: "incoming" }).status).toBe("not-ready")
  })

  test.each(["dialog", "disabled", "hidden", "shell", "syncing"] as const)("refuses mutation while %s", (reason) => {
    const f = fixture()
    if (reason === "dialog") f.flags.dialog = true
    if (reason === "disabled") f.handoff.disabled = true
    if (reason === "hidden") f.handoff.visible = false
    if (reason === "shell") f.ref.set({ input: "", parts: [], mode: "shell" })
    if (reason === "syncing") f.flags.ready = false
    const before = f.control.snapshot()
    expect(before.reason).toBe(reason)
    expect(f.control.replace({ ...before, correlationId: "one", text: "incoming" }).status).toBe("not-ready")
  })

  test("leaves a shell composer in shell mode rather than converting it", () => {
    const f = fixture()
    f.ref.set({ input: "rm -rf build", parts: [], mode: "shell" })
    const before = f.control.snapshot()
    expect(f.control.replace({ ...before, correlationId: "one", text: "incoming" }).status).toBe("not-ready")
    expect(f.ref.current).toEqual({ input: "rm -rf build", parts: [], mode: "shell" })
  })

  test("reports unmounted and refuses mutation", () => {
    const f = fixture()
    f.bind()
    const before = f.control.snapshot()
    expect(before.reason).toBe("unmounted")
    expect(f.control.replace({ ...before, correlationId: "one", text: "incoming" }).status).toBe("not-ready")
  })

  test("does not accept a setter that truncates text", () => {
    const f = fixture()
    f.bind({ ...f.ref, set: () => f.edit("tail") })
    const before = f.control.snapshot()
    expect(f.control.replace({ ...before, correlationId: "one", text: "required-prefix tail" }).status).toBe("mismatch")
  })

  test("reads the text and parts it guards, with the revision that moved", () => {
const f = fixture()
const paste = { type: "text" as const, text: "line one\nline two", source: { text: { start: 4, end: 21, value: "[Pasted ~2 lines]" } } }
f.ref.set({ input: "see [Pasted ~2 lines]\nand", parts: [paste] })
expect(f.control.read()).toEqual({
generation: f.control.snapshot().generation, revision: 1, ready: true, reason: "ready", sessionID: null,
mode: "normal", input: "see [Pasted ~2 lines]\nand", parts: [paste], caret: null,
})
f.edit("")
expect(f.control.read().revision).toBe(2)
f.bind()
expect(f.control.read()).toMatchObject({ reason: "unmounted", input: "", parts: [] })
})

test("restores parts with the text and accepts only their exact readback", () => {
const f = fixture()
const paste = { type: "text" as const, text: "body", source: { text: { start: 0, end: 10, value: "[Pasted 1]" } } }
const result = f.control.replace({ ...f.control.snapshot(), correlationId: "one", text: "[Pasted 1] tail", promptParts: [paste] })
expect(result.status).toBe("accepted")
expect(f.ref.current).toEqual({ input: "[Pasted 1] tail", parts: [paste] })
expect(result.snapshot.partsSha256).toBe(new Bun.CryptoHasher("sha256").update(JSON.stringify([paste])).digest("hex"))
const lossy = fixture()
lossy.bind({
...lossy.ref,
get current() { return lossy.ref.current },
set: (prompt) => lossy.ref.set({ ...prompt, parts: [] }),
})
const refused = lossy.control.replace({ ...lossy.control.snapshot(), correlationId: "one", text: "[Pasted 1]", promptParts: [paste] })
expect(refused.status).toBe("mismatch")
expect(lossy.ref.current.input).toBe("[Pasted 1]")
})

  test("rejects correlation reuse with different contents", () => {
    const f = fixture()
    f.control.replace({ ...f.control.snapshot(), correlationId: "one", text: "first" })
    expect(f.control.replace({ ...f.control.snapshot(), correlationId: "one", text: "second" }).status).toBe("conflict")
  })

  test("reads the caret without counting a caret move as a revision", () => {
    const f = caretFixture()
    f.ref.set({ input: "first\nsecond", parts: [] })
    const revision = f.control.read().revision
    f.move({ offset: 3, selection: { start: 3, end: 8 } })
    expect(f.control.read()).toMatchObject({ revision, caret: { offset: 3, selection: { start: 3, end: 8 } } })
  })

  test("places a requested caret after the text is written, and leaves the default end alone", () => {
    const f = caretFixture()
    expect(f.control.replace({ ...f.control.snapshot(), correlationId: "one", text: "above\nbelow", caret: { offset: 6 } }).status).toBe("accepted")
    expect(f.placed()).toEqual([{ text: "above\nbelow", caret: { offset: 6 } }])
    expect(f.control.replace({ ...f.control.snapshot(), correlationId: "two", text: "plain" }).status).toBe("accepted")
    expect(f.placed()).toHaveLength(1)
  })

  test("refuses a reused correlation that asks for a different caret", () => {
    const f = caretFixture()
    const request = { ...f.control.snapshot(), correlationId: "one", text: "above\nbelow", caret: { offset: 6 } }
    const receipt = f.control.replace(request)
    expect(f.control.replace(request)).toEqual(receipt)
    expect(f.control.replace({ ...request, caret: { offset: 2 } }).status).toBe("conflict")
    expect(f.placed()).toHaveLength(1)
  })
})

function caretFixture() {
  const f = fixture()
  let caret: TuiComposerCaret = { offset: 0 }
  const placed: { text: string; caret: TuiComposerCaret }[] = []
  const handoff = () => f.ref.handoff!
  f.bind({
    ...f.ref,
    get current() { return f.ref.current },
    set: (prompt) => f.ref.set(prompt),
    get handoff() {
      return {
        ...handoff(),
        caret: () => caret,
        place: (next: TuiComposerCaret) => { placed.push({ text: f.ref.current.input, caret: next }); caret = next },
      }
    },
  })
  return { ...f, move: (next: TuiComposerCaret) => { caret = next }, placed: () => placed }
}
