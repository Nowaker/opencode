import { beforeEach, expect, test } from "bun:test"
import { appendToSessionPrompt, takeDraft } from "../src/component/prompt/draft-stash"
import { mountComposer } from "./fixture/composer"
import { selectBeforeLayout, shiftedKeys } from "./fixture/composer-selection"

beforeEach(() => takeDraft(undefined))

test("native adoption leaves a preexisting stdin pause with its original owner", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  setup.renderer.stdin.pause()
  try {
    const input = await selectBeforeLayout(setup)
    setup.renderer.stdin.push(Buffer.from("kept"))
    await setup.renderOnce()
    expect({
      paused: setup.renderer.stdin.isPaused(),
      bytes: setup.renderer.stdin.readableLength,
      text: input.plainText,
    }).toEqual({ paused: true, bytes: 4, text: "" })
    const typed = Promise.withResolvers<void>()
    const stop = setup.composer.subscribe((value) => {
      if (value.status === "ready" && value.draft.text === "kept") typed.resolve()
    })
    setup.renderer.stdin.resume()
    await typed.promise
    stop()
    expect(input.plainText).toBe("kept")
  } finally {
    setup.renderer.stdin.resume()
  }
})

test("the existing mounted map accepts an async append before native input adoption", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  const input = await selectBeforeLayout(setup)
  appendToSessionPrompt(
    "ses_observation_a",
    { text: "native append", files: [], agents: [], skills: [], pasted: [] },
    setup.renderer.widthMethod,
  )
  const typed = Promise.withResolvers<void>()
  const stop = setup.composer.subscribe((value) => {
    if (value.status === "ready" && value.draft.text === "native append tail") typed.resolve()
  })
  setup.renderer.stdin.push(Buffer.from(" tail"))
  await setup.renderOnce()
  await typed.promise
  stop()
  expect({ text: input.plainText, caret: input.cursorOffset }).toEqual({ text: "native append tail", caret: 18 })
})

test("unmount before adoption never transfers pending input into another composer", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_b" })
  await setup.waitFor(() => {
    const value = setup.composer.current()
    return value.status === "ready" && value.sessionID === "ses_observation_b"
  })
  await setup.mockInput.typeText("owner-b")
  setup.context.ui.router.navigate({ type: "home" })
  await setup.waitFor(() => {
    const value = setup.composer.current()
    return value.status === "ready" && value.sessionID === null
  })
  await selectBeforeLayout(setup)
  setup.renderer.stdin.push(Buffer.from("owner-a\x1b[1;2D\x1b[1;2D"))
  setup.context.ui.router.navigate({ type: "home" })
  await setup.renderOnce()
  await setup.renderer.idle()
  expect(setup.renderer.stdin.readableLength).toBe(0)
  expect(setup.composer.current()).toMatchObject({ sessionID: null, draft: { text: "" } })
  setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_b" })
  await setup.renderOnce()
  expect(setup.composer.current()).toMatchObject({ sessionID: "ses_observation_b", draft: { text: "owner-b" } })
  setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_a" })
  await setup.renderOnce()
  expect(setup.composer.current()).toMatchObject({
    sessionID: "ses_observation_a",
    draft: {
      text: "owner-a",
      caret: 5,
      selection: { anchor: 7, focus: 5 },
    },
  })
})

test.each([
  { phase: "before", interrupt: "route" },
  { phase: "after", interrupt: "route" },
  { phase: "before", interrupt: "form" },
  { phase: "after", interrupt: "form" },
] as const)(
  "interrupted native paste restores once on its owner ($phase application, $interrupt)",
  async (scenario) => {
    await using setup = await mountComposer()
    await setup.waitFor(() => setup.composer.current().status === "ready")
    setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_b" })
    await setup.waitFor(() => {
      const value = setup.composer.current()
      return value.status === "ready" && value.sessionID === "ses_observation_b"
    })
    await setup.mockInput.typeText("owner-b")
    setup.context.ui.router.navigate({ type: "home" })
    await setup.waitFor(() => setup.composer.current().status === "ready")
    const input = await selectBeforeLayout(setup)
    const interrupted = Promise.withResolvers<void>()
    let changed = false
    let form: ReturnType<typeof setup.context.ui.dialog.prompt> | undefined
    const interrupt = () => {
      if (changed) return
      changed = true
      if (scenario.interrupt === "route") setup.context.ui.router.navigate({ type: "home" })
      if (scenario.interrupt === "form")
        form = setup.context.ui.dialog.prompt({ title: "Paste ownership", value: "form: " })
      interrupted.resolve()
    }
    const keys = setup.renderer.keyInput
    const processPaste = keys.processPaste
    keys.processPaste = (bytes, metadata) => {
      const result = processPaste.call(keys, bytes, metadata)
      if (scenario.phase === "before" && input.width > 0 && input.height > 0) interrupt()
      return result
    }
    using listener = {
      [Symbol.dispose]: () => {
        keys.processPaste = processPaste
      },
    }
    using subscription = {
      [Symbol.dispose]: setup.composer.subscribe((value) => {
        if (
          scenario.phase === "after" &&
          value.status === "ready" &&
          value.sessionID === "ses_observation_a" &&
          value.draft.pasted.length === 1
        )
          interrupt()
      }),
    }
    setup.renderer.stdin.push(
      Buffer.from("\x1b[200~fixture line one\nfixture line two\nfixture line three\x1b[201~ tail\x1b[1;2D\x1b[1;2D"),
    )
    await setup.renderOnce()
    await interrupted.promise
    await setup.renderOnce()
    using decoded = shiftedKeys(setup)
    if (scenario.interrupt === "route") {
      expect(setup.composer.current()).toMatchObject({ sessionID: null, draft: { text: "", pasted: [] } })
      setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_b" })
      await setup.renderOnce()
      expect(setup.composer.current()).toMatchObject({
        sessionID: "ses_observation_b",
        draft: { text: "owner-b", caret: 7, selection: { anchor: 7, focus: 7 }, pasted: [] },
      })
      setup.context.ui.router.navigate({ type: "session", sessionID: "ses_observation_a" })
      await setup.renderOnce()
    }
    if (scenario.interrupt === "form") {
      await setup.mockInput.typeText("answer")
      setup.mockInput.pressEnter()
      expect(await form).toBe("form: answer")
    }
    await decoded.done
    listener[Symbol.dispose]()
    subscription[Symbol.dispose]()
    expect(setup.composer.current()).toMatchObject({
      sessionID: "ses_observation_a",
      draft: {
        text: "[Pasted ~3 lines]  tail",
        caret: 21,
        selection: { anchor: 23, focus: 21 },
        pasted: [
          {
            text: "fixture line one\nfixture line two\nfixture line three",
            source: { start: 0, end: 17, text: "[Pasted ~3 lines]" },
          },
        ],
      },
    })
  },
)
