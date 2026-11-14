export * as SessionModelRequestOptions from "./model-request-options.js"

import type { SessionRequestKind, SessionRequestOptions } from "@opencode/plugin/effect/session"
import type { Model } from "@opencode/schema/model"
import type { Provider } from "@opencode/schema/provider"
import type { SessionModelRequest } from "./model-request.js"

// Used when the catalog has no output limit for the model.
const OUTPUT_TOKEN_FALLBACK = 32_000
// No reply needs more, however much the model allows.
const OUTPUT_TOKEN_MAX = 256_000
// Prompt text is estimated at about 4 characters per token, which can run low on dense text such as code.
const ESTIMATE_ERROR = 0.15
// Share of the window a step leaves unused when its output limit is fitted to the room left. Providers count a few
// tokens more than we do (chat template, tool schemas), and strict ones reject input plus output past the window.
// Compaction sizes its summary against its own reserve instead.
const WINDOW_HEADROOM = 0.01
// Never ask for less; only reachable with automatic compaction off, since it keeps the window from filling this far.
const OUTPUT_TOKEN_MIN = 1_024

/** The default output limit: the catalog limit, fitted to the room the prompt leaves in the context window. */
export const outputLimit = (
  limit: Model.Info["limit"],
  inputTokens?: SessionModelRequest.Input["inputTokens"],
  headroom = 0,
) => {
  const requested = Math.min(limit.output > 0 ? limit.output : OUTPUT_TOKEN_FALLBACK, OUTPUT_TOKEN_MAX)
  if (inputTokens === undefined || limit.context <= 0) return requested
  const room =
    Math.floor(limit.context * (1 - headroom)) -
    inputTokens.measured -
    Math.ceil(inputTokens.estimated * (1 + ESTIMATE_ERROR))
  return Math.min(requested, Math.max(OUTPUT_TOKEN_MIN, room))
}

/** Agent settings override engine defaults before hooks receive their own mutable draft. */
export const defaults = (
  kind: SessionRequestKind,
  input: SessionModelRequest.Input,
  settings?: Provider.Settings,
): SessionRequestOptions => ({
  ...(kind === "primary"
    ? { maxTokens: outputLimit(input.model.limit, input.inputTokens, WINDOW_HEADROOM) }
    : kind === "compaction"
      ? { maxTokens: outputLimit(input.model.limit, input.inputTokens) }
      : {}),
  ...structuredClone(settings ?? {}),
})
