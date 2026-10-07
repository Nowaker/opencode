import { describe, expect, test } from "bun:test"
import fs from "fs"
import { InstantPrompt } from "../../src/instant"

const here = fs.realpathSync(process.cwd())

describe("instant prompt command line", () => {
  test("plain opencode opens the home screen", () => {
    expect(InstantPrompt.classify([])).toEqual({ mode: "tui", sessionID: undefined, directory: here })
  })

  test("-s and --session open that session, -c the latest one", () => {
    expect(InstantPrompt.classify(["-s", "ses_a"])).toMatchObject({ mode: "session", sessionID: "ses_a" })
    expect(InstantPrompt.classify(["--session=ses_b"])).toMatchObject({ mode: "session", sessionID: "ses_b" })
    expect(InstantPrompt.classify(["-c"])).toMatchObject({ mode: "session", sessionID: undefined })
  })

  test("--mini keeps the invisible capture", () => {
    expect(InstantPrompt.classify(["--mini", "-c"])).toMatchObject({ mode: "mini" })
  })

  test("forks, --prompt, help and subcommands start without it", () => {
    expect(InstantPrompt.classify(["-c", "--fork"])).toBeUndefined()
    expect(InstantPrompt.classify(["--prompt", "hi"])).toBeUndefined()
    expect(InstantPrompt.classify(["--help"])).toBeUndefined()
    expect(InstantPrompt.classify(["models"])).toBeUndefined()
  })

  test("a value flag's argument is not taken for a project directory", () => {
    expect(InstantPrompt.classify(["-m", "provider/model"])).toMatchObject({ mode: "tui", directory: here })
  })
})
