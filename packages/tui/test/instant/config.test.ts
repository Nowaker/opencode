import { expect, test } from "bun:test"
import path from "path"
import { InstantConfig } from "../../src/instant/config"
import { tmpdir } from "../fixture/fixture"

const read = async (config: unknown) => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "tui.json"), JSON.stringify(config))
  return InstantConfig.read({ OPENCODE_CONFIG_DIR: tmp.path })
}

test("the instant screen reads prompt sizes, percentages and the home screen layout", async () => {
  const settings = await read({
    prompt: { min_height: "25%", max_height: "100%", max_width: "80%" },
    home: { logo: false, tips: false, prompt_position: "top" },
  })
  expect(settings).toMatchObject({
    promptMinHeight: "25%",
    promptMaxHeight: "100%",
    promptMaxWidth: "80%",
    homeLogo: false,
    homeTips: false,
    homePromptPosition: "top",
  })
})

test("the instant screen ignores sizes and positions tui.json would reject", async () => {
  const settings = await read({
    prompt: { min_height: "0%", max_height: "150%", max_width: 0 },
    home: { logo: "no", tips: "no", prompt_position: "left" },
  })
  expect(settings).toMatchObject({
    promptMinHeight: undefined,
    promptMaxHeight: undefined,
    promptMaxWidth: undefined,
    homeLogo: true,
    homeTips: undefined,
    homePromptPosition: "middle",
  })
})
