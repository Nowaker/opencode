import { Context, Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { DisposeReason } from "@/effect/instance-registry"

export interface CancelOptions {
  readonly requester?: typeof SessionV1.AbortRequester.Type
}

export type Metadata =
  | { readonly cause: "cancel"; readonly requester?: typeof SessionV1.AbortRequester.Type }
  | { readonly cause: "dispose"; readonly dispose?: DisposeReason }

export interface State {
  metadata?: Metadata
}

export const Current = Context.Reference<State | undefined>("~opencode/SessionAbort", { defaultValue: () => undefined })

export const metadata = Effect.gen(function* () {
  const current = yield* Current
  if (!current) return undefined
  return current.metadata ?? ({ cause: "dispose" } satisfies Metadata)
})

export * as SessionAbort from "./abort"
