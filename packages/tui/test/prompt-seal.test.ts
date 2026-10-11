import { afterEach, describe, expect, test } from "bun:test"
import type { TuiPromptInfo, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "solid-js"
import { createComposerSeal } from "../src/context/composer-seal"
import { createPromptControl } from "../src/plugin/prompt-control"

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

async function fixture() {
  const setup = await createTestRenderer({ width: 40, height: 10, useThread: false })
  const seal = createRoot((dispose) => {
    disposers.push(() => {
      dispose()
      setup.renderer.destroy()
    })
    return createComposerSeal(setup.renderer)
  })
  let revision = 0
  let current: TuiPromptInfo = { input: "draft", parts: [], mode: "normal" }
  const typed: string[] = []
  const pasted: string[] = []
  setup.renderer.keyInput.on("keypress", (event) => typed.push(event.name))
  setup.renderer.keyInput.on("paste", (event) => pasted.push(Buffer.from(event.bytes).toString()))
  const flags = { dialog: false, ready: true, sessionID: "ses_seal" }
  const handoff = { visible: true, disabled: false, ready: true, busy: false as boolean | undefined }
  const ref: TuiPromptRef = {
    focused: true,
    get current() {
      return current
    },
    get handoff() {
      return { revision, ...handoff, submit: () => {} }
    },
    set(prompt) {
      current = prompt
      revision++
    },
    reset() {},
    blur() {},
    focus() {},
    submit() {},
  }
  const control = createPromptControl(
    () => ref,
    () => flags,
    seal,
  )
  const press = (key: string) =>
    setup.renderer.keyInput.processParsedKey({
      name: key,
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: key,
      number: false,
      raw: key,
      eventType: "press",
      source: "raw",
    })
  return { control, seal, flags, handoff, ref, typed, pasted, press, renderer: setup.renderer, revision: () => revision }
}

describe("composer seal", () => {
  test("mounted hidden and unsynced composers can retire when no accepted work is outstanding", async () => {
    const f = await fixture()
    f.flags.ready = false
    f.handoff.visible = false
    f.handoff.disabled = true
    f.handoff.ready = false
    const result = f.control.seal()
    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)
    expect(result.draft).toMatchObject({ input: "draft", ready: false, reason: "disabled" })
    expect(f.seal.commit(result.seal)).toBe(true)
    expect(result.seal.release()).toBe(false)
    result.seal[Symbol.dispose]()
    expect(f.seal.sealed()).toBe(true)
  })

  test("commit requires the original seal and release or disposal cannot reopen it", async () => {
    const f = await fixture()
    const result = f.control.seal()
    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)
    expect(f.seal.commit({ ...result.seal })).toBe(false)
    expect(result.seal.release()).toBe(true)
    expect(f.seal.commit(result.seal)).toBe(false)
    const current = f.control.seal()
    if (current.status !== "sealed") throw new Error(`refused: ${current.reason}`)
    expect(f.seal.commit(result.seal)).toBe(false)
    expect(f.seal.commit(current.seal)).toBe(true)
    expect(f.seal.commit(current.seal)).toBe(true)
    expect(current.seal.release()).toBe(false)
    current.seal[Symbol.dispose]()
    f.press("a")
    f.renderer.keyInput.processPaste(Buffer.from("blocked"))
    expect(f.typed).toEqual([])
    expect(f.pasted).toEqual([])
    expect(f.control.snapshot().reason).toBe("disabled")
    expect(f.seal.whileOpen(() => f.ref.reset())).toBe(false)
  })

  test("seals with the draft it holds and refuses every change until released", async () => {
    const f = await fixture()
    const result = f.control.seal()
    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)
    expect(result.draft).toMatchObject({ input: "draft", sessionID: "ses_seal", reason: "disabled", ready: false })
    const guard = f.control.snapshot()
    expect(guard).toMatchObject({ reason: "disabled", disabled: true, ready: false })
    expect(f.control.replace({ ...guard, correlationId: "during", text: "overwrite" }).status).toBe("not-ready")
    expect(f.control.submit({ ...guard, correlationId: "during" }).status).toBe("not-ready")
    expect(f.control.seal()).toEqual({ status: "refused", reason: "sealed" })
    expect(f.revision()).toBe(0)

    expect(result.seal.release()).toBe(true)
    expect(result.seal.release()).toBe(false)
    expect(f.control.snapshot().reason).toBe("ready")
  })

  test("blocks keys and mutations while sealed and accepts only fresh input after release", async () => {
    const f = await fixture()
    const result = f.control.seal()
    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)
    f.press("a")
    f.press("b")
    let navigated = false
    expect(f.seal.whileOpen(() => (navigated = true))).toBe(false)
    expect(f.typed).toEqual([])
    expect(navigated).toBe(false)
    result.seal[Symbol.dispose]()
    f.press("c")
    expect(f.typed).toEqual(["c"])
    expect(navigated).toBe(false)
    expect(f.seal.whileOpen(() => (navigated = true))).toBe(true)
    expect(navigated).toBe(true)
  })

  test("does not retain input beyond the former buffer limit on an abandoned retirement", async () => {
    const f = await fixture()
    const result = f.control.seal()
    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)

    for (let count = 0; count < 5000; count++) f.press("a")
    f.renderer.keyInput.processPaste(Buffer.from("blocked paste"))
    result.seal.release()
    f.press("b")
    f.renderer.keyInput.processPaste(Buffer.from("fresh paste"))

    expect(f.typed).toEqual(["b"])
    expect(f.pasted).toEqual(["fresh paste"])
    expect(f.control.read().input).toBe("draft")
    expect(f.seal.busy()).toBe(false)
  })

  test("switches the mouse off while sealed and back on with the release", async () => {
    const f = await fixture()
    f.renderer.useMouse = true
    const result = f.control.seal()
    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)
    expect(f.renderer.useMouse).toBe(false)
    result.seal.release()
    expect(f.renderer.useMouse).toBe(true)
  })

  test("refuses to seal until accepted async composer work has finished", async () => {
    const f = await fixture()
    const pending = Promise.withResolvers<void>()
    const work = f.seal.track(async () => {
      await pending.promise
      f.ref.set({ input: "accepted before seal", parts: [] })
    })

    expect(f.control.seal()).toEqual({ status: "refused", reason: "busy" })
    pending.resolve()
    await work
    const result = f.control.seal()

    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)
    expect(result.draft.input).toBe("accepted before seal")
    result.seal.release()
  })

  test("captured draft mutations cannot alter the sealed composer's parts", async () => {
    const f = await fixture()
    const part = { type: "agent", name: "build", source: { value: "@build", start: 0, end: 6 } } as const
    f.ref.set({ input: "@build", parts: [part] })
    const result = f.control.seal()
    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)

    result.draft.parts.length = 0
    expect(f.control.read().parts).toEqual([part])
    result.seal.release()
  })

  test("a seal kept through retirement has no accepted post-seal input to replay", async () => {
    const f = await fixture()
    const result = f.control.seal()
    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)

    f.press("a")
    f.renderer.keyInput.processPaste(Buffer.from("blocked paste"))
    f.renderer.destroy()

    expect(result.draft.input).toBe("draft")
    expect(f.typed).toEqual([])
    expect(f.pasted).toEqual([])
    expect(f.seal.sealed()).toBe(true)
  })

  test.each(["busy", "dialog", "unsupported"] as const)("refuses while %s and changes nothing", async (reason) => {
    const f = await fixture()
    if (reason === "busy") f.handoff.busy = true
    if (reason === "dialog") f.flags.dialog = true
    if (reason === "unsupported") f.handoff.busy = undefined
    expect(f.control.seal()).toEqual({ status: "refused", reason })
    expect(f.seal.sealed()).toBe(false)
    f.press("a")
    expect(f.typed).toEqual(["a"])
  })

  test("a released generation cannot end a later seal", async () => {
    const f = await fixture()
    const first = f.control.seal()
    if (first.status !== "sealed") throw new Error(`refused: ${first.reason}`)
    first.seal.release()
    const second = f.control.seal()
    if (second.status !== "sealed") throw new Error(`refused: ${second.reason}`)
    expect(second.seal.generation).toBe(first.seal.generation + 1)
    expect(first.seal.release()).toBe(false)
    expect(f.seal.sealed()).toBe(true)
    second.seal.release()
  })
})
