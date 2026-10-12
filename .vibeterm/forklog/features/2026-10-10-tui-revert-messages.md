# Revert messages without reverting files, shown at once

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `revert-modes`; upstream `v1-revert-messages`
- First local commit: `c199a85944`
- Current local commit(s): `c199a85944`, `7c6a2b63f3` (fork default)
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, contains `v1.19.0`)
- Upstream: PR [#54436](https://github.com/anomalyco/opencode/pull/54436) (`v1-revert-messages`, `0737c14d50`), default `revert.files: true`. **Needs a v2 port later.**

## Original request

Assigned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as item 29, quoting
the user:

> tui: after clicking on any past message, a list of actions shows up: -
> revert - copy - fork
> we should have a look at reverting. reverting SUCKS. under cpu load it takes
> FOREVER for message to get removed from the chat log, and show 'reverted'
> instead. and reverting causes actual revert of files. morever, check
> loaded-gun tools in vibeterm. revert is dangerous if you then decide to call
> /redo. the most siliest thing is the file revert that i barely ever want to
> happen. LET ME DECIDE! is it a revert to the given msgid + revert of changes
> applied to files, or is it just a revert to the msgid and that's it? the
> latter probably would perform much faster as it wouldn't create silly
> snapshots that nobody needs.
> - revert messages
> - revert messages and changes
> example wording, choose what's best.

## Goals

- Message actions offer "Revert messages" and "Revert messages and files".
- A messages-only revert takes no snapshot, writes no file and stores the
  unarmed `{ messageID }`, so Redo restores messages only.
- `/undo` and `<leader>u` follow `revert.files` in tui.json; `/undo-messages`
  and `/undo-files` always do one or the other.
- The transcript shows a revert or redo at once, under any load.

## Non-goals

- No change to what a file revert or an armed Redo does.
- Existing armed sessions stay armed; disarming them is
  opencode-tools' `loaded-guns.ts --unload`.

## Rationale and constraints

- Upstream `SessionRevert.revert` always ran `snap.track()`, reverted every
  patch, diffed the snapshot and `diffFull` before `setRevert`, and the TUI
  only changed on that `session.updated`: 2.8-11.3 s under full CPU load on a
  real 1632-message session against a 5600-file checkout.
- The server carries the choice (`files` on `RevertInput` and the route,
  default `true`), not the TUI.
- A messages-only revert after a file revert keeps that snapshot: those files
  are still put back and Redo is the only way to restore them.
- Redo on a messages-only revert passes `files: false` when it steps to the
  next prompt, so it never arms one.
- Solid stores merge an object set over another and keep the raw object, so
  the optimistic revert assigns copies through `produce`; a rollback leaves a
  newer state alone.
- While a turn runs the server refuses a revert, so the reverted prompt only
  goes to the composer once the revert succeeded.
- Fork default `revert.files: false` (`7c6a2b63f3`): the user "barely ever"
  wants the file revert. Upstream PR keeps `true`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `c199a85944` | 2026-10-10 | `files` on revert; messages-only path reading one message; two Revert actions; `revert.files`; `/undo-messages`, `/undo-files` and their keybinds; optimistic revert/redo with rollback; Redo confirmation names file overwrite; docs | `SessionRevert.revert`/`revertMessages` in `packages/opencode/src/session/revert.ts`; `RevertInput.files`; `revertChoices`/`revertSession`/`unrevertSession` in `packages/tui/src/routes/session/revert.ts`; `TuiConfig.revertFiles`; `session.undo.messages`/`session.undo.files`; generated `session.revert` `files` in `packages/sdk/js/src/v2/gen` |
| `7c6a2b63f3` | 2026-10-10 | Fork default `revert.files: false` | `RevertFilesDefault` in `packages/tui/src/config/index.tsx`; `tui.mdx` |

## Verification

Session [`ses_ed759a0b4ffeCubC9xxc8hYgHY`](../sessions/2026-10-10-revert-unqueue.md):

- `bun test test/session/revert-compact.test.ts` (packages/opencode) - 11 pass,
  including messages-only revert/unrevert leaving files alone, a messages-only
  revert after a file revert keeping the snapshot, and an answer reverting to
  its prompt.
- `bun test test/routes/session/revert.test.ts` (packages/tui) - 8 pass;
  full packages/tui suite 390 pass.
- Benchmark: scratch copy of `ses_ef8235798ffejGr4sa22eXmVNv` (1632 messages,
  9 MB) on a shared clone of opencode-tools, served by the worktree under
  `bwrap` with `$HOME` read-only, `yes` on all 18 cores: revert with files
  2.8-9.2 s, messages-only 20-75 ms; Redo 0.9-1.6 s vs 8-57 ms. Unloaded:
  0.9-3.0 s vs 9-20 ms.
- Real PTY (throwaway tmux socket, fake OpenAI-compatible provider writing
  `note.txt` through `write`): "Revert messages" banner 36 ms after Enter, file
  kept, stored `{ messageID }`; an edit made after it survived both Redos.
  "Revert messages and files" under load: banner 59 ms, server done 333 ms,
  file removed; Redo confirmation named the overwrite and restored the edit.
  Reverting a running turn's prompt: "Session is busy" notice, transcript and
  empty composer restored.

## Timeline

- 2026-10-10 [`ses_ed759a0b4ffeCubC9xxc8hYgHY`](../sessions/2026-10-10-revert-unqueue.md) -
  initial build, upstream PR #54436, installed on desktop and m4max.
  Evidence: `c199a85944`, `7c6a2b63f3`.
- 2026-10-11 [`ses_ed5f9f826ffeno6fI51rL96d5Q`](../sessions/2026-10-11-upstream-v1-19.md) -
  rebased unchanged onto upstream `v1` `dfb56f76c7` (`v1.19.0`).
  Evidence: patch-identical in `git range-diff`; that session's gates.
- 2026-10-12 [`ses_ece4671adffe4Y4d8Yv35NSjXh`](../sessions/2026-10-12-v1-v2-patch-rig.md) -
  rig run: `v1-revert-messages` applies on `v1.19.0`; v2 port cost L. See the [matrix](../README.md#tui-patches-on-v1-and-v2).

## Current maintenance notes

- Regenerate the SDK (`./packages/sdk/js/script/build.ts`) after touching
  `RevertInput`.
- Keep the fork-default commit separate from the upstream change.
- Port to v2 once Vibeterm core runs on v2.

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
