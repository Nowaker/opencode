export type MessageHistoryMutation = {
  readonly action: "undo" | "redo"
  readonly expectedRevision: string
}

export type MessageHistoryRequest = { readonly version: 1; readonly sessionID: string } & (
  | { readonly operation: "read" }
  | { readonly operation: "mutate"; readonly mutation: MessageHistoryMutation }
)

export type MessageHistoryClassifier = (
  info: Readonly<Record<string, unknown>>,
  parts: readonly Readonly<Record<string, unknown>>[],
  firstUser: boolean,
) => boolean

export type MessageHistoryReady = {
  readonly version: 1
  readonly status: "ready"
  readonly revision: string
  readonly canUndo: boolean
} & (
  | {
      readonly boundaryKind: "none"
      readonly boundaryMessageID: null
      readonly boundaryCreatedAt: null
      readonly canRedo: false
    }
  | {
      readonly boundaryKind: "protected"
      readonly boundaryMessageID: string
      readonly boundaryCreatedAt: number
      readonly canRedo: boolean
    }
)

export type MessageHistoryUnavailableReason =
  | "unsupported-owner"
  | "owner-unavailable"
  | "busy"
  | "paused"
  | "armed-revert"
  | "unsupported-boundary"

export type MessageHistoryBoundary =
  | { readonly boundaryKind: "none" | "unknown"; readonly boundaryMessageID: null; readonly boundaryCreatedAt: null }
  | { readonly boundaryKind: "protected"; readonly boundaryMessageID: string; readonly boundaryCreatedAt: number }
  | { readonly boundaryKind: "armed" | "legacy"; readonly boundaryMessageID: string | null; readonly boundaryCreatedAt: number | null }

export type MessageHistoryUnavailable = {
  readonly version: 1
  readonly status: "unavailable"
  readonly reason: MessageHistoryUnavailableReason
} & MessageHistoryBoundary

export type MessageHistoryState = MessageHistoryReady | MessageHistoryUnavailable

export type MessageHistoryResult =
  | { readonly version: 1; readonly status: "applied"; readonly state: MessageHistoryReady; readonly affectedUserMessageID: string }
  | {
      readonly version: 1
      readonly status: "rejected"
      readonly reason: MessageHistoryUnavailableReason | "stale-revision" | "nothing-to-undo" | "nothing-to-redo"
        | "session-not-found" | "outcome-unknown"
    }

export type MessageHistory = {
  readonly version: 1
  readonly execute: (
    request: MessageHistoryRequest,
    /** Receives persisted user data and ascending part IDs; file parts expose only their type. */
    isHumanTurn: MessageHistoryClassifier,
  ) => Promise<MessageHistoryState | MessageHistoryResult>
}
