import { localDay } from "./day"
import { viewerTimeZone, wallClock, zoneFormat, type WallClock } from "./viewer-time-zone"

export function titlecase(str: string) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

// Patterns from tui.json `datetime_format`. Unset parts keep the runtime locale's output.
export type DateTimeFormat = { date?: string; time?: string }

// Times and dates show on the viewer's clock (`viewerTimeZone`), else the process zone, and a
// computation that formats one re-runs when the viewer zone changes.
export function time(input: number, format?: DateTimeFormat): string {
  const zone = viewerTimeZone()
  if (format?.time) return pattern(wallClock(input, zone), format.time)
  if (zone) return zoneFormat(zone).time.format(input)
  const date = new Date(input)
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export function date(input: number, format?: DateTimeFormat): string {
  const zone = viewerTimeZone()
  if (format?.date) return pattern(wallClock(input, zone), format.date)
  if (zone) return zoneFormat(zone).date.format(input)
  return new Date(input).toLocaleDateString()
}

export function datetime(input: number, format?: DateTimeFormat): string {
  return `${time(input, format)} · ${date(input, format)}`
}

export function todayTimeOrDateTime(input: number, format?: DateTimeFormat): string {
  if (isToday(input)) {
    return time(input, format)
  } else {
    return datetime(input, format)
  }
}

export function todayTimeOrDateFirst(input: number, format?: DateTimeFormat): string {
  if (isToday(input)) return time(input, format)
  return `${date(input, format)} ${time(input, format)}`
}

// Day.js tokens: MM is the month and mm the minute; text in [brackets] is printed as is.
const PATTERN_TOKENS = /\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|A|a/g

function pattern(clock: WallClock, format: string) {
  const pad = (value: number) => String(value).padStart(2, "0")
  const hour12 = clock.hour % 12 || 12
  const meridiem = clock.hour < 12 ? "AM" : "PM"
  const values: Record<string, string> = {
    YYYY: String(clock.year),
    YY: pad(clock.year % 100),
    MM: pad(clock.month),
    M: String(clock.month),
    DD: pad(clock.day),
    D: String(clock.day),
    HH: pad(clock.hour),
    H: String(clock.hour),
    hh: pad(hour12),
    h: String(hour12),
    mm: pad(clock.minute),
    m: String(clock.minute),
    ss: pad(clock.second),
    s: String(clock.second),
    A: meridiem,
    a: meridiem.toLowerCase(),
  }
  return format.replace(PATTERN_TOKENS, (token, literal: string | undefined) => literal ?? values[token])
}

// Subscribes the calling computation to the viewer's day, so it re-runs at the viewer's midnight.
function isToday(input: number) {
  localDay.read()
  const zone = viewerTimeZone()
  const date = wallClock(input, zone)
  const now = wallClock(Date.now(), zone)
  return date.year === now.year && date.month === now.month && date.day === now.day
}

export function number(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

// `tenths` keeps the tenth of a second past the first minute, up to 11 minutes: `2m 5.3s`.
export function duration(input: number, tenths = false) {
  if (input < 1000) {
    return `${input}ms`
  }
  if (input < 60000) {
    return `${(input / 1000).toFixed(1)}s`
  }
  if (tenths && input < 660000) {
    const minutes = Math.floor(input / 60000)
    return `${minutes}m ${(Math.floor((input % 60000) / 100) / 10).toFixed(1)}s`
  }
  if (input < 3600000) {
    const minutes = Math.floor(input / 60000)
    const seconds = Math.floor((input % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }
  if (input < 86400000) {
    const hours = Math.floor(input / 3600000)
    const minutes = Math.floor((input % 3600000) / 60000)
    return `${hours}h ${minutes}m`
  }
  const days = Math.floor(input / 86400000)
  const hours = Math.floor((input % 86400000) / 3600000)
  return `${days}d ${hours}h`
}

// Elapsed time of something still running, in whole seconds: `0s`, `37s`, `2m 5s`.
export function stopwatch(input: number) {
  if (input < 60000) return `${Math.floor(Math.max(0, input) / 1000)}s`
  return duration(input)
}

export function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 1) + "…"
}

export function truncateLeft(str: string, len: number): string {
  if (str.length <= len) return str
  return "…" + str.slice(-(len - 1))
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  if (str.length <= maxLength) return str

  const ellipsis = "…"
  const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
  const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)

  return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd)
}

export function pluralize(count: number, singular: string, plural: string): string {
  const template = count === 1 ? singular : plural
  return template.replace("{}", count.toString())
}

export * as Locale from "./locale"
