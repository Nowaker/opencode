import type { StartupEditor } from "./editor"
import type { StartupFrame } from "./frame"

export type Init = {
  readonly route: StartupFrame.Route
  readonly prompt?: string
  readonly width: number
  readonly height: number
  readonly version?: string
  /** Shared with the main thread: [0] is the terminal write lock, [1] is set once the worker must stop writing. */
  readonly flags: Int32Array
}

export type Request =
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  | { readonly type: "status"; readonly text?: string }
  | { readonly type: "handover" }

export type Reply =
  | { readonly type: "ready" }
  | { readonly type: "unavailable"; readonly message: string }
  | { readonly type: "quit" }
  | { readonly type: "handover"; readonly snapshot: StartupEditor.Snapshot; readonly bytes: Uint8Array }
