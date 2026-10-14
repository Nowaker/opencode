import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import { ClippedRows, CommandSpans } from "../../../src/routes/session"
import { heredocs } from "../../../src/util/heredoc"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

const command =
  "cp ./tmp/op13-keyguard-check.png /home/nowaker/projekty/modern/worldmodern/.vibeterm/tmp/./tmp/op13-keyguard-check.png /home/nowaker/projekty/modern/worldmodern/.vibeterm/tmp/opencode/op13-keyguard-check.png 2>&1"
const text = RGBA.fromHex("#eeeeee")

async function frame(width: number, node: () => JSX.Element, height = 12) {
  setup?.renderer.destroy()
  setup = await testRender(() => <box paddingLeft={3}>{node()}</box>, { width, height })
  await setup.renderOnce()
  return setup.captureCharFrame()
}

// Every token its own span, the way the highlighter splits a command.
function segments() {
  return command.split(/(\s+)/).map((token, index) => ({
    text: token,
    fg: RGBA.fromHex(index % 4 === 0 ? "#61afef" : "#7fd88f"),
  }))
}

for (const width of [40, 80, 160]) {
  test(`a colored command wraps exactly like the plain one at ${width} columns`, async () => {
    const plain = await frame(width, () => <text fg={text}>$ {command}</text>)
    const colored = await frame(width, () => (
      <text fg={text}>
        $ <CommandSpans segments={segments()} />
      </text>
    ))
    expect(colored).toBe(plain)
    expect(plain).toContain("$ cp ./tmp/op13-keyguard-check.png")
  })
}

const units = [
  "mkdir -p templates/linux && cd templates/linux && cat > second-brain-work.slice <<'EOF'",
  "# Shared CPU budget for Second Brain capture and indexing",
  "[Unit]",
  "Description=Shared CPU budget for Second Brain capture and indexing",
  "",
  "[Slice]",
  "CPUQuota=100%",
  "CPUWeight=10",
  "EOF",
  "cat > second-brain-archive.service <<'EOF'",
  "[Service]",
  "Slice=second-brain-work.slice",
  "ExecStart=/usr/bin/second-brain archive --all",
  "EOF",
].join("\n")

// The command split where each heredoc body starts and ends, bodies in one color and the rest in
// another, the way the heredoc highlights land on the command.
function unitSegments() {
  const bounds = heredocs(units).flatMap((heredoc) => [heredoc.start, heredoc.end])
  return [0, ...bounds].map((start, index, all) => ({
    text: units.slice(start, all[index + 1] ?? units.length),
    fg: RGBA.fromHex(index % 2 === 1 ? "#fab283" : "#7fd88f"),
  }))
}

for (const width of [40, 80, 160]) {
  test(`a command with two unit heredocs wraps exactly like the plain one at ${width} columns`, async () => {
    expect(heredocs(units).map((heredoc) => heredoc.language)).toEqual(["ini", "ini"])
    const plain = await frame(width, () => <text fg={text}>$ {units}</text>, 60)
    const colored = await frame(
      width,
      () => (
        <text fg={text}>
          $ <CommandSpans segments={unitSegments()} />
        </text>
      ),
      60,
    )
    expect(colored).toBe(plain)
    expect(plain).toContain("CPUQuota=100%")
  })
}

for (const width of [40, 80, 160]) {
  test(`a command clipped to 2 rows shows the first 2 rows it wraps to at ${width} columns`, async () => {
    const whole = () => (
      <text fg={text}>
        $ <CommandSpans segments={unitSegments()} />
      </text>
    )
    const full = (await frame(width, whole, 60))
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
    let clipped = false
    const cut = (
      await frame(
        width,
        () => (
          <box>
            <ClippedRows limit={2} expanded={false} onClip={(value) => (clipped = value)}>
              {whole()}
            </ClippedRows>
            <text>after</text>
          </box>
        ),
        60,
      )
    )
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
    expect(cut).toEqual([...full.slice(0, 2), "   after"])
    expect(clipped).toBe(true)
  })
}
