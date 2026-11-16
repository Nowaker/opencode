import type { Message, Part, SessionStatus } from "@opencode-ai/sdk/v2"

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T

export type LiveFrame =
  | {
      readonly type: "vibeterm.stream.snapshot"
      readonly properties: {
        readonly version: 1
        readonly sessionID: string
        readonly epoch: string
        readonly sequence: 0
        readonly status: Immutable<SessionStatus>
        readonly messages: readonly { readonly info: Message; readonly parts: readonly Part[] }[]
      }
    }
  | {
      readonly type: "vibeterm.stream.event"
      readonly properties: {
        readonly version: 1
        readonly sessionID: string
        readonly epoch: string
        readonly sequence: number
        readonly event: { readonly type: string; readonly properties: Record<string, unknown> }
      }
    }

export type LiveEvents = {
  readonly open: (input: { readonly sessionID: string; readonly signal?: AbortSignal }) => Promise<{
    readonly frames: ReadableStream<LiveFrame>
    readonly close: () => void
  }>
}
