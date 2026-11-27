/** @jsxImportSource @opentui/solid */
import { afterEach, expect, jest, setSystemTime, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createMemo, createRoot } from "solid-js"
import { formatToolTimestamp, InlineToolRow } from "../../src/routes/session"
import { localDay } from "../../src/util/day"
import { Locale } from "../../src/util/locale"
import { setViewerTimeZone } from "../../src/util/viewer-time-zone"

const format = { date: "YYYY-MM-DD", time: "HH:mm:ss" }
const end = new Date(2026, 9, 11, 22, 1, 28).getTime()
const state = {
  status: "completed" as const,
  input: {},
  output: "",
  title: "",
  metadata: {},
  time: { start: end - 464, end },
}
let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
  localDay.stop()
  setViewerTimeZone(undefined)
  jest.useRealTimers()
  setSystemTime()
})

async function frame() {
  await setup!.renderOnce()
  return setup!.captureCharFrame()
}

test("a footer rendered before midnight shows the date once the day changes, with no other trigger", async () => {
  localDay.stop()
  jest.useFakeTimers()
  setSystemTime(new Date(2026, 9, 11, 23, 59, 58))
  setup = await testRender(
    () => (
      <InlineToolRow
        icon="⚙"
        complete={true}
        pending=""
        timestamp={formatToolTimestamp(state, { time: true, duration: true, format })}
      >
        vtps
      </InlineToolRow>
    ),
    { width: 60, height: 2 },
  )
  expect(await frame()).toContain("⚙ vtps · 22:01:28 · 464ms")
  jest.advanceTimersByTime(3_000)
  expect(await frame()).toContain("⚙ vtps · 2026-10-11 22:01:28 · 464ms")
})

test("every reader shares one day timer, re-armed after each firing", () => {
  localDay.stop()
  jest.useFakeTimers()
  setSystemTime(new Date(2026, 9, 11, 23, 0, 0))
  const before = jest.getTimerCount()
  const runs: number[] = []
  const dispose = createRoot((dispose) => {
    for (const index of Array.from({ length: 30 }, (_, index) => index))
      createMemo(() => {
        runs[index] = (runs[index] ?? 0) + 1
        return Locale.todayTimeOrDateFirst(end, format)
      })
    return dispose
  })
  expect(jest.getTimerCount() - before).toBe(1)
  jest.advanceTimersByTime(3_600_000)
  expect(jest.getTimerCount() - before).toBe(1)
  jest.advanceTimersByTime(3_600_000)
  expect(jest.getTimerCount() - before).toBe(1)
  expect(runs).toEqual(Array.from({ length: 30 }, () => 2))
  dispose()
})

async function renderToolRow(end: number) {
  const row = { ...state, time: { start: end - 464, end } }
  setup = await testRender(
    () => (
      <InlineToolRow
        icon="⚙"
        complete={true}
        pending=""
        timestamp={formatToolTimestamp(row, { time: true, duration: true, format })}
      >
        vtps
      </InlineToolRow>
    ),
    { width: 60, height: 2 },
  )
}

// Starts at `now` with fake timers; zone set before the first render arms the day timer.
async function zonedRow(zone: string, now: number, end: number) {
  localDay.stop()
  jest.useFakeTimers()
  setSystemTime(new Date(now))
  setViewerTimeZone(zone)
  await renderToolRow(end)
}

test("a mounted row follows viewer zone switches, on the same day and across a date", async () => {
  const end = Date.UTC(2026, 9, 11, 18, 1, 28)
  await zonedRow("UTC", Date.UTC(2026, 9, 11, 23, 30), end)
  expect(await frame()).toContain("⚙ vtps · 18:01:28 · 464ms")
  setViewerTimeZone("Asia/Tokyo")
  expect(await frame()).toContain("⚙ vtps · 03:01:28 · 464ms")
  setViewerTimeZone("Asia/Kolkata")
  expect(await frame()).toContain("⚙ vtps · 2026-10-11 23:31:28 · 464ms")
  setViewerTimeZone("Mars/Olympus")
  expect(await frame()).toContain("⚙ vtps · 2026-10-11 23:31:28 · 464ms")
  setViewerTimeZone(null)
  const local = new Date(end)
  const pad = (value: number) => String(value).padStart(2, "0")
  const clock = `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`
  const day = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`
  expect(await frame()).toContain(
    `⚙ vtps · ${local.toDateString() === new Date().toDateString() ? clock : `${day} ${clock}`} · 464ms`,
  )
})

test("a zoned row shows the date after midnight in a fractional-offset zone", async () => {
  // 23:59:58 in Kathmandu (+05:45); the tool finished at 21:45:00 there.
  await zonedRow("Asia/Kathmandu", Date.UTC(2026, 9, 11, 18, 14, 58), Date.UTC(2026, 9, 11, 16))
  expect(await frame()).toContain("⚙ vtps · 21:45:00 · 464ms")
  jest.advanceTimersByTime(3_000)
  expect(await frame()).toContain("⚙ vtps · 2026-10-11 21:45:00 · 464ms")
})

test("a zoned row shows the date at midnight after a 23-hour DST day", async () => {
  // New York sprang forward at 02:00 on 2026-03-08; 23:59:58 EDT is 03:59:58 UTC.
  await zonedRow("America/New_York", Date.UTC(2026, 2, 9, 3, 59, 58), Date.UTC(2026, 2, 8, 6, 30))
  expect(await frame()).toContain("⚙ vtps · 01:30:00 · 464ms")
  jest.advanceTimersByTime(3_000)
  expect(await frame()).toContain("⚙ vtps · 2026-03-08 01:30:00 · 464ms")
})

test("a zoned row shows the date when DST skips the zone's midnight", async () => {
  // Santiago jumps from 2026-09-05 23:59:59 -04 to 2026-09-06 01:00 -03; 00:00 never happens.
  await zonedRow("America/Santiago", Date.UTC(2026, 8, 6, 3, 59, 58), Date.UTC(2026, 8, 5, 20))
  expect(await frame()).toContain("⚙ vtps · 16:00:00 · 464ms")
  jest.advanceTimersByTime(3_000)
  expect(await frame()).toContain("⚙ vtps · 2026-09-05 16:00:00 · 464ms")
})

test("a zone switch re-arms the day timer for the new zone's midnight", async () => {
  // At 18:00 UTC the next UTC midnight is 6h away, Kolkata's (+05:30) is 30 minutes away.
  await zonedRow("UTC", Date.UTC(2026, 9, 11, 18), Date.UTC(2026, 9, 11, 17))
  expect(await frame()).toContain("⚙ vtps · 17:00:00 · 464ms")
  setViewerTimeZone("Asia/Kolkata")
  expect(await frame()).toContain("⚙ vtps · 22:30:00 · 464ms")
  jest.advanceTimersByTime(30 * 60_000 + 1_000)
  expect(await frame()).toContain("⚙ vtps · 2026-10-11 22:30:00 · 464ms")
})

test("zone switches and a skipped midnight keep one day timer for every reader", () => {
  localDay.stop()
  jest.useFakeTimers()
  setSystemTime(new Date(Date.UTC(2026, 8, 6, 3, 59, 58)))
  setViewerTimeZone("America/Santiago")
  const before = jest.getTimerCount()
  const runs: number[] = []
  const dispose = createRoot((dispose) => {
    for (const index of Array.from({ length: 30 }, (_, index) => index))
      createMemo(() => {
        runs[index] = (runs[index] ?? 0) + 1
        return Locale.todayTimeOrDateFirst(end, format)
      })
    return dispose
  })
  expect(jest.getTimerCount() - before).toBe(1)
  jest.advanceTimersByTime(3_000)
  expect(jest.getTimerCount() - before).toBe(1)
  setViewerTimeZone("Asia/Kathmandu")
  expect(jest.getTimerCount() - before).toBe(1)
  setViewerTimeZone(null)
  expect(jest.getTimerCount() - before).toBe(1)
  expect(runs).toEqual(Array.from({ length: 30 }, () => 4))
  dispose()
})
