import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { InstantCache } from "../../src/instant/cache"
import { tmpdir } from "../fixture/fixture"

const agent = { name: "build", label: "Build", color: "#5c9cf5ff" }
const model = { providerID: "p", modelID: "m", label: "M", provider: "P" }

describe("instant startup cache", () => {
  test("keeps well-typed fields and drops the rest", async () => {
    await using dir = await tmpdir()
    const file = path.join(dir.path, "opencode.tui-startup.json")
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        theme: { text: "#eeeeee", success: "#4fd6be", textMuted: 128, border: "red" },
        shortcuts: { agents: "tab" },
        directories: {
          "/good": { agent, model, variant: "high", auto: false, branch: "main", homeBottomRows: 4, at: 2 },
          "/damaged": { agent: { name: "build" }, model: null, variant: 3, homeBottomRows: -1, at: 1 },
          "/undated": { agent, model },
          "/scalar": "x",
        },
        sessions: {
          ses_good: { agent, model, title: "Fix the build", child: false, usage: "1,234 (5%)", at: 3 },
          ses_damaged: { agent: { name: "build" }, title: 5, child: "no", usage: null, at: 4 },
          ses_undated: { title: "Fix the build" },
        },
      }),
    )
    expect(InstantCache.read(file)).toEqual({
      version: 1,
      theme: { text: "#eeeeee", success: "#4fd6be" },
      directories: {
        "/good": { agent, model, variant: "high", auto: false, branch: "main", homeBottomRows: 4, at: 2 },
        "/damaged": { at: 1 },
      },
      sessions: {
        ses_good: { agent, model, title: "Fix the build", child: false, usage: "1,234 (5%)", at: 3 },
        ses_damaged: { at: 4 },
      },
    })
  })

  test("an unreadable or foreign file reads as no cache", async () => {
    await using dir = await tmpdir()
    const file = path.join(dir.path, "opencode.tui-startup.json")
    fs.writeFileSync(file, "{ not json")
    expect(InstantCache.read(file)).toBeUndefined()
    fs.writeFileSync(file, JSON.stringify({ version: 2, directories: {} }))
    expect(InstantCache.read(file)).toBeUndefined()
    fs.writeFileSync(file, JSON.stringify([1]))
    expect(InstantCache.read(file)).toBeUndefined()
  })

  test("a write drops what a read would not keep", async () => {
    await using dir = await tmpdir()
    const file = path.join(dir.path, "opencode.tui-startup.json")
    fs.writeFileSync(file, JSON.stringify({ version: 1, theme: { text: 1 }, directories: { "/x": { at: "now" } } }))
    InstantCache.write((data) => data, file)
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1, theme: {}, directories: {}, sessions: {} })
  })
})
