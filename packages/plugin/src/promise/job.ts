import type { OpenCodeClient } from "@opencode/client"

export interface JobDomain {
  readonly list: (input: { readonly parentSessionID: string; readonly descendants?: boolean }) => Promise<{
    readonly data: Readonly<Awaited<ReturnType<OpenCodeClient["experimental"]["job"]["list"]>>>
  }>
  readonly cancel: OpenCodeClient["experimental"]["job"]["cancel"]
}
