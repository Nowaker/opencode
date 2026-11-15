import type { Composer, ComposerObservation } from "@opencode/plugin/tui/composer"
import {
  createComputed,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  type Owner,
} from "solid-js"
import type { Dispose } from "./api"
import { isDeepEqual } from "remeda"

export function createComposerApi(
  read: () => ComposerObservation,
  lifetime: { readonly owner: Owner | null; readonly owned: Dispose[] },
): Composer {
  const [active, setActive] = createSignal(true)
  const subscriptions = new Set<() => void>()
  const shutdown = () => {
    if (!active()) return
    subscriptions.forEach((dispose) => dispose())
    setActive(false)
  }
  lifetime.owned.push(async () => shutdown())
  if (lifetime.owner) runWithOwner(lifetime.owner, () => onCleanup(shutdown))
  const current = (): ComposerObservation => (active() ? read() : { status: "unavailable", reason: "disposed" })
  return {
    current,
    subscribe(listener) {
      if (!active()) {
        listener(current())
        return () => {}
      }
      const caller = getOwner()
      return createRoot((dispose) => {
        subscriptions.add(dispose)
        onCleanup(() => subscriptions.delete(dispose))
        if (caller) runWithOwner(caller, () => onCleanup(dispose))
        let previous: ComposerObservation | undefined
        createComputed(() => {
          const observation = current()
          if (isDeepEqual(previous, observation)) return
          previous = observation
          untrack(() => listener(observation))
        })
        return dispose
      }, caller ?? lifetime.owner)
    },
  }
}
