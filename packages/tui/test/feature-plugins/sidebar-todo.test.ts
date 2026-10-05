import { describe, expect, test } from "bun:test"
import { todoSummary } from "../../src/feature-plugins/sidebar/todo"

const todos = (...statuses: string[]) => statuses.map((status) => ({ status }))

describe("sidebar todo summary", () => {
  test("progress counts completed, in progress and total", () => {
    expect(todoSummary(todos("completed", "completed", "in_progress", "pending"), "progress")).toBe("2+1/4")
  })

  test("progress drops the in-progress part when nothing is in progress", () => {
    expect(todoSummary(todos("completed", "pending", "cancelled"), "progress")).toBe("1/3")
  })

  test("icons count each status and skip zeros", () => {
    expect(todoSummary(todos("completed", "in_progress", "pending", "pending"), "icons")).toBe("✓1 •1 ○2")
    expect(todoSummary(todos("pending", "cancelled"), "icons")).toBe("○1")
  })
})
