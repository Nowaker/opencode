import { expect, setDefaultTimeout, test } from "bun:test"
import type { TuiComposerTypingEvent, TuiComposerTypingSubmit, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { wait, withPrompt } from "../fixture/prompt-app"
import { json } from "../fixture/tui-sdk"

setDefaultTimeout(30_000)

function observe(api: TuiPluginApi, beforeSubmit: (event: TuiComposerTypingSubmit) => Promise<void> = async () => {}) {
  const events: TuiComposerTypingEvent[] = []
  if (!api.prompt.observeTyping) throw new Error("Native typing observer unavailable")
  const unsubscribe = api.prompt.observeTyping({ event: (event) => events.push(event), beforeSubmit })
  return { events, unsubscribe, edits: () => events.filter((event) => event.kind === "edit") }
}

test("native edits count code points and equal-length replacements without counting plugin writes", async () => {
  await withPrompt(async (rig) => {
    const seen = observe(rig.api)
    await rig.press("🙂")
    await rig.press("界")
    const draftID = rig.api.prompt.read().draftID
    expect(draftID).toMatch(/^[0-9a-f-]{36}$/)
    expect(seen.edits().map(({ insertedChars, deletedChars }) => [insertedChars, deletedChars])).toEqual([[1, 0], [1, 0]])

    const replace = rig.api.prompt.replace({
      ...rig.api.prompt.snapshot(), correlationId: "select", text: "abc", draftID,
      caret: { offset: 2, selection: { start: 1, end: 2 } },
    })
    expect(replace.status).toBe("accepted")
    expect(seen.edits()).toHaveLength(2)
    await rig.press("b")
    expect(rig.text()).toBe("abc")
    expect(seen.edits().at(-1)).toMatchObject({ draftID, insertedChars: 1, deletedChars: 1, isPaste: false, pasteChars: 0 })
    await rig.press("\x7f")
    expect(seen.edits().at(-1)).toMatchObject({ insertedChars: 0, deletedChars: 1 })
    seen.unsubscribe()
    await rig.press("x")
    expect(seen.edits()).toHaveLength(4)
  })
})

test("empty mounts and clears do not create drafts until a real edit", async () => {
  await withPrompt(async (rig) => {
    const seen = observe(rig.api)
    expect(seen.events).toEqual([])
    rig.api.route.navigate("home")
    await wait(() => rig.api.route.current.name === "home" && rig.api.prompt.snapshot().ready)
    expect(seen.events).toEqual([])
    await rig.press("x")
    expect(seen.events.filter((event) => event.kind === "started")).toMatchObject([{ sessionID: null }])
    rig.api.keymap.dispatchCommand("prompt.clear")
    await wait(() => rig.text() === "")
    expect(seen.events.filter((event) => event.kind === "started")).toHaveLength(1)
    expect(seen.events.filter((event) => event.kind === "cleared")).toHaveLength(1)
    seen.unsubscribe()
  })
})

test("folded paste counts its accepted payload and deletion expands the placeholder", async () => {
  await withPrompt(async (rig) => {
    const seen = observe(rig.api)
    await rig.press("\x1b[200~🙂\n界\nx\x1b[201~")
    expect(rig.text()).toBe("[Pasted ~3 lines] ")
    expect(seen.edits()).toMatchObject([{ insertedChars: 5, deletedChars: 0, isPaste: true, pasteChars: 5 }])
    await rig.press("\x7f")
    await rig.press("\x17")
    expect(rig.text()).toBe("")
    expect(seen.edits().at(-1)).toMatchObject({ insertedChars: 0, deletedChars: 5, isPaste: false, pasteChars: 0 })
    expect(Object.keys(seen.edits()[0]).sort()).toEqual(["deletedChars", "draftID", "insertedChars", "isPaste", "kind", "pasteChars", "sessionID", "timeMs"])
    seen.unsubscribe()
  })
})

test("modal and terminal focus boundaries stop and resume native composer focus", async () => {
  await withPrompt(async (rig) => {
    const seen = observe(rig.api)
    await rig.press("a")
    await rig.press("\x1b[O")
    await rig.press("\x1b[I")
    rig.api.ui.dialog.replace(() => rig.api.ui.DialogAlert({ title: "Typing boundary", message: "Modal owns input" }))
    await rig.press("x")
    expect(rig.text()).toBe("a")
    rig.api.ui.dialog.clear()
    await rig.press("y")
    expect(seen.events.filter((event) => event.kind === "focus_gained" || event.kind === "focus_lost").map((event) => event.kind))
      .toEqual(["focus_gained", "focus_lost", "focus_gained", "focus_lost", "focus_gained"])
    expect(seen.edits()).toMatchObject([{ insertedChars: 1 }, { insertedChars: 1 }])
    seen.unsubscribe()
  })
})

test("a hidden native prompt loses focus without ending its draft", async () => {
  const [visible, setVisible] = createSignal(true)
  await withPrompt(async (rig) => {
    const seen = observe(rig.api)
    await rig.press("x")
    const draftID = rig.api.prompt.read().draftID
    setVisible(false)
    await wait(() => rig.api.prompt.snapshot().reason === "hidden")
    await rig.press("y")
    expect(rig.text()).toBe("x")
    setVisible(true)
    await rig.press("z")
    expect(rig.api.prompt.read().draftID).toBe(draftID)
    expect(rig.text()).toBe("xz")
    expect(seen.events.filter((event) => event.kind === "focus_gained" || event.kind === "focus_lost").map((event) => event.kind))
      .toEqual(["focus_gained", "focus_lost", "focus_gained"])
    seen.unsubscribe()
  }, { plugins: [{ id: "typing-visibility", async tui(api) {
    api.slots.register({ slots: { session_prompt(_context, props) {
      return <api.ui.Prompt sessionID={props.session_id} ref={props.ref} visible={visible()} disabled={props.disabled} />
    } } })
  } }] })
})

test("stash, route remount and explicit recovery preserve draft identity while copied text gets a fresh one", async () => {
  await withPrompt(async (rig) => {
    const seen = observe(rig.api)
    await rig.press("x")
    const original = rig.api.prompt.read().draftID
    rig.api.keymap.dispatchCommand("prompt.stash")
    await wait(() => rig.text() === "")
    expect(rig.api.prompt.read().draftID).not.toBe(original)
    rig.api.keymap.dispatchCommand("prompt.stash.pop")
    await wait(() => rig.text() === "x")
    expect(rig.api.prompt.read().draftID).toBe(original)
    rig.api.route.navigate("home")
    await wait(() => rig.api.route.current.name === "home" && rig.api.prompt.snapshot().ready)
    expect(rig.api.prompt.read().draftID).toBe(original)
    expect(rig.api.prompt.replace({ ...rig.api.prompt.snapshot(), correlationId: "copy", text: "x" }).status).toBe("accepted")
    expect(rig.api.prompt.read().draftID).not.toBe(original)
    expect(rig.api.prompt.replace({ ...rig.api.prompt.snapshot(), correlationId: "recover", text: "x", draftID: original }).status).toBe("accepted")
    expect(rig.api.prompt.read().draftID).toBe(original)
    expect(seen.edits()).toHaveLength(1)
    seen.unsubscribe()
  })
})

test("preflight durably gates native admission with the same exact ID and preserves input while pending", async () => {
  const entered = Promise.withResolvers<TuiComposerTypingSubmit>()
  const durable = Promise.withResolvers<void>()
  const sent: Record<string, unknown>[] = []
  await withPrompt(async (rig) => {
    const seen = observe(rig.api, (event) => { entered.resolve(event); return durable.promise })
    await rig.press("x")
    const draftID = rig.api.prompt.read().draftID
    await rig.press("\r")
    const intent = await entered.promise
    expect(sent).toEqual([])
    expect(intent).toMatchObject({ draftID, sessionID: "ses_prompt_app" })
    expect(intent.messageID).toMatch(/^msg_/)
    await rig.press("y")
    rig.api.keymap.dispatchCommand("prompt.clear")
    expect(rig.text()).toBe("x")
    durable.resolve()
    await wait(() => sent.length === 1 && rig.text() === "")
    expect(sent[0].messageID).toBe(intent.messageID)
    expect(rig.api.prompt.read().draftID).not.toBe(draftID)
    expect(intent.timeMs).toBeGreaterThanOrEqual(seen.edits()[0].timeMs)
    expect(seen.edits()).toHaveLength(1)
    expect(seen.events.filter((event) => event.kind === "started")).toHaveLength(1)
    seen.unsubscribe()
  }, { fetch: async (url, request) => {
    if (request.method === "POST" && url.pathname.endsWith("/message")) { sent.push(await request.json()); return json({}) }
  } })
})

test("a failed recorder leaves the same draft and surfaces a fixed error without dispatch", async () => {
  await withPrompt(async (rig) => {
    const seen = observe(rig.api, async () => { throw new Error("private recorder details") })
    await rig.press("x")
    const draftID = rig.api.prompt.read().draftID
    await rig.press("\r")
    await wait(() => rig.frame().includes("Could not record draft submission"))
    expect(rig.text()).toBe("x")
    expect(rig.api.prompt.read().draftID).toBe(draftID)
    expect(rig.frame()).not.toContain("private recorder details")
    expect(rig.paths.filter((path) => path.endsWith("/message"))).toEqual(["/session/ses_prompt_app/message"])
    seen.unsubscribe()
  })
})

test("a home draft keeps its identity when submission creates a session", async () => {
  const intents: TuiComposerTypingSubmit[] = []
  const sent: Record<string, unknown>[] = []
  await withPrompt(async (rig) => {
    const seen = observe(rig.api, async (event) => { intents.push(event) })
    await rig.press("x")
    const draftID = rig.api.prompt.read().draftID
    expect(seen.edits()[0].sessionID).toBeNull()
    await rig.press("\r")
    await wait(() => sent.length === 1)
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({ draftID, sessionID: "ses_prompt_app" })
    expect(sent[0].messageID).toBe(intents[0].messageID)
    seen.unsubscribe()
  }, { home: true, fetch: async (url, request) => {
    if (request.method !== "POST") return
    if (url.pathname === "/session") return json({ id: "ses_prompt_app" })
    if (url.pathname.endsWith("/message")) { sent.push(await request.json()); return json({}) }
  } })
})

test("a prefilled draft starts on submit before the observer's durable intent", async () => {
  await withPrompt(async (rig) => {
    expect(rig.api.prompt.replace({ ...rig.api.prompt.snapshot(), correlationId: "prefill", text: "prefilled" }).status).toBe("accepted")
    const intents: TuiComposerTypingSubmit[] = []
    const seen = observe(rig.api, async (event) => {
      expect(seen.events.filter((value) => value.kind === "started")).toMatchObject([{ draftID: event.draftID, timeMs: event.timeMs }])
      intents.push(event)
    })
    expect(seen.events).toEqual([])
    await rig.press("\r")
    await wait(() => intents.length === 1 && rig.text() === "")
    expect(seen.edits()).toEqual([])
    expect(seen.events.filter((event) => event.kind === "started")).toHaveLength(1)
    seen.unsubscribe()
  })
})

test.each(["command", "shell"] as const)("%s uses its exact ID and shell ends without a prompt-ledger intent", async (mode) => {
  const intents: TuiComposerTypingSubmit[] = []
  const sent: Record<string, unknown>[] = []
  await withPrompt(async (rig) => {
    const seen = observe(rig.api, async (event) => { intents.push(event) })
    for (const char of mode === "shell" ? "!echo saved" : "/work saved") await rig.press(char)
    const draftID = rig.api.prompt.read().draftID
    await rig.press("\r")
    await wait(() => sent.length === 1 && rig.text() === "")
    if (mode === "command") {
      expect(intents).toHaveLength(1)
      expect(draftID).toBe(intents[0].draftID)
      expect(intents[0].sessionID).toBe("ses_prompt_app")
      expect(sent[0].messageID).toBe(intents[0].messageID)
    }
    if (mode === "shell") {
      expect(intents).toEqual([])
      expect(seen.events.filter((event) => event.kind === "abandoned")).toMatchObject([{ draftID, reason: "sent_to_shell" }])
    }
    expect(sent[0].messageID).toMatch(/^msg_/)
    seen.unsubscribe()
  }, { fetch: async (url, request) => {
    if (url.pathname === "/command") return json([{ name: "work", description: "Work", template: "saved" }])
    if (request.method === "POST") { sent.push(await request.json()); return json({}) }
  } })
})
