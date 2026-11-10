import { expect, test } from "bun:test"
import type { TuiDirectoryClickEvent } from "@opencode-ai/plugin/tui"
import HomeFooter from "../../src/feature-plugins/home/footer"
import type { BuiltinTuiPlugin } from "../../src/feature-plugins/builtins"
import { withPrompt, type PromptRig } from "../fixture/prompt-app"
import { directory } from "../fixture/tui-sdk"

// A plugin that answers a directory click with `take`, recording what it was handed.
function directoryPlugin(take: boolean, seen: TuiDirectoryClickEvent[]): BuiltinTuiPlugin {
  return {
    id: "test:directory-click",
    tui: async (api) => {
      api.click.onDirectory((event) => {
        seen.push(event)
        return take
      })
    },
  }
}

// Clicks the first character of the home footer's directory, the row ending in the branch.
async function clickFooterDirectory(rig: PromptRig) {
  const rows = (await rig.settle()).split("\n")
  const row = rows.findIndex((line) => line.includes(":main"))
  if (row < 0) throw new Error("the home footer did not draw its directory")
  await rig.click(rows[row]!.search(/\S/), row)
  return rig.settle()
}

test("a plugin that takes a click on the home footer's directory gets the path, and nothing is copied", async () => {
  const seen: TuiDirectoryClickEvent[] = []
  await withPrompt(
    async (rig) => {
      const frame = await clickFooterDirectory(rig)
      expect(seen).toEqual([{ directory, location: "home_footer" }])
      expect(frame).not.toContain("Copied")
      expect(frame).not.toContain("Failed to copy")
    },
    { home: true, plugins: [HomeFooter, directoryPlugin(true, seen)] },
  )
})
