export * as StartupIntake from "./intake"

import { StartupInputBytes } from "./input"

export type Outcome = "quit" | "stopped" | undefined

/**
 * The worker's side of a handover cutoff. Bytes are applied token by token as they arrive. After request(), an
 * idle intake stops at once; one in the middle of a token (a split character, an escape sequence, a paste, a lone
 * Escape before its deadline) keeps reading until that one token completes, applies it, and stops. Every byte after
 * the stop stays in rest(), unparsed.
 */
export function create(apply: (token: StartupInputBytes.Token) => "quit" | void) {
  const tokenizer = StartupInputBytes.createTokenizer()
  let stopping = false
  let owed = false
  let stopped = false
  const drain = (): Outcome => {
    while (!stopped) {
      if (stopping && !owed) {
        stopped = true
        return "stopped"
      }
      const token = tokenizer.next({ single: stopping })
      if (!token) return
      if (stopping) owed = false
      if (apply(token) === "quit") return "quit"
    }
  }
  return {
    push(bytes: Uint8Array): Outcome {
      tokenizer.push(bytes)
      if (stopped) return
      return drain()
    },
    request(): Outcome {
      if (stopping) return
      stopping = true
      owed = tokenizer.incomplete
      return drain()
    },
    get escapePending() {
      return !stopped && tokenizer.escapePending
    },
    /** A lone Escape reached its deadline. */
    flushEscape(): Outcome {
      if (stopped) return
      const token = tokenizer.flushEscape()
      if (!token) return
      if (stopping) owed = false
      if (apply(token) === "quit") return "quit"
      return drain()
    },
    rest() {
      return tokenizer.rest()
    },
  }
}
