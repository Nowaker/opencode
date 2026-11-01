export function textStop(sequences: readonly string[]) {
  if (sequences.some((sequence) => sequence.length === 0)) {
    throw new RangeError("Stop sequences must not be empty")
  }
  const patterns = sequences.flatMap((sequence, index) => [
    { text: sequence, index, start: false },
    ...(sequence.startsWith("\n") && sequence.length > 1
      ? [{ text: sequence.slice(1), index, start: true }]
      : []),
  ])
  let pending = ""
  let published = 0
  let stopped: number | undefined

  return {
    push(delta: string) {
      if (stopped !== undefined) return { text: "", stop: stopped }
      const text = pending + delta
      let match: { offset: number; index: number } | undefined
      for (const pattern of patterns) {
        const offset = pattern.start
          ? published === 0 && text.startsWith(pattern.text)
            ? 0
            : -1
          : text.indexOf(pattern.text)
        if (offset < 0 || (match && match.offset <= offset)) continue
        match = { offset, index: pattern.index }
      }
      if (match) {
        pending = ""
        stopped = match.index
        return { text: text.slice(0, match.offset), stop: stopped }
      }
      let held = 0
      for (const pattern of patterns) {
        for (let length = Math.min(pattern.text.length - 1, text.length); length > held; length--) {
          if (pattern.start && published + text.length - length !== 0) continue
          if (!text.endsWith(pattern.text.slice(0, length))) continue
          held = length
          break
        }
      }
      pending = text.slice(text.length - held)
      const safe = text.slice(0, text.length - held)
      published += safe.length
      return { text: safe, stop: undefined }
    },
    finish() {
      const text = pending
      pending = ""
      published += text.length
      return text
    },
  }
}
