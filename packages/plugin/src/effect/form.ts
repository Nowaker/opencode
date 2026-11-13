import type { SessionApi, SessionFormListInput, SessionFormListOutput } from "@opencode/client/effect/api"
import type { Effect } from "effect"

export interface FormDomain extends Pick<SessionApi<unknown>["form"], "get" | "reply" | "cancel"> {
  readonly list: (input?: Partial<SessionFormListInput>) => Effect.Effect<SessionFormListOutput>
}
