import assert from "node:assert/strict"
import { beforeEach, expect, test } from "bun:test"
import { Skill } from "@opencode/schema/skill"
import { saveDraft, takeDraft } from "../src/component/prompt/draft-stash"
import type { PromptInfo } from "../src/prompt/history"
import { composerEditor, mountComposer } from "./fixture/composer"

const prompt: PromptInfo = {
  text: "@file @agent @skill [paste]",
  files: [
    {
      uri: "data:text/plain;base64,YQ==",
      path: "owned.txt",
      source: { type: "inline" },
      mention: { start: 0, end: 5, text: "@file" },
    },
  ],
  agents: [{ name: "agent", mention: { start: 6, end: 12, text: "@agent" } }],
  skills: [{ id: Skill.ID.make("skl_observation"), mention: { start: 13, end: 19, text: "@skill" } }],
  pasted: [{ text: "expanded\npaste", source: { start: 20, end: 27, text: "[paste]" } }],
}

beforeEach(() => {
  takeDraft(undefined)
  saveDraft(undefined, { prompt: structuredClone(prompt), cursor: 27 })
})

test("observation preserves every native file agent skill and pasted draft part", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  expect(setup.composer.current()).toEqual({
    status: "ready",
    kind: "final",
    sessionID: null,
    draft: { ...prompt, mode: "normal", caret: 27, selection: { anchor: 27, focus: 27 } },
  })
})

test("snapshots cannot mutate the native draft or change after subsequent edits", async () => {
  await using setup = await mountComposer()
  await setup.waitFor(() => setup.composer.current().status === "ready")
  const value = setup.composer.current()
  assert.equal(value.status, "ready")
  const file = value.draft.files?.[0]
  assert.ok(file?.mention)
  expect(() => Object.defineProperty(file.mention, "text", { value: "injected" })).toThrow(TypeError)
  expect(() => Object.defineProperty(value.draft.pasted, "length", { value: 0 })).toThrow(TypeError)
  composerEditor(setup).gotoBufferHome()
  await setup.mockInput.typeText("x ")
  expect(value.draft).toEqual({ ...prompt, mode: "normal", caret: 27, selection: { anchor: 27, focus: 27 } })
  expect(setup.composer.current()).toMatchObject({
    draft: {
      text: "x " + prompt.text,
      files: [{ mention: { start: 2, end: 7, text: "@file" } }],
      pasted: [{ text: "expanded\npaste", source: { start: 22, end: 29, text: "[paste]" } }],
    },
  })
})
