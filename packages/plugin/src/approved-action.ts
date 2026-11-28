export type ApprovedActionBinding = {
  readonly sessionID: string
  readonly actionID: string
  readonly messageID: string
}

export type ApprovedActionOwner = {
  readonly ownerID: string
  readonly generation: number
}

export type ApprovedActionRefused = {
  readonly kind: "refused"
  readonly reason:
    | "unsupported-owner"
    | "owner-unavailable"
    | "stale-owner"
    | "session-not-found"
    | "paused"
    | "archived"
    | "armed-revert"
    | "invalid-binding"
    | "expired-preparation"
    | "conflict"
    | "busy"
}

export type ApprovedActionFailure =
  | "owner-lost"
  | "pane-unavailable"
  | "claim-unavailable"
  | "launch-refused"
  | "result-unavailable"

export type ApprovedActionReceipt = ApprovedActionBinding & {
  readonly outcome:
    | { readonly kind: "exited"; readonly exitCode: number; readonly output: string }
    | { readonly kind: "not-run" | "unknown"; readonly reason: ApprovedActionFailure }
}

export type ApprovedActionStored = {
  readonly kind: "stored"
  readonly messageID: string
  readonly partID: string
}

export type ApprovedActionActivity = ApprovedActionBinding & {
  readonly sequence: number
  readonly phase: "running" | "settled" | "unconfirmed"
  readonly preview: string
  readonly outcome?: ApprovedActionReceipt["outcome"]
}

/** In-process owner capability for projecting actions run by a trusted plugin. */
export type ApprovedAction = {
  readonly version: 1
  readonly capability: (input: { readonly sessionID: string }) => Promise<
    { readonly kind: "ready"; readonly owner: ApprovedActionOwner } | ApprovedActionRefused
  >
  readonly prepare: (input: ApprovedActionBinding & { readonly owner: ApprovedActionOwner }) => Promise<
    | { readonly kind: "prepared"; readonly preparationID: string; readonly expiresAt: number }
    | ApprovedActionRefused
  >
  readonly admit: (
    input: ApprovedActionBinding & { readonly owner: ApprovedActionOwner; readonly preparationID: string },
    callbacks: {
      readonly run: (input: {
        /** Aborted with the owner lifetime, not the admission request. */
        readonly signal: AbortSignal
        /** Chunks are numbered contiguously from 1. */
        readonly stream: (chunk: { readonly sequence: number; readonly text: string }) => void
      }) => Promise<ApprovedActionReceipt | undefined>
    },
  ) => Promise<{ readonly kind: "admitted" } | ApprovedActionRefused>
  readonly settle: (receipt: ApprovedActionReceipt) => Promise<ApprovedActionStored | ApprovedActionRefused>
  readonly receipt: (receipt: ApprovedActionReceipt) => Promise<
    ApprovedActionStored | { readonly kind: "missing" } | ApprovedActionRefused
  >
}
