import { afterEach, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"
import { setViewerTimeZone } from "../../src/util/viewer-time-zone"

afterEach(() => {
  setViewerTimeZone(undefined)
})

test("todayTimeOrDateFirst shows only the time for today", () => {
  const now = Date.now()
  expect(Locale.todayTimeOrDateFirst(now)).toBe(Locale.time(now))
})

test("todayTimeOrDateFirst puts the date before the time on other days", () => {
  const yesterday = Date.now() - 86_400_000
  expect(Locale.todayTimeOrDateFirst(yesterday)).toBe(
    `${new Date(yesterday).toLocaleDateString()} ${Locale.time(yesterday)}`,
  )
})

test("a datetime_format pattern writes the date and time from its tokens", () => {
  const input = new Date(2026, 9, 7, 14, 5, 9).getTime()
  const format = { date: "YYYY-MM-DD", time: "HH:mm:ss" }
  expect(Locale.time(input, format)).toBe("14:05:09")
  expect(Locale.date(input, format)).toBe("2026-10-07")
  expect(Locale.todayTimeOrDateFirst(input, format)).toBe("2026-10-07 14:05:09")
  expect(Locale.todayTimeOrDateTime(input, format)).toBe("14:05:09 · 2026-10-07")
  expect(Locale.time(input, { time: "h:m:s a" })).toBe("2:5:9 pm")
  expect(Locale.time(input, { time: "hh[h]mm A" })).toBe("02h05 PM")
  expect(Locale.date(input, { date: "D.M.YY" })).toBe("7.10.26")
  expect(Locale.time(new Date(2026, 9, 7, 0, 30).getTime(), { time: "h:mm A" })).toBe("12:30 AM")
})

test("a datetime_format still shows only the time for today", () => {
  const now = Date.now()
  expect(Locale.todayTimeOrDateFirst(now, { date: "YYYY-MM-DD", time: "HH:mm:ss" })).toBe(
    Locale.time(now, { time: "HH:mm:ss" }),
  )
})

test("an unset datetime_format part keeps the locale output", () => {
  const yesterday = Date.now() - 86_400_000
  expect(Locale.todayTimeOrDateFirst(yesterday, {})).toBe(Locale.todayTimeOrDateFirst(yesterday))
  expect(Locale.time(yesterday, { date: "YYYY" })).toBe(
    new Date(yesterday).toLocaleTimeString(undefined, { timeStyle: "short" }),
  )
  expect(Locale.date(yesterday, { time: "HH" })).toBe(new Date(yesterday).toLocaleDateString())
})

test("a viewer zone writes the date and time tokens in that zone", () => {
  // 2026-10-11 22:01:28 UTC is 2026-10-12 03:46:28 in Kathmandu (+05:45).
  const input = Date.UTC(2026, 9, 11, 22, 1, 28)
  setViewerTimeZone("Asia/Kathmandu")
  expect(Locale.time(input, { time: "HH:mm:ss" })).toBe("03:46:28")
  expect(Locale.time(input, { time: "h:m:s a" })).toBe("3:46:28 am")
  expect(Locale.time(input, { time: "hh[h]mm A" })).toBe("03h46 AM")
  expect(Locale.date(input, { date: "YYYY-MM-DD" })).toBe("2026-10-12")
  expect(Locale.date(input, { date: "D.M.YY" })).toBe("12.10.26")
  setViewerTimeZone("America/Los_Angeles")
  expect(Locale.datetime(input, { date: "YYYY-MM-DD", time: "HH:mm A" })).toBe("15:01 PM · 2026-10-11")
  setViewerTimeZone("UTC")
  expect(Locale.time(Date.UTC(2026, 9, 7, 0, 30), { time: "h:mm A" })).toBe("12:30 AM")
})

test("a viewer zone keeps the locale output for unset datetime_format parts", () => {
  const input = Date.UTC(2026, 9, 11, 22, 1, 28)
  setViewerTimeZone("Asia/Tokyo")
  expect(Locale.time(input)).toBe(
    new Date(input).toLocaleTimeString(undefined, { timeStyle: "short", timeZone: "Asia/Tokyo" }),
  )
  expect(Locale.date(input)).toBe(new Date(input).toLocaleDateString(undefined, { timeZone: "Asia/Tokyo" }))
})

test("a stopwatch shows whole seconds while running", () => {
  expect(Locale.stopwatch(0)).toBe("0s")
  expect(Locale.stopwatch(999)).toBe("0s")
  expect(Locale.stopwatch(37_900)).toBe("37s")
  expect(Locale.stopwatch(125_400)).toBe("2m 5s")
  expect(Locale.stopwatch(-50)).toBe("0s")
})

test("a finished duration keeps one decimal up to 11 minutes", () => {
  expect(Locale.duration(4_830, true)).toBe("4.8s")
  expect(Locale.duration(125_370, true)).toBe("2m 5.3s")
  expect(Locale.duration(659_990, true)).toBe("10m 59.9s")
  expect(Locale.duration(660_000, true)).toBe("11m 0s")
  expect(Locale.duration(125_370)).toBe("2m 5s")
})
