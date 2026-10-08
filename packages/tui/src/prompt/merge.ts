import { promptOffsetWidth } from "./display"
import type { PromptInfo } from "./history"

export const FAILED_PROMPT_SEPARATOR = "\n\n--\n\n"

/**
 * Puts a prompt that failed to send above what was typed in the composer since, separated by a `--` line,
 * unless the composer already contains it. Pasted and attached parts of both keep their places: part offsets
 * are display cells, so the current prompt's parts move by the width of everything put before them. `shift`
 * is the same distance in characters, for moving the caret.
 */
export function mergeFailedPrompt(failed: PromptInfo, current: PromptInfo) {
  const text = failed.input.trimEnd()
  if (current.input.includes(text)) return
  const prefix = text + FAILED_PROMPT_SEPARATOR
  const width = promptOffsetWidth(prefix)
  const kept = promptOffsetWidth(text)
  return {
    shift: prefix.length,
    prompt: {
      ...current,
      input: prefix + current.input,
      parts: [
        ...failed.parts.filter((part) => (range(part)?.end ?? 0) <= kept),
        ...current.parts.map((part) => moved(part, width)),
      ],
    } satisfies PromptInfo,
  }
}

type Part = PromptInfo["parts"][number]

function range(part: Part) {
  if (part.type === "agent") return part.source
  return part.source?.text
}

function moved(part: Part, by: number) {
  const copy = structuredClone(part)
  const span = range(copy)
  if (span) {
    span.start += by
    span.end += by
  }
  return copy
}
