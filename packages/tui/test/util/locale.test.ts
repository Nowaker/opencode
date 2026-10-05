import { expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

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
