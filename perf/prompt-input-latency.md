# fix(tui): stop scanning the whole prompt buffer on every keystroke

## Problem

Typing in the TUI prompt gets slower the more text the prompt holds. At ~100 KB each
keystroke costs roughly half a second, so the editor lags several characters behind the
typist. Clearing the prompt restores full speed immediately, which is the tell that the
cost is a function of buffer length rather than of session or terminal state.

## User impact

Any workflow that puts a large body into the prompt and then edits it. The reproducible
one is reverting a message: revert loads that message's text into the prompt so it can be
amended, and amending a large message is exactly when the editor becomes unusable. Pasting
a large file with paste summarisation disabled reaches the same state. Nothing about
revert is at fault - it is one of several ways to end up with a big buffer, and the buffer
is what costs.

## Mechanism

The prompt's `onContentChange` runs on every keystroke
(`packages/tui/src/component/prompt/index.tsx:1377`) and forwards the whole buffer to the
autocomplete trigger check (`index.tsx:1380`). That check
(`packages/tui/src/component/prompt/autocomplete.tsx:703`) called
`mentionTriggerIndex(value, offset)` with the entire prompt text.

`mentionTriggerIndex` (`packages/tui/src/prompt/display.ts:38`) began by materialising
the text before the cursor via `displaySlice` -> `displayOffsetIndex`
(`display.ts:12-23`), which walked every grapheme in the buffer. The walk's inner line was
the expensive part:

```ts
for (const part of graphemes.segment(value)) {
  const next = width + promptOffsetWidth(part.segment)   // display.ts:17
  ...
}
```

`promptOffsetWidth` is itself a segmenting loop, so each grapheme allocated a fresh
`Intl.Segmenter` iterator for a one-character string. A 100 KB prompt therefore performed
~100k ICU segmentation setups plus ~100k `Bun.stringWidth` calls per keystroke. Measured
in isolation this single call was **566 ms at 100 KB** and **3.3 s at 500 KB**.

Two independent costs, then: the scan was proportional to the buffer, and its constant
factor was enormous.

## The change

Three changes. The benchmark lands first so the "before" column can be reproduced by
checking out its commit.

1. **`display.ts` - skip segmentation that cannot change the answer.** Printable ASCII and
   newline are each exactly one display column, so a run of them needs no segmentation and
   its width is its length. A sticky regex finds that run; only the remainder is segmented,
   resuming one character early so a cluster straddling the boundary (`e` + U+0301) is still
   segmented as a unit. The per-grapheme `promptOffsetWidth` recursion is replaced by a
   direct width computation, removing the per-character segmenter allocation.

2. **`display.ts` - bound the mention scan to the word being typed.** A mention trigger
   contains no whitespace, so the only `@` that can qualify is the one opening the final
   whitespace-free run before the cursor: an `@` later in that run has a non-space in front
   of it, and an `@` before the run has whitespace between itself and the cursor. Scanning
   backward to that run replaces `lastIndexOf` over the whole prefix.

3. **`autocomplete.tsx` - read one line instead of the whole buffer.** Because a trigger
   holds no whitespace it can never cross a newline, so only the current line matters. The
   line is read straight out of the editor's rope via
   `editBuffer.positionToOffset(row, 0)` + `getTextRange(...)`, which makes the scan
   independent of buffer size for every script rather than only for ASCII.

Step 3 is what rescues non-ASCII text: steps 1-2 make ASCII fast because the fast path
applies, but a CJK buffer has no printable-ASCII run to skip and still walked to the cursor.

## Measurement

`packages/tui/script/bench-prompt-input.tsx` (`bun run bench:prompt` from `packages/tui`)
drives a real `TextareaRenderable` through real key events with the prompt's own
`onContentChange` chain attached. `BENCH_SCAN=buffer` reproduces the old whole-buffer call
shape, `BENCH_SCAN=line` the new one, so the two halves of the fix can be attributed
separately.

Figures below are `handler_ms`: the per-keystroke work the prompt performs, excluding the
harness's render/drain overhead (reported separately by the script as
`per_keystroke_ms`). Single run per cell, so treat sub-millisecond figures as ±2x; the
headline gap is three orders of magnitude and far outside that noise.

ASCII prose, 64-character lines:

| buffer | before | display fix only | + line-bounded scan |
| -----: | -----: | ---------------: | ------------------: |
|   1 KB |   6.12 |             0.09 |                0.09 |
|  10 KB |  66.58 |             0.18 |                0.29 |
| 100 KB | 533.33 |             1.87 |                2.92 |
| 500 KB | 4704.7 |             9.41 |               19.26 |

CJK prose, 26-character lines:

| buffer |  before | display fix only | + line-bounded scan |
| -----: | ------: | ---------------: | ------------------: |
|   1 KB |   12.57 |             1.49 |                0.22 |
|  10 KB |  128.81 |             4.23 |                0.31 |
| 100 KB | 1152.63 |            69.42 |                6.16 |

Single line with no newline at all - the worst case for a line-bounded scan:

| buffer | before | after |
| -----: | -----: | ----: |
|   1 KB |  12.78 |  0.18 |
|  10 KB | 114.16 |  0.44 |

The benchmark prints `chars` and `cursor` columns so each row can be checked against the
fixture it claims to measure. Two rows are excluded above because those columns show the
fixture did not load as intended, both from limits in the editor rather than in this
change: a single line saturates `cursorOffset` at 65535, and a 500 KB CJK buffer reports
fewer characters than were written.

End to end in a real terminal - opencode running from source under tmux, 100 KB pasted
into the prompt, ten characters typed one at a time, timed until all ten render:

| build  | 10 keystrokes | per keystroke |
| ------ | ------------: | ------------: |
| before |        3.29 s |        329 ms |
| after  | 0.21 - 0.38 s |   21 - 38 ms  |

Before the fix each character visibly trails the keyboard; after it, typing keeps up. The
after figures are bounded below by the harness's 50 ms poll interval and tmux round trips,
so the true improvement is larger than 10x - the in-process numbers above put it near 180x.

## What is still linear

`onContentChange` reads `input.plainText`, copying the whole rope into a JS string and
into the Solid store on every keystroke. That is now the dominant remaining term - most of
the 2.92 ms at 100 KB - and it is why the curve flattens rather than going flat. Removing
it means the prompt store no longer holding the full text, which touches submit,
autocomplete and every `store.prompt.input` consumer; it is a larger change and is not
attempted here.

## Risk

The display helpers are shared: `packages/opencode/src/cli/cmd/prompt-display.ts`
re-exports this module for the `opencode run` footer prompt, so both prompts change
behaviour together. That is the reason the arithmetic is pinned by a differential test
rather than by hand-written expectations - `packages/tui/test/prompt/display.test.ts`
checks `promptOffsetWidth`, `mentionTriggerIndex`, `displayCharAt` and `displaySlice`
against a straightforward segment-every-grapheme reference at every offset of a corpus
covering ASCII, CJK, emoji ZWJ sequences, combining marks and tabs (877 assertions).

The riskiest single assumption is step 3's: that `editBuffer.positionToOffset(row, 0)` is
in the same display-offset space as `cursorOffset` and `promptOffsetWidth`. That was
verified empirically against the running editor for ASCII, CJK, emoji ZWJ and combining
marks before being relied on. If it were ever untrue, mentions would attach at a wrong
offset; the existing mention tests plus the display test cover that surface.

The fast path is deliberately conservative: it claims only `[\x20-\x7e\n]`, so tab,
carriage return and every control character fall through to the original segmenting path.

## How to verify

```sh
cd packages/tui
bun test test/prompt/display.test.ts   # 877 assertions vs the reference implementation
bun test                               # full package suite
bun typecheck
bun run bench:prompt                   # after
BENCH_SCAN=buffer bun run bench:prompt # old call shape, for comparison
```

By hand: open a prompt, paste ~100 KB with paste summarisation disabled
(`experimental.disable_paste_summary`), and type. Then check mentions still work - type
`@` mid-sentence and after a newline, confirm the popup opens and the inserted path lands
at the right offset.
