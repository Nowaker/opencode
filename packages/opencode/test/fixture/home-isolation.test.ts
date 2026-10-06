import { expect, mock, test } from "bun:test"
import { homedir } from "node:os"
import os from "os"

const testHome = process.env.OPENCODE_TEST_HOME
if (!testHome) throw new Error("home-isolation tests require OPENCODE_TEST_HOME from the preload")

test("direct home-directory consumers stay inside the test fixture", () => {
  expect(homedir()).toBe(testHome)
  expect(os.homedir()).toBe(testHome)
})

test("mock cleanup does not release the test home-directory boundary", () => {
  mock.restore()
  expect(homedir()).toBe(testHome)
  expect(os.homedir()).toBe(testHome)
})
