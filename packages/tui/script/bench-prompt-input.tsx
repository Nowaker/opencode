/** @jsxImportSource @opentui/solid */
// Measures per-keystroke latency of the prompt editor as the buffer grows.
//
// The prompt installs an `onContentChange` handler (src/component/prompt/index.tsx)
// that reads the whole buffer out of the native rope and hands it to the autocomplete
// trigger scan on every keystroke. This drives a real TextareaRenderable through real
// key events with that same chain attached, so the numbers include the editor's own
// insert cost, the event plumbing, and the handler.
//
// Run from packages/tui:
//   bun run bench:prompt
//
// Env:
//   BENCH_SIZES=0,1000,10000,100000   buffer sizes in characters
//   BENCH_ALPHABETS=ascii,cjk         which corpora to measure
//   BENCH_SCAN=line|buffer            mirror the current call shape, or the whole-buffer
//                                     one it replaced, to attribute the win
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { mentionTriggerIndex } from "../src/prompt/display"

const corpora: Record<string, string> = {
  ascii: "the quick brown fox jumps over the lazy dog and keeps on running\n",
  cjk: "敏捷的棕色狐狸跳过了那只懒狗并且一直不停地奔跑下去\n",
  // No newline anywhere, so the buffer is one enormous line: the worst case for any
  // scan bounded by the current line rather than by the whole buffer.
  oneline: "the quick brown fox jumps over the lazy dog and keeps on running ",
}

function corpus(alphabet: string, size: number) {
  const line = corpora[alphabet] ?? corpora.ascii
  let out = ""
  while (out.length < size) out += line
  return out.slice(0, size)
}

function keystrokes(size: number) {
  if (size >= 100_000) return 10
  return 20
}

const sizes = (Bun.env.BENCH_SIZES ?? "0,1000,10000,100000,500000").split(",").map(Number)
const alphabets = (Bun.env.BENCH_ALPHABETS ?? "ascii,cjk").split(",")
const scan = Bun.env.BENCH_SCAN ?? "line"

let input: TextareaRenderable
let handlerRuns = 0
let handlerNanos = 0

const app = await testRender(
  () => (
    <box width="100%">
      <textarea
        width="100%"
        maxHeight={12}
        onContentChange={() => {
          const start = Bun.nanoseconds()
          // Same chain the prompt runs per keystroke: materialize the buffer, then
          // ask the autocomplete whether a "@" mention trigger just appeared.
          const value = input.plainText
          const offset = input.cursorOffset
          if (offset > 0 && scan === "buffer") mentionTriggerIndex(value, offset)
          if (offset > 0 && scan === "line") {
            const lineStart = input.editBuffer.positionToOffset(input.logicalCursor.row, 0)
            mentionTriggerIndex(input.getTextRange(lineStart, offset), offset - lineStart)
          }
          handlerNanos += Bun.nanoseconds() - start
          handlerRuns += 1
        }}
        ref={(r: TextareaRenderable) => (input = r)}
      />
    </box>
  ),
  { width: 100, height: 24 },
)

await app.flush()
input!.focus()

async function drain(target: number) {
  for (let i = 0; i < 10_000 && handlerRuns < target; i++) await Bun.sleep(0)
}

console.log(`scan=${scan}`)
console.log("alphabet\tsize\tchars\tcursor\tkeys\tper_keystroke_ms\thandler_ms\tsetText_ms")
for (const alphabet of alphabets) {
  for (const size of sizes) {
    const body = corpus(alphabet, size)

    const setStart = Bun.nanoseconds()
    input!.setText(body)
    input!.gotoBufferEnd()
    const setText = (Bun.nanoseconds() - setStart) / 1e6
    const chars = input!.plainText.length
    const cursor = input!.cursorOffset

    handlerRuns = 0
    handlerNanos = 0
    await drain(1)

    // Warm the segmenter and the JIT so the first sample does not carry ICU startup.
    for (let i = 0; i < 3; i++) {
      app.mockInput.pressKey("x")
      await drain(handlerRuns + 1)
    }
    handlerRuns = 0
    handlerNanos = 0

    const keys = keystrokes(size)
    const start = Bun.nanoseconds()
    for (let i = 0; i < keys; i++) {
      app.mockInput.pressKey("x")
      await drain(i + 1)
    }
    const elapsed = (Bun.nanoseconds() - start) / 1e6

    console.log(
      [
        alphabet,
        size,
        chars,
        cursor,
        keys,
        (elapsed / keys).toFixed(3),
        (handlerNanos / 1e6 / Math.max(1, handlerRuns)).toFixed(3),
        setText.toFixed(3),
      ].join("\t"),
    )
  }
}

app.renderer.destroy()
process.exit(0)
