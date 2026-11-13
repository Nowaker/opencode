import type { OpenCodeClient } from "@opencode/client"

export interface JobDomain {
  readonly list: (input: { readonly parentSessionID: string; readonly descendants?: boolean }) => Promise<{
    readonly data: Readonly<Awaited<ReturnType<OpenCodeClient["experimental"]["job"]["list"]>>>
  }>
  readonly cancel: OpenCodeClient["experimental"]["job"]["cancel"]
  /** Reads an owned native outcome; aborting wait stops only the reader. */
  readonly result: (
    input: { readonly parentID: string; readonly jobID: string; readonly wait?: boolean },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<
    Awaited<ReturnType<OpenCodeClient["experimental"]["job"]["list"]>>[number] & {
      readonly output?: string
      readonly error?: string
    }
  >
}
