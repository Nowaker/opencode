import { createSignal } from "solid-js"

// The IANA zone the person viewing this TUI lives in, when it differs from the process zone (a
// TUI attached to a server on another machine). Undefined means the process zone.
const [zone, setZone] = createSignal<string>()
// The value the stored zone was resolved from, so a heartbeat repeating it builds no formatter.
let accepted: string | undefined

export const viewerTimeZone = zone

// Slash-separated IANA name parts (`UTC`, `Etc/GMT+5`, `America/Argentina/Buenos_Aires`). Intl
// also takes a UTC offset such as `+05:45`, which is not a zone: it has no DST rules.
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)*$/

// Applies a zone reported by the viewer. `undefined` or `null` clears it back to the process
// zone; anything that is not an IANA zone name Intl knows keeps the previous one. Returns whether
// it applied.
export function setViewerTimeZone(value: unknown) {
  if (value === undefined || value === null) {
    accepted = undefined
    setZone(undefined)
    return true
  }
  if (typeof value !== "string" || value.length > 64 || !ZONE_NAME.test(value)) return false
  if (value === accepted) return true
  const canonical = resolve(value)
  if (!canonical) return false
  accepted = value
  setZone(canonical)
  return true
}

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number }

// The calendar date and time an instant shows on a clock in `zone`, or in the process zone.
export function wallClock(input: number, zone: string | undefined): WallClock {
  if (!zone) {
    const date = new Date(input)
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    }
  }
  const parts = zoneFormat(zone).parts.formatToParts(input)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  }
}

let formats:
  | { zone: string; parts: Intl.DateTimeFormat; time: Intl.DateTimeFormat; date: Intl.DateTimeFormat }
  | undefined

// Formatters for the viewer zone. Building one is far slower than using it, so they are kept for
// the zone last asked for and rebuilt only when it changes: one set, whatever the zone history.
export function zoneFormat(zone: string) {
  if (formats?.zone === zone) return formats
  formats = {
    zone,
    parts: new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }),
    time: new Intl.DateTimeFormat(undefined, { timeZone: zone, timeStyle: "short" }),
    date: new Intl.DateTimeFormat(undefined, { timeZone: zone }),
  }
  return formats
}

function resolve(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone
  } catch (error) {
    if (error instanceof RangeError) return undefined
    throw error
  }
}
