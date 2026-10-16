export interface PendingTransport {
  readonly directory: string
  readonly transport: { close(): Promise<void> }
}

export async function releaseDirectory<Entry extends PendingTransport>(pending: Map<string, Entry>, directory: string) {
  await Promise.allSettled(
    [...pending.entries()]
      .filter(([, entry]) => entry.directory === directory)
      .map(async ([name, entry]) => {
        if (pending.get(name) === entry) pending.delete(name)
        await entry.transport.close()
      }),
  )
}

export * as McpPendingAuth from "./pending-auth"
