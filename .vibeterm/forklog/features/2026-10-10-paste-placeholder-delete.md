# Delete a paste placeholder whole on word and line deletes

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-paste-undo` (fork); `paste-placeholder-delete` (upstream PR head `13680808c7` on `v1` `dfb56f76c7`); opentui fork `~/projekty/forks/opentui`: PR branch `atomic-virtual-extmarks` (`bec96676`), integration branch `main-nowaker` (`b3bc112c`, upstream `main` `v0.6.0` plus the fix)
- First local commit: `0714559fe2`
- Current local commit(s): `5659adcaf7` (`0714559fe2` before the v1 rebase)
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Upstream: opencode PR [#54457](https://github.com/anomalyco/opencode/pull/54457) against `v1`; opentui PR [anomalyco/opentui#1628](https://github.com/anomalyco/opentui/pull/1628). **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 28), quoting the user:

> fix treatment of ^W when dealing with [ pasted content ] (maybe requires a fix in the underlying tui framework? if so, fork it in the right place and submit a contribution from there) - now ^W chops paste contenet placeholder mid way, should just clear it entirely

## Goals

- ctrl+w, alt+backspace, ctrl+u and ctrl+k remove a `[Pasted ~N lines]` placeholder whole, never part of its label.

## Non-goals

- None recorded.

## Rationale and constraints

- The bug is in `@opentui/core`'s `ExtmarksController`: its `deleteRange` wrapper, which every word and line delete goes through, trimmed a virtual extmark instead of treating it as one unit. Fixed at the source in the opentui fork, consumed here as a `bun patch` of the pinned `0.4.5` until opencode adopts a release with #1628.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `0714559fe2` | 2026-10-10 | `deleteRange` widens over every virtual extmark it cuts into | `patches/@opentui%2Fcore@0.4.5.patch` (`expandToVirtualExtmarks` in `chunk-bun-t2myhmwd.js` and `chunk-node-q0cwyvm9.js`), `package.json` `patchedDependencies`; `packages/tui/test/component/prompt-placeholder-delete.test.tsx` |

## Verification

- opentui fork: `bun test src/lib/extmarks` 190 pass; the four new virtual-extmark cases fail without the fix; extmark, edit-buffer and textarea suites 828 pass; `fmt:check`, `typecheck` clean.
- `prompt-placeholder-delete.test.tsx` 4 pass; 3 of 4 fail with the patch reverted in `node_modules`.
- Real-PTY rig (scratch build, throwaway tmux socket): ctrl+w after `see [Pasted ~3 lines]` left `see`; alt+backspace, ctrl+k and ctrl+u each removed the placeholder whole.

## Timeline

- 2026-10-10 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-10-prompt-paste-undo.md) - introduced. Evidence: commit above, session Verification.
- 2026-10-11 [`ses_ed5f9f826ffeno6fI51rL96d5Q`](../sessions/2026-10-11-upstream-v1-19.md) -
  rebased onto upstream `v1` `dfb56f76c7` (`v1.19.0`), which keeps
  `@opentui/core` at `0.4.5`, so the patch carries over unchanged; the
  `bun.lock` `patchedDependencies` conflict with v1's xai patch keeps both.
  Evidence: `bun install` no-op, TUI suite, that session.

## Current maintenance notes

- On an opentui bump: if the new version contains anomalyco/opentui#1628, drop the patch and its `patchedDependencies` entry; otherwise regenerate it with `bun patch @opentui/core@<version>` against the same two chunks.
