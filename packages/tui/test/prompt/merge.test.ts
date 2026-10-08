import { describe, expect, test } from "bun:test"
import { mergeFailedPrompt } from "../../src/prompt/merge"
import { promptOffsetWidth } from "../../src/prompt/display"
import type { PromptInfo } from "../../src/prompt/history"

function pasted(input: string, value: string): PromptInfo["parts"][number] {
  const start = promptOffsetWidth(input.slice(0, input.indexOf(value)))
  return {
    type: "text",
    text: "pasted body",
    source: { text: { start, end: start + promptOffsetWidth(value), value } },
  }
}

function image(input: string, value: string): PromptInfo["parts"][number] {
  const start = promptOffsetWidth(input.slice(0, input.indexOf(value)))
  return {
    type: "file",
    mime: "image/png",
    url: "data:image/png;base64,AA==",
    source: { type: "file", path: "a.png", text: { start, end: start + value.length, value } },
  }
}

function agent(input: string, value: string): PromptInfo["parts"][number] {
  const start = promptOffsetWidth(input.slice(0, input.indexOf(value)))
  return { type: "agent", name: "explore", source: { start, end: start + promptOffsetWidth(value), value } }
}

// Every part's offsets must still point at its own placeholder in the merged text.
function placeholders(prompt: PromptInfo) {
  return prompt.parts.map((part) => {
    const span = part.type === "agent" ? part.source : part.source?.text
    if (!span) return undefined
    const chars = [...prompt.input]
    let cell = 0
    let at = 0
    while (at < chars.length && cell < span.start) cell += promptOffsetWidth(chars[at++])
    let end = at
    while (end < chars.length && cell < span.end) cell += promptOffsetWidth(chars[end++])
    return chars.slice(at, end).join("")
  })
}

describe("mergeFailedPrompt", () => {
  test("puts the failed prompt above the new text, trimmed, with a separator", () => {
    const merged = mergeFailedPrompt({ input: "fix the bug  \n\n", parts: [] }, { input: "new idea", parts: [] })
    expect(merged?.prompt.input).toBe("fix the bug\n\n--\n\nnew idea")
    expect(merged?.shift).toBe("fix the bug\n\n--\n\n".length)
  })

  test("changes nothing when the new text already contains the failed prompt", () => {
    expect(
      mergeFailedPrompt({ input: "fix the bug\n", parts: [] }, { input: "please fix the bug now", parts: [] }),
    ).toBeUndefined()
  })

  test("keeps every pasted, attached and agent part of both prompts on its placeholder", () => {
    const failedText = "see [Pasted ~3 lines] and [Image 1] "
    const failed = {
      input: failedText,
      parts: [pasted(failedText, "[Pasted ~3 lines]"), image(failedText, "[Image 1]")],
    }
    const currentText = "中文 @explore check [Image 1] then [Pasted ~5 lines]"
    const current = {
      input: currentText,
      parts: [
        agent(currentText, "@explore"),
        image(currentText, "[Image 1]"),
        pasted(currentText, "[Pasted ~5 lines]"),
      ],
      mode: "normal" as const,
    }

    const merged = mergeFailedPrompt(failed, current)

    expect(merged?.prompt.input).toBe(`${failedText.trimEnd()}\n\n--\n\n${currentText}`)
    expect(merged?.prompt.mode).toBe("normal")
    expect(placeholders(merged!.prompt)).toEqual([
      "[Pasted ~3 lines]",
      "[Image 1]",
      "@explore",
      "[Image 1]",
      "[Pasted ~5 lines]",
    ])
    expect(current.parts[0]).toEqual(agent(currentText, "@explore"))
  })

  test("measures the shift in display cells for wide characters", () => {
    const failedText = "修复这个错误"
    const currentText = "x [Pasted ~4 lines]"
    const merged = mergeFailedPrompt(
      { input: failedText, parts: [] },
      { input: currentText, parts: [pasted(currentText, "[Pasted ~4 lines]")] },
    )
    expect(placeholders(merged!.prompt)).toEqual(["[Pasted ~4 lines]"])
    expect(merged?.shift).toBe(failedText.length + 6)
  })
})
