# Resume a paused v1 turn with the composer selection

## Identity

- Workday: 2026-11-19, America/Chicago.
- Session: [`ses_e09d84c4dffe3aDT5kCOpYjpgs`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e09d84c4dffe3aDT5kCOpYjpgs), desktop Linux, `openai/gpt-6.2-sol`.
- Coordinator: [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv).
- Integration: `dev-nowaker`, `8e6c161580` to `78a26fe446` (source, fast-forward), then this record. Development: `unpause-composer`. Upstream `v1` base: `006d837c50` (`v1.19.5`).

## Request and implementation

> Manual TUI /unpause (and Resume click sharing pauseAction) should apply the exact current composer agent, model and variant to the already waiting turn as if changing the queued message, with no extra user prompt.

> User expanded UI scope to Portal's /unpause + both buttons as well. No additional engine semantics; please use a common optional `selection: { agent: string, model: { providerID: string, modelID: string, variant?: string } }` on POST /session/:id/unpause (omitted variant inside explicit selection means default/clears prior variant; omitted selection retains old automation behavior). I will wire Vibeterm relay / coordinate Portal separately.

> Mixed-version rollout needs a fail-closed owning-engine probe: old v1 Effect optionalBody decoder silently strips unknown `selection`. Please add top-level `sessionUnpauseSelection: true` to the engine's GET /global/health success schema and response (additive; use existing globals/SDK generation).

- `18ff4e321e`: merge a late snapshot diff into the current user message under the write lock rather than replacing a newer selection; invalidate message info after projection and before event observers. The existing SQLite rollback summary regression passes.
- `bca7fc1b03`: the explicit selection updates the actual resuming user row. Apply it before release when already stopped; a still-running owner consumes it at the next step boundary only for a previously admitted input. Preserve `turn_end` ordering and the old route's tool execution context. A refusal for the old route does not override a manual switch to a different one.
- `78a26fe446`: the TUI sends the pick from both manual actions and never adopts ignored notices, including the gap between a message event and its part event.
- No normal prompt or automation routing changes, no upstream PR, and no live paused sessions touched. Portal and relay integration belong to the coordinator.

## Features touched

- [Session pause](../features/2026-11-14-session-pause.md), [TUI selection adoption](../features/2026-11-18-follow-latest-selection.md), [route-aware refusal park](../features/2026-11-16-park-no-routable-account.md), [queued prompt timing](../features/2026-11-10-queued-prompt-timing.md), and [summary event deduplication](../features/2026-09-26-summary-event-dedup.md).

## Verification

- From `packages/opencode`, `bun run test test/session/pause.test.ts --test-name-pattern 'unpause with a composer selection|unpause during a pending step'`: the two original regressions failed before the engine change (`0 pass, 2 fail`) with the old picks; both then passed.
- From `packages/opencode`, `bun run test test/session/pause.test.ts test/session/pause-refusal.test.ts test/session/summary-events.test.ts test/server/httpapi-sdk.test.ts`: 72 pass, 0 fail. Earlier broader run with `test/session/prompt.test.ts`: 178 pass, 1 skip, 0 fail.
- From `packages/tui`, `bun run test test/routes/session/adopt-latest-selection.test.tsx`: 10 pass, 0 fail. `bun typecheck` passed in `packages/opencode`, `packages/tui`, `packages/sdk/js` and `packages/client`. The legacy SDK generator reproduced both updated hashes; `packages/client` generation made no change.
- Real v1 TUI, isolated PTY and loopback fake provider: 12/24 on `8e6c161580`, 24/24 on `78a26fe446`. Slash and footer click each sent exactly one new provider step, with Plan, the newly selected model, no old `reasoning_effort`, and the deferred read result. Each assistant kept the original prompt ID, only the normal reader-only notice was added, and the picker stayed put. QA session: [`ses_e09d62694ffekEvC0tA2IySuUg`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e09d62694ffekEvC0tA2IySuUg).
- Local evidence: `.vibeterm/worktrees/unpause-composer/.vibeterm/tmp/unpause-qa/runs/final-1795136202799/results.json` under the primary checkout.

## Build and install

- `.vibeterm/build.sh` built `1.19.5-vt-unpause-qa` with `OPENCODE_INSTALL` pointing at a scratch path inside the worktree. The mandatory v2 migration guard passed. No production install, service restart, or work on m4max/m2pro. Desktop release and Portal demo remain with the coordinator.
