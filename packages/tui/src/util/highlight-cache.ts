import { getTreeSitterClient, type TreeSitterClient } from "@opentui/core"

type HighlightOnce = TreeSitterClient["highlightOnce"]
type HighlightResult = Awaited<ReturnType<HighlightOnce>>

// The parser worker's answer for a piece of text, kept by content and language. A <code> block
// asks the worker every time it is created, so without this a remounted transcript, a reopened
// session or a theme switch reparses every command it shows. Concurrent requests for the same
// text share one worker round trip, and a failed request is forgotten so it can be retried.
export function createHighlightCache(highlightOnce: HighlightOnce, limit = { entries: 1000, chars: 4_000_000 }) {
  const entries = new Map<string, { result: Promise<HighlightResult>; chars: number }>()
  let chars = 0

  function evict() {
    for (const [key, entry] of entries) {
      if (entries.size <= limit.entries && chars <= limit.chars) return
      entries.delete(key)
      chars -= entry.chars
    }
  }

  return (content: string, filetype: string): Promise<HighlightResult> => {
    const key = `${filetype}\0${content}`
    const hit = entries.get(key)
    if (hit) {
      entries.delete(key)
      entries.set(key, hit)
      return hit.result
    }
    const result = highlightOnce(content, filetype)
    const entry = { result, chars: content.length }
    entries.set(key, entry)
    chars += entry.chars
    evict()
    result.catch(() => {
      if (entries.get(key) !== entry) return
      entries.delete(key)
      chars -= entry.chars
    })
    return result
  }
}

let shared: TreeSitterClient | undefined

// The shared parser worker with highlightOnce answered from the cache above. Everything else is
// the worker itself, so <code treeSitterClient={...}> keeps a single worker.
export function cachedTreeSitterClient() {
  if (shared) return shared
  const client = getTreeSitterClient()
  const highlightOnce = createHighlightCache(client.highlightOnce.bind(client))
  shared = new Proxy(client, {
    get(target, property) {
      if (property === "highlightOnce") return highlightOnce
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return shared
}
