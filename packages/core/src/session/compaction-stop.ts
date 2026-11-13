/** Holds possible stop prefixes so no part of a matched boundary reaches a delta. */
export function compactionStop(sequences: ReadonlyArray<string>) {
  const stops = sequences.filter((value) => value.length > 0)
  let pending = ""
  let stopped = false
  return {
    get stopped() {
      return stopped
    },
    write(text: string) {
      if (stopped) return ""
      pending += text
      const matches = stops.map((stop) => pending.indexOf(stop)).filter((index) => index >= 0)
      if (matches.length > 0) {
        const output = pending.slice(0, Math.min(...matches))
        pending = ""
        stopped = true
        return output
      }
      const held = stops.reduce((longest, stop) => {
        for (let size = Math.min(stop.length - 1, pending.length); size > longest; size--) {
          if (pending.endsWith(stop.slice(0, size))) return size
        }
        return longest
      }, 0)
      const output = pending.slice(0, pending.length - held)
      pending = pending.slice(pending.length - held)
      return output
    },
    finish() {
      const output = pending
      pending = ""
      return output
    },
  }
}
