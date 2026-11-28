import { createSignal } from "solid-js"
import { viewerTimeZone, wallClock } from "./viewer-time-zone"

// The viewer's calendar day as a signal. A computation that reads it re-runs when the day changes,
// so a "today" decision (time only, or date and time) flips at 00:00 with nothing else
// re-rendering. One timeout serves every reader. It is armed on the first read and fires just
// after the next midnight in the viewer zone, or after `maxWait` if that comes first, so a suspend
// or a clock or process timezone change is caught within the hour; each firing re-arms it. A read
// after the viewer zone changed re-arms it for that zone's midnight.
export function createDayClock(maxWait = 3_600_000) {
  const key = (zone: string | undefined) => {
    const clock = wallClock(Date.now(), zone)
    return `${clock.year}-${clock.month}-${clock.day}`
  }
  const [day, setDay] = createSignal(0)
  let armedZone: string | undefined
  let current = key(armedZone)
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = () => {
    const now = Date.now()
    timer = setTimeout(
      () => {
        if (key(armedZone) !== current) {
          current = key(armedZone)
          setDay((value) => value + 1)
        }
        arm()
      },
      Math.min(maxWait, nextMidnight(now, armedZone) - now + 50),
    )
    timer.unref?.()
  }

  return {
    read() {
      const zone = viewerTimeZone()
      if (!timer || zone !== armedZone) {
        clearTimeout(timer)
        armedZone = zone
        current = key(armedZone)
        arm()
      }
      return day()
    },
    armed: () => timer !== undefined,
    stop() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}

export const localDay = createDayClock()

// The first instant of the next calendar day in `zone`, always after `now`. A zone's day is not
// always 24 hours, its offset may change before midnight, and DST may skip midnight altogether
// (Santiago goes from 23:59:59 to 01:00), so the instant comes from the offset in effect at the
// candidate itself, falling back to the offset at `now` when that candidate lands before `now`.
function nextMidnight(now: number, zone: string | undefined) {
  const clock = wallClock(now, zone)
  if (!zone) return new Date(clock.year, clock.month - 1, clock.day + 1).getTime()
  const midnight = Date.UTC(clock.year, clock.month - 1, clock.day + 1)
  const first = midnight - offset(now, zone)
  const second = midnight - offset(first, zone)
  return second > now ? second : first
}

function offset(instant: number, zone: string) {
  const clock = wallClock(instant, zone)
  const wall = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second)
  return wall - Math.floor(instant / 1000) * 1000
}
