import { expect, setDefaultTimeout, test } from "bun:test"
import { withPrompt, wait } from "../fixture/prompt-app"
import { json } from "../fixture/tui-sdk"

setDefaultTimeout(30_000)

const sessionID = "ses_prompt_app"
const archivedAt = 1794614400000
const by = { kind: "tool", machine: "m4max", sessionID: "ses_repaired", tool: "repair" }
const note = "Continue in the repaired copy"
const details = { sessionID, archivedAt, by, note }
const unarchived = {
  at: archivedAt - 1000,
  by: { kind: "api", client: "portal", instance: "prod", machine: "desktop" },
  note: "Earlier work resumed",
}
const session = {
  time: { created: archivedAt - 1000, updated: archivedAt, archived: archivedAt },
  metadata: { vibeterm: { archive: { sessionId: sessionID, archived: { at: archivedAt, by, note }, unarchived } } },
}

for (const mode of ["prompt", "command", "shell"] as const) {
  test(`archived ${mode} keeps its draft on cancel and sends once with unarchive on confirm`, async () => {
    const sends: Record<string, unknown>[] = []
    const clients: (string | null)[] = []
    const typed = mode === "shell" ? "!printf saved" : mode === "command" ? "/work saved" : "saved prompt"
    await withPrompt(
      async (rig) => {
        expect(rig.frame()).toContain("archived")
        for (const char of typed) await rig.press(char)
        const draft = rig.text()
        await rig.press("\r")
        await wait(() => rig.frame().includes("Session archived"))
        expect(rig.frame()).toContain(note)
        expect(rig.frame()).toContain("ses_repaired")
        expect(rig.frame()).toContain("m4max")
        expect(rig.frame().replace(/\s+/g, " ")).toContain("Portal prod on desktop")
        expect(rig.frame()).toContain(unarchived.note)
        expect(sends).toHaveLength(0)
        await rig.press("\x1b")
        expect(rig.text()).toBe(draft)
        await rig.press("\r")
        await wait(() => rig.frame().includes("Session archived"))
        await rig.press("u")
        await wait(() => sends.length === 1)
        expect(sends[0].unarchive).toBe(true)
        expect(clients).toEqual(["tui"])
        expect(rig.text()).toBe("")
        expect(rig.frame()).not.toContain("Session archived")
        if (mode === "prompt") expect(sends[0].parts).toMatchObject([{ type: "text", text: typed }])
        if (mode === "command") expect(sends[0]).toMatchObject({ command: "work", arguments: "saved" })
        if (mode === "shell") expect(sends[0]).toMatchObject({ command: "printf saved" })
      },
      {
        session,
        fetch: async (url, request) => {
          if (url.pathname === "/command") return json([{ name: "work", description: "Work", template: "saved" }])
          if (request.method !== "POST") return
          sends.push(await request.json())
          clients.push(request.headers.get("x-opencode-client"))
          return json({})
        },
      },
    )
  })
}

test("a stale store archive conflict restores the original draft and confirms without another refusal", async () => {
  const sends: Record<string, unknown>[] = []
  await withPrompt(
    async (rig) => {
      for (const char of "stale store") await rig.press(char)
      await rig.press("\r")
      await wait(() => rig.frame().includes("Session archived"))
      expect(rig.text()).toBe("stale store")
      expect(rig.frame()).toContain(note)
      await rig.press("\x1b")
      expect(rig.text()).toBe("stale store")
      await rig.press("\r")
      await wait(() => rig.frame().includes("Session archived"))
      expect(sends).toHaveLength(1)
      await rig.press("\r")
      await wait(() => sends.length === 2)
      expect(sends[1].unarchive).toBe(true)
      expect(sends[1].parts).toMatchObject([{ type: "text", text: "stale store" }])
      expect(rig.text()).toBe("")
    },
    {
      fetch: async (url, request) => {
        if (!url.pathname.endsWith("/message") || request.method !== "POST") return
        const body: Record<string, unknown> = await request.json()
        sends.push(body)
        return body.unarchive ? json({}) : json({ name: "SessionArchivedError", data: details }, { status: 409 })
      },
    },
  )
})

test("a copied archive record cannot display another session's note", async () => {
  await withPrompt(
    async (rig) => {
      for (const char of "hello") await rig.press(char)
      await rig.press("\r")
      await wait(() => rig.frame().includes("Session archived"))
      expect(rig.frame()).not.toContain(note)
      await rig.press("\x1b")
      expect(rig.text()).toBe("hello")
    },
    {
      session: {
        ...session,
        metadata: { vibeterm: { archive: { ...session.metadata.vibeterm.archive, sessionId: "ses_foreign" } } },
      },
    },
  )
})

test.each([
  { by: { kind: "tui", machine: "desktop" }, label: "you (TUI on desktop)" },
  { by: { kind: "api", client: "portal", instance: "prod", machine: "m4max" }, label: "Portal prod on m4max" },
  {
    by: { kind: "tool", sessionID: "ses_owner", sessionTitle: "Repair session", machine: "desktop", tool: "archive" },
    label: "session Repair session on desktop (archive)",
  },
  { by: { kind: "system", machine: "desktop", component: "session-sync" }, label: "Vibeterm session-sync on desktop" },
])("the archive dialog identifies $label", async ({ by, label }) => {
  await withPrompt(
    async (rig) => {
      await rig.press("x")
      await rig.press("\r")
      await wait(() => rig.frame().includes("Session archived"))
      expect(rig.frame().replace(/\s+/g, "")).toContain(label.replace(/\s+/g, ""))
      await rig.press("\x1b")
      expect(rig.text()).toBe("x")
    },
    {
      session: {
        ...session,
        metadata: { vibeterm: { archive: { sessionId: sessionID, archived: { at: archivedAt, by } } } },
      },
    },
  )
})
