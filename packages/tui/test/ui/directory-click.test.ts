import { expect, test } from "bun:test"
import { createDirectoryClick } from "../../src/ui/directory-click"

test("a directory click no handler takes is left to opencode, which copies it", () => {
  const directories = createDirectoryClick()
  const event = { directory: "/work/app", location: "home_footer" as const }
  expect(directories.run(event)).toBe(false)
  const seen: string[] = []
  directories.on((clicked) => void seen.push(clicked.directory))
  expect(directories.run(event)).toBe(false)
  const off = directories.on(() => true)
  expect(directories.run(event)).toBe(true)
  expect(seen).toEqual(["/work/app"])
  off()
  expect(directories.run(event)).toBe(false)
})
