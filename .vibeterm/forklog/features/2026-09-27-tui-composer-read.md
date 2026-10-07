# TUI composer read and part-preserving replace

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/tui-composer-read` (worktree
  `/home/nowaker/projekty/webapps/opencode-composer-read`)
- First local commit: `2638af5a71`
- Current local commit(s): `2638af5a71`
- Upstream base when introduced: `2406400f0` (upstream `dev`, contains `v1.18.32`)
- Last checked against upstream: `907b3bc518` (upstream `dev`, contains `v1.18.34`)

## Original request

Spawned by coordinator `ses_f19c07ea0ffe0BXye8vomz4ZzU`:

> Text typed into OpenCode's NATIVE TUI prompt/composer must be recoverable
> after the opencode process dies abnormally (OOM kill, `kill -9`, tmux crash,
> reboot), for both an existing session and a brand-new session that has never
> submitted anything (no session row yet).

## Goals

- A TUI plugin can read the composer's text, parts and mode cheaply enough to
  poll, so it can keep an unsent draft on disk.
- A plugin can put a saved draft back whole, including pasted-block and file
  parts, through the existing guarded `replace()`.

## Non-goals

- OpenCode itself persists nothing. Where drafts are stored, when they are
  restored, and how a sessionless composer is identified stay in the vibeterm
  route plugin (`opencode-tools/opencode-vibeterm-route-plugin/draft-keeper.ts`).

## Rationale and constraints

- The composer lives only in memory (`packages/tui/src/component/prompt/index.tsx`
  `store.prompt`). Measured 2026-09-27 on the installed build with isolated
  homes: after `kill -9`, no file held the typed text and a relaunched TUI came
  up empty, for a home composer and a `-s` composer.
- `api.prompt.snapshot()` carries only SHA-256 digests and counts, so a plugin
  could not learn the text; `replace()` always wrote `parts: []`, so a restore
  would bring back a `[Pasted ~N lines]` placeholder with nothing behind it.
- Rejected: fork-internal persistence into OpenCode's state dir. Several home
  TUIs share one state dir, a sessionless composer has no key OpenCode owns,
  and restoring one needs vibeterm's tab knowledge anyway.
- The new request field is `promptParts`, not `parts`: callers build requests
  by spreading a snapshot, whose `parts` is a count.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `2638af5a71` | 2026-09-27 | `api.prompt.read()` returns input, parts, mode, generation, revision, readiness, `reason`, session ID; `replace()` accepts `promptParts` and accepts only an exact readback of text and parts | `packages/plugin/src/tui-prompt.ts` `TuiComposerDraft`, `TuiComposerApi`; `packages/tui/src/plugin/prompt-control.ts` `createPromptControl`; `packages/tui/test/prompt-control.test.ts` |

## Verification

- `bun test test/prompt-control.test.ts` (packages/tui) - 20 pass.
- `bun test test/cli/tui/plugin-composer.test.ts` (packages/opencode) - 1 pass.
- `bunx tsc --noEmit -p .` (packages/tui) - only the 11 pre-existing
  `dialog-move-session.tsx` errors.
- Installed binary byte-identical to the build of `2638af5a71`.
- Manual surface, via `opencode-tools` `native-drafts.e2e.test.ts` against the
  installed binary: drafts with a pasted part survive `kill -9` and a dead tmux
  server for a session tab and a sessionless tab, and are never submitted.

## Timeline

- 2026-10-06 [`ses_eec44ad14ffeownfvFKtEeqk4N`](../sessions/2026-10-06-tui-composer-caret.md) -
  extended by [the composer caret](./2026-10-06-tui-composer-caret.md):
  `read().caret` and `replace({ caret })`; re-verified by the native-drafts e2e.

- 2026-10-06 [`ses_eeda1d251ffel81U5Y42j4kb33`](../sessions/fork-audit.md) -
  verify read/parts/stale-write and host projection coverage, reconcile original
  sessions, and flag the separate tools socket-path repair in the inventory.

- 2026-09-27 [`ses_f19bcd194ffecw7EE6UaCiWdxI`](../sessions/2026-09-27-tui-composer-read.md) -
  introduced, built and installed. Evidence: `2638af5a71`, linked session.
- 2026-09-30 [`ses_f0f108c6dffeMymgpAsLy9LESM`](../sessions/2026-09-30-upstream-1.18.33.md) -
  rebased unchanged onto upstream `dev`
  `2fa3363c92` (contains `v1.18.33`). Evidence: that session's gates.
- 2026-10-04 [`ses_ef81db9cdffe5vRz7Y2HqCmvNs`](../sessions/2026-10-04-upstream-1.18.34.md) -
  rebased unchanged onto upstream `dev`
  `907b3bc518` (contains `v1.18.34`). Evidence: that session's gates.

## Current maintenance notes

- Builds on the content-guarded composer (`7946757514`); an upstream bump must
  keep `createPromptControl` and the `PromptRef.handoff` revision it reads.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
