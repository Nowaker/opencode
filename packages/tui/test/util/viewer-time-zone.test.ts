import { afterEach, expect, test } from "bun:test"
import { setViewerTimeZone, viewerTimeZone } from "../../src/util/viewer-time-zone"

afterEach(() => {
  setViewerTimeZone(undefined)
})

test("a valid zone is applied under its canonical name", () => {
  expect(viewerTimeZone()).toBeUndefined()
  expect(setViewerTimeZone("Asia/Kathmandu")).toBe(true)
  expect(viewerTimeZone()).toBe("Asia/Kathmandu")
  expect(setViewerTimeZone("utc")).toBe(true)
  expect(viewerTimeZone()).toBe("UTC")
})

test("an invalid value leaves the previous zone in place", () => {
  setViewerTimeZone("Asia/Tokyo")
  for (const value of ["Mars/Olympus", "", 42, {}, true]) expect(setViewerTimeZone(value)).toBe(false)
  expect(viewerTimeZone()).toBe("Asia/Tokyo")
})

test("aliases and multi-part zone names are accepted", () => {
  for (const value of [
    "GMT",
    "UTC",
    "Etc/GMT+5",
    "Etc/UTC",
    "America/Argentina/Buenos_Aires",
    "America/Port-au-Prince",
  ]) {
    expect(setViewerTimeZone(value)).toBe(true)
    expect(viewerTimeZone()).toBe(value)
  }
})

test("an offset or an overlong value is not a zone name", () => {
  setViewerTimeZone("Asia/Tokyo")
  for (const value of ["+05:45", "-03:00", "+0545", "05:45", "Asia/../Tokyo", "Asia//Tokyo", `Asia/${"A".repeat(64)}`])
    expect(setViewerTimeZone(value)).toBe(false)
  expect(viewerTimeZone()).toBe("Asia/Tokyo")
})

test("a repeated value keeps the stored zone", () => {
  expect(setViewerTimeZone("utc")).toBe(true)
  expect(setViewerTimeZone("utc")).toBe(true)
  expect(viewerTimeZone()).toBe("UTC")
  expect(setViewerTimeZone("UTC")).toBe(true)
  expect(viewerTimeZone()).toBe("UTC")
})

test("undefined or null clears back to the process zone", () => {
  setViewerTimeZone("Asia/Tokyo")
  expect(setViewerTimeZone(null)).toBe(true)
  expect(viewerTimeZone()).toBeUndefined()
  setViewerTimeZone("Asia/Tokyo")
  expect(setViewerTimeZone(undefined)).toBe(true)
  expect(viewerTimeZone()).toBeUndefined()
})
