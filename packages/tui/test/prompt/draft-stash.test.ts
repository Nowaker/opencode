import { describe, expect, test } from "bun:test"
import { saveDraft, takeDraft } from "../../src/component/prompt/draft-stash"
import { tmpdir } from "../fixture/fixture"

const entry = { prompt: { input: "refactor the parser", parts: [] }, cursor: 19 }

describe("prompt draft stash", () => {
  test("a saved draft is taken once, by the first taker", async () => {
    await using dir = await tmpdir()
    await saveDraft(dir.path, "ses_a", entry)
    const takes = await Promise.all([takeDraft(dir.path, "ses_a"), takeDraft(dir.path, "ses_a")])
    expect(takes.filter((take) => take !== undefined)).toEqual([entry])
    expect(await takeDraft(dir.path, "ses_a")).toBeUndefined()
  })

  test("drafts are kept per session", async () => {
    await using dir = await tmpdir()
    await saveDraft(dir.path, "ses_a", entry)
    expect(await takeDraft(dir.path, "ses_b")).toBeUndefined()
    expect(await takeDraft(dir.path, "ses_a")).toEqual(entry)
  })
})
