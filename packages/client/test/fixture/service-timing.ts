import { withEnsureTiming } from "../../src/service-timing"

const timing = {
  pollInterval: 20,
  requestTimeout: 100,
  spawnDelay: 200,
  maxSpawnDelay: 1_200,
  promiseTimeout: 3_000,
  stopPollInterval: 5,
}

export function accelerate<A extends object, B>(ensure: (options?: A) => B) {
  return (options: A) => ensure(withEnsureTiming(options, timing))
}

// For tests of how ensure classifies an owner's answer: no probe deadline or contender grace may
// expire before ensure's own budget, so a loaded host cannot turn a slow answer into an absent owner
// and a spawn. A stall past the whole budget fails with ensure's own timeout error, never by spawning.
export function awaitAnswer<A extends object, B>(ensure: (options?: A) => B) {
  return (options: A) =>
    ensure(
      withEnsureTiming(options, {
        ...timing,
        requestTimeout: timing.promiseTimeout,
        spawnDelay: 2 * timing.promiseTimeout,
      }),
    )
}

export async function waitForExit(pid: number) {
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await Bun.sleep(5)
  }
  throw new Error(`Timed out waiting for process ${pid}`)
}
