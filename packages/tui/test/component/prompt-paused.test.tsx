import { expect, setDefaultTimeout, test } from "bun:test"
import { json } from "../fixture/tui-sdk"
import { withPrompt } from "../fixture/prompt-app"

setDefaultTimeout(30_000)

const reason = "Meridian restart (vibeterm-meridian@dev); unpauses when done"
const paused = { at: 1, mode: "soft", state: "paused", source: { kind: "api" }, reason }

/*
 * 2026-11-25: the paused footer was three boxes in a row, each wrapping on its own, so at a narrow width
 * "paused - /unpause to continue", the reason and the deferred-call hint spilled into misaligned columns.
 */
test("the paused footer is one line that truncates instead of wrapping", async () => {
  await withPrompt(
    async (rig) => {
      const frame = await rig.settle()
      const lines = frame.split("\n")
      const row = lines.findIndex((line) => line.includes("paused · /unpause"))
      expect(row).toBeGreaterThan(-1)
      expect(lines[row]).toContain("· Meridian restart")
      // The reason does not fit at this width, and its tail must not wrap onto the next line.
      expect(frame).not.toContain("unpauses when done")
      expect(lines[row + 1] ?? "").not.toContain("vibeterm-meridian")
      // The truncated reason keeps a gap before the right-hand hints instead of running into them.
      expect(lines[row]).toMatch(/[^ ] {2,}[^ ]/)
    },
    {
      width: 80,
      fetch: async (url) =>
        url.pathname === "/session/status" ? json({ ses_prompt_app: { type: "idle", paused } }) : undefined,
    },
  )
})
