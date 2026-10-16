import { afterEach, expect, test } from "bun:test"
import { RGBA, SyntaxStyle, type SimpleHighlight, type TextChunk } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import { collapseOutput, fileOutputChunks, StyledOutput } from "../../../src/routes/session"
import { bashOutputModel } from "../../../src/util/file-output"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

const text = RGBA.fromHex("#eeeeee")
const muted = RGBA.fromHex("#808080")
const keyword = RGBA.fromHex("#9d7cd8")
const syntax = SyntaxStyle.fromStyles({ keyword: { fg: keyword } })

const output = Array.from(
  { length: 12 },
  (_, index) =>
    `packages/tui/src/routes/session/index.tsx:${index + 1}:const value${index} = createMemo(() => props.something.rather.long.indeed)`,
).join("\n")
const model = bashOutputModel("rg -n createMemo packages/tui", output)!
// `const` colored in every line's code, as the TypeScript highlighter would.
const lines: SimpleHighlight[][] = model.lines.map(() => [[0, 5, "keyword"]])

const joined = (chunks: TextChunk[]) => chunks.map((chunk) => chunk.text).join("")
const colorOf = (chunks: TextChunk[], piece: string) => chunks.find((chunk) => chunk.text === piece)?.fg

async function frame(width: number, node: () => JSX.Element) {
  setup?.renderer.destroy()
  setup = await testRender(() => <box paddingLeft={3}>{node()}</box>, { width, height: 60 })
  await setup.renderOnce()
  return setup.captureCharFrame()
}

for (const width of [40, 80, 160]) {
  test(`grep output colored by file wraps exactly like the plain text at ${width} columns`, async () => {
    const chunks = fileOutputChunks(model, output, lines, { text, muted }, syntax)
    expect(joined(chunks)).toBe(output)
    const plain = await frame(width, () => <text fg={text}>{output}</text>)
    const colored = await frame(width, () => <StyledOutput content={output} chunks={chunks} fg={text} />)
    expect(colored).toBe(plain)
  })

  test(`a head and tail preview is colored like the whole output at ${width} columns`, async () => {
    const shown = collapseOutput(output, 5, width, true, 2).output
    expect(shown).toContain("(8 more lines)")
    const chunks = fileOutputChunks(model, shown, lines, { text, muted }, syntax)
    expect(joined(chunks)).toBe(shown)
    // A narrow preview cuts each line to its share of the width, so some `const`s are cut away.
    const consts = shown.split("\n").filter((line) => line.includes(":const ") || line.startsWith("const ")).length
    expect(chunks.filter((chunk) => chunk.text === "const").length).toBe(consts)
    if (width === 160) expect(consts).toBe(4)
    expect(chunks.filter((chunk) => chunk.text === "const").every((chunk) => chunk.fg === keyword)).toBe(true)
    expect(colorOf(chunks, "(8 more lines)")).toEqual(text)
    expect(chunks.filter((chunk) => chunk.text.startsWith("packages/tui/")).every((chunk) => chunk.fg === muted)).toBe(
      true,
    )
    const plain = await frame(width, () => <text fg={text}>{shown}</text>)
    expect(await frame(width, () => <StyledOutput content={shown} chunks={chunks} fg={text} />)).toBe(plain)
  })
}

test("mutes the prefix at once and draws the code plain until its highlights arrive", () => {
  const chunks = fileOutputChunks(model, output, [], { text, muted }, syntax)
  expect(chunks[0]).toMatchObject({ text: "packages/tui/src/routes/session/index.tsx:1:", fg: muted })
  expect(chunks[1]).toMatchObject({ text: model.lines[0].slice(chunks[0].text.length), fg: text })
})
