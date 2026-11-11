# Choose when a running turn reads queued prompts

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `mid-turn-delivery` (cut from `dev-nowaker` `9911a26b09`)
- First local commit: `68e4a9e291`
- Current local commit(s): `68e4a9e291`, merge `3233e3566e`; tail-window fix `a048180f1c`, merge `c83a1896e7`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), quoting the user (A4 "mid-turn delivery" of `opencode-tools/docs/research/2026-11-01-claude-code-tools.md`):

> normally the model responds with multiple tool calls, wants data back, but opencode won't inject user prompt in between? ... So basically it submits my queued prompt earlier? This is dope.

Widened by the user: "And vtns also. Generally everything that prompts into the session, whether waking or non-waking."

## Goals

- Input stored while a turn runs reaches the model before the turn's next request, after the running tool calls, in arrival order; a non-waking note never starts a turn while the session is idle.
- A setting turns it off.
- The TUI shows honestly whether a prompt is still waiting or was read mid-turn.

## Non-goals

- No framing wrapper around a prompt read mid-turn (coordinator decision: Vibeterm messages carry `[vibeterm_metadata]`, a typed prompt needs no preamble).
- No new plugin seam: plugins use the existing `session.promptAsync` / `session.prompt({ noReply: true })` with a stable `messageID`.

## Rationale and constraints

- The behaviour already existed, in upstream v1 too: `runLoop` in `packages/opencode/src/session/prompt.ts` reloads history (`MessageV2.filterCompactedEffect`) before every step and parents the step to the newest user message, and every sender stores a real user message at once. Evidence: three Vibeterm and OMO messages in [`ses_e3b33afadffe7NYeYU6qMrEk6L`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b33afadffe7NYeYU6qMrEk6L) became the parents of the next steps of a running `tool-calls` chain. What was missing: tests, docs, an off switch, and an honest QUEUED badge.
- With `turn_end`, a compaction still gets the held prompts. Compaction moves queued prompts behind the summary under new IDs; a prompt hidden from it would sit before the compaction boundary and vanish from the model's view.
- Held prompts are not marked seen, so `unqueue` still works while they wait.
- The old badge (`index > pending` of the running assistant message) turned false as soon as the turn's next step began, read or not.
- A message stored without `agent` gets the default agent, and the loop takes agent and model from the newest user message, so a sender must pass the session's agent and model or the running turn switches mid-chain.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `68e4a9e291` | 2026-11-10 | Config `queued_prompts: "next_step" \| "turn_end"` | `queued_prompts` in `packages/core/src/v1/config/config.ts`; `Config.queued_prompts` in `packages/sdk/js/src/v2/gen/types.gen.ts` |
| `68e4a9e291` | 2026-11-10 | `turn_end` hides user input stored after the turn's prompt while the latest step ended on tool calls; compaction gets the full history | `holdForTurnEnd`, `holding` in `runLoop`, `packages/opencode/src/session/prompt.ts` |
| `68e4a9e291` | 2026-11-10 | TUI QUEUED badge from what the turn read, plus a "read mid-turn" footer label | `promptDeliveries` in `packages/tui/src/routes/session/prompt-delivery.ts`; `deliveries` memo and `UserMessage` `delivery` prop in `packages/tui/src/routes/session/index.tsx` |
| `68e4a9e291` | 2026-11-10 | Test LLM server streams each tool call of a reply at its own index | `toolStartLine`/`toolArgsLine` index, `Reply.#tools` in `packages/opencode/test/lib/llm-server.ts` |
| `68e4a9e291` | 2026-11-10 | Tests | `prompt.test.ts` section "Mid-turn delivery" and "with queued_prompts turn_end, /compact during a turn ..."; `packages/tui/test/routes/session/prompt-delivery.test.ts` |
| `68e4a9e291` | 2026-11-10 | Docs | `packages/web/src/content/docs/config.mdx` "Queued prompts", `tui.mdx` queued paragraph |
| `3233e3566e` | 2026-11-10 | Fork merge, no conflicts | - |
| `a048180f1c` | 2026-11-10 | A prompt stored after the run's last read (turn ended, snapshots still settling) joined the run and got its old answer; the joined run now runs again unless it read or unqueued the prompt | `again` in `Runner.ensureRunning`/`finishRun`, `packages/opencode/src/effect/runner.ts`; `drive`/`unread` in `packages/opencode/src/session/prompt.ts`; tail-window tests in `test/session/async-snapshot.test.ts` |

opencode-tools `2205df613b2` sets `queued_prompts: "next_step"` from the spawn plugin's `config` hook unless the user set it, and corrects the vtps/vtns delivery wording.

## Verification

- `bun test test/session/prompt.test.ts` (filtered to the new tests) in `packages/opencode`: 11 pass. With `prompt.ts` restored to `9911a26b09`, both `turn_end` hold tests fail; the delivery tests pass there too, because the behaviour predates this change.
- `bun test test/session`: 619 pass, 3 fail; the same 3 (`Instruction.system` AGENTS.md/CLAUDE.md, snapshot race timeout) fail on `9911a26b09`.
- `bun test test/routes` in `packages/tui`: 99 pass, including 6 `promptDeliveries` cases.
- `bun typecheck` clean in `packages/opencode`, `packages/core`, `packages/tui`; SDK and client generators reproduce the artifacts on a second run.
- Installed `1.19.5-vt-426-006d837c50` on desktop and m4max: v2 guard gate passed, SMOKE OK, new strings and the retry-header marker in the binary.
- Manual surface: an isolated TUI and a real Vibeterm session each read a typed prompt, a vtps prompt and a vtns note between two steps of a running bash chain, answered them and finished the chain in the same turn; the TUI showed "read mid-turn" on each. Details in the session record.

## Timeline

- 2026-11-10 [`ses_e3b33afadffe7NYeYU6qMrEk6L`](../sessions/2026-11-10-queued-prompt-timing.md) - initial build. Evidence: `68e4a9e291`, merge `3233e3566e`, vt-426 on both hosts.
- 2026-11-10 [`ses_e38278d63ffeEgUW2xNFxMfVpm`](../sessions/2026-11-10-tail-wake.md) - fix: a prompt or OMO notice stored while a finished turn's run waits for its snapshots was never answered. Evidence: `a048180f1c`, merge `c83a1896e7`, vt-441 on desktop.
- 2026-11-11 [`ses_e37b26ea1ffeyDu2wQLAdY0TmV`](../sessions/2026-11-11-turn-end-held-order.md) - fix: under `turn_end` a held prompt or note stayed in its stored place inside the ended turn, so the follow-up request ended with the turn's own answer and the model said the note "arrived empty"; `answerAfterTurn` moves held input after that answer. Evidence: `ed9e8785a9`, merge `85466d15f4`, vt-449 on desktop.

## Current maintenance notes

- `Runner.ensureRunning`'s `again` check must keep reading the run's `seen`/`withdrawn` sets; if `pickUp` stops marking a read prompt seen, every joined prompt reruns the loop once (harmless but wasteful), and if `turn_end` starts marking held prompts seen, held prompts stop being answered.
- Upstream reads queued prompts the same way; only the switch, the badge and the tests are local. If upstream adds its own setting or changes `runLoop`'s per-step reload, re-check `holdForTurnEnd` and the compaction branch's `holding ? pickUp(sessionID, history) : msgs`.
- Regenerate the SDK with `./packages/sdk/js/script/build.ts` after touching the schema description.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
