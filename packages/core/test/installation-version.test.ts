import { describe, expect, test } from "bun:test"
import { baseVersion } from "../src/installation/version"

describe("baseVersion", () => {
  test("strips the fork build suffix", () => {
    expect(baseVersion("1.18.32-vt-48-2406400f0a")).toBe("1.18.32")
  })

  test("leaves releases, previews and local builds alone", () => {
    expect(baseVersion("1.18.32")).toBe("1.18.32")
    expect(baseVersion("0.0.0-dev-202609292200")).toBe("0.0.0-dev-202609292200")
    expect(baseVersion("local")).toBe("local")
  })

  test("only strips a well-formed suffix", () => {
    expect(baseVersion("1.18.32-vt-48-2406400f0")).toBe("1.18.32-vt-48-2406400f0")
    expect(baseVersion("1.18.32-vt-x-2406400f0a")).toBe("1.18.32-vt-x-2406400f0a")
  })
})
