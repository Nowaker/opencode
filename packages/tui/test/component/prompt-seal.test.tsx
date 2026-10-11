import { expect, setDefaultTimeout, test } from "bun:test"
import { wait, withPrompt } from "../fixture/prompt-app"

setDefaultTimeout(30_000)

test("a seal blocks typing, pastes, commands, plugin edits and navigation until fresh input after release", async () => {
  await withPrompt(async (rig) => {
    // Given: a session composer holding typed text.
    for (const char of "keep") await rig.press(char)
    expect(rig.text()).toBe("keep")

    // When: it is sealed, and then typed into, pasted into, cleared, replaced, and navigated away from.
    const result = rig.api.prompt.seal()
    if (result.status !== "sealed") throw new Error(`refused: ${result.reason}`)
    expect(result.draft).toMatchObject({ input: "keep", sessionID: "ses_prompt_app", reason: "disabled" })
    for (const char of " me") await rig.press(char)
    await rig.press("\x1b[200~pasted\x1b[201~")
    rig.api.keymap.dispatchCommand("prompt.clear")
    const guard = rig.api.prompt.snapshot()
    expect(rig.api.prompt.replace({ ...guard, correlationId: "sealed", text: "overwritten" }).status).toBe("not-ready")
    rig.api.route.navigate("home")
    await Bun.sleep(50)

    // Then: nothing reached the composer or the route, and the user is told why.
    expect(rig.text()).toBe("keep")
    expect(rig.api.route.current.name).toBe("session")
    await wait(() => rig.frame().includes("Input paused for restart"))

    // When: the seal is released.
    expect(result.seal.release()).toBe(true)

    // Then: blocked attempts do not replay, and fresh typing and pastes work again.
    await rig.press("!")
    await rig.press("\x1b[200~fresh\x1b[201~")
    expect(rig.api.route.current.name).toBe("session")
    expect(rig.text()).toBe("keep!fresh")
    expect(rig.frame()).not.toContain("Input paused for restart")
    rig.api.route.navigate("home")
    await wait(() => rig.api.route.current.name === "home")
  })
})

test("a seal is refused while autocomplete is open, and changes nothing", async () => {
  await withPrompt(async (rig) => {
    await rig.press("/")
    await wait(() => rig.api.prompt.snapshot().reason !== "ready")
    expect(rig.api.prompt.seal()).toEqual({ status: "refused", reason: "busy" })
    await rig.press("x")
    expect(rig.text()).toBe("/x")
    await rig.press("\x1b")
    await wait(() => rig.api.prompt.snapshot().reason === "ready")
    await rig.press("\x03")
  })
})
