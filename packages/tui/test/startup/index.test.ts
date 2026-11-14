import { expect, test } from "bun:test"
import { StartupInput } from "../../src/startup/index"

const cwd = import.meta.dir

test.each([
  { argv: [], route: "home", prompt: undefined },
  { argv: ["."], route: "home", prompt: undefined },
  { argv: ["--prompt", "hi", "--auto"], route: "home", prompt: "hi" },
  { argv: ["--prompt=hi there"], route: "home", prompt: "hi there" },
  { argv: ["-c"], route: "session", prompt: undefined },
  { argv: ["--session", "ses_1", "--prompt", "go"], route: "session", prompt: "go" },
  { argv: ["-s", "ses_1", "--server", "http://127.0.0.1:1"], route: "session", prompt: undefined },
])("the default TUI starts its early input for $argv", (input) => {
  expect(StartupInput.classify(input.argv, cwd)).toEqual({ route: input.route, prompt: input.prompt })
})

test.each([
  { argv: ["--help"] },
  { argv: ["-h"] },
  { argv: ["--version"] },
  { argv: ["run", "hello"] },
  { argv: ["serve"] },
  { argv: ["debug", "paths"] },
  { argv: ["--no-such-flag"] },
  { argv: ["--prompt"] },
  { argv: ["--session", "a", "--session", "b"] },
  { argv: ["no-such-directory"] },
  { argv: [".", ".."] },
])("$argv does not take the terminal early", (input) => {
  expect(StartupInput.classify(input.argv, cwd)).toBeUndefined()
})
