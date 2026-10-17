import type { SessionV1 } from "@opencode-ai/schema/session-v1"

export type DisposeReason = typeof SessionV1.AbortDisposal.Type

const disposers = new Set<(directory: string) => Promise<void>>()
const observers = new Set<(directory: string, reason?: DisposeReason) => void>()

export function observeDisposal(observer: (directory: string, reason?: DisposeReason) => void) {
  observers.add(observer)
  return () => {
    observers.delete(observer)
  }
}

export function registerDisposer(disposer: (directory: string) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(directory: string, reason?: DisposeReason) {
  for (const observer of observers) observer(directory, reason)
  await Promise.allSettled([...disposers].map(async (disposer) => disposer(directory)))
}
