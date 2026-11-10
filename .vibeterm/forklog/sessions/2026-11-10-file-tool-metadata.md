# File tool metadata: links, size, line endings, stale-read guard

## Identity

- Workday: 2026-11-10
- Session: [`ses_e3b5c833cffeNAR8nbTGc9S6Gx`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b5c833cffeNAR8nbTGc9S6Gx)
- Agent/platform: opencode / linux (Vibeterm)
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `file-metadata`; upstream twin `file-metadata-upstream` (local)
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `e563b42081`, merge `9911a26b09`; upstream twin `c22174c762`
- Forklog commit: this file's introducing commit

## User requests

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), the user's "Build the rest" ([`qst_19b75c778001zKxJpAYYTwNIi0`](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_19b75c778001zKxJpAYYTwNIi0)); the seven items are quoted in the [feature record](../features/2026-11-10-file-tool-metadata.md#original-request).

> Fork-only for now: prepare a clean upstream branch off github/v1 and a PR body under .vibeterm/tmp/opencode/, but don't open a PR (we're at the 3-PR cap). Check it with a real isolated opencode (scratch XDG, throwaway tmux socket): read a linked file, write through a link, edit after an outside change.

## Goals

- Items 1-7 built with tests that fail on the old code, merged, installed on desktop and m4max.

## Constraints and non-goals

- The main checkout's uncommitted retry-header cap (`retry.ts`, `retry.test.ts`) and `.gitignore` edit were preserved; both builds ran from the main checkouts, so vt-421 carries the cap.
- Merged on top of the snapshot index.lock (`3b0f177f0b`) and permission-defer (`365d0a3b4d`) merges without touching them. The m4max build started only after the snapshot-lock worker's m4max build had finished.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `3b0f177f0b` | `9911a26b09` + forklog | merge `file-metadata` |
| `opencode` | `file-metadata-upstream` | - | `c22174c762` | new local branch on `symlink-external-dir` (`b6bdc91b38`, on `github/v1`); PR body `.vibeterm/tmp/opencode/file-metadata-pr.md` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Tell the model about links, size, line endings and stale files](../features/2026-11-10-file-tool-metadata.md) | added | 25 tool tests, 22 red on the old code; isolated run below |
| [Prompt external_directory for symlinks that resolve outside the project](../features/2026-11-01-symlink-external-directory.md) | re-verified | its read/write/edit/apply_patch symlink tests pass on the merged tree (`TMPDIR=/tmp`); `resolveTarget` now exported for reuse |

## Verification

- `bun typecheck` in `packages/opencode`: clean on the branch, the merge and the upstream twin.
- `TMPDIR=/tmp bun test test/tool test/acp`: 539 pass, 1 fail (`tool.task` 5 s timeout, pre-existing: same on the unchanged tree under load average 25-50).
- Upstream twin: read, write, edit, apply_patch, external-directory suites, 156 pass.
- Isolated real opencode: `opencode run` with scratch XDG dirs inside tmux socket `fm-check-<label>`, a scripted OpenAI-compatible provider on 127.0.0.1 that appends to `stale.txt` right before the edit and write calls, fixtures in `/tmp/fm-fx-<label>` outside every repository (scripts in `.vibeterm/tmp/fm-check/`). Run against vt-419 (before), the worktree source (after) and installed vt-421 (identical to after). Before -> after:
  - read of `link-other.txt -> ../other/sub/target.txt`: no link line, `(End of file - total 2 lines)` -> `<symlink>../other/sub/target.txt -> /tmp/fm-fx-after/other/sub/target.txt (outside this worktree, in git repo /tmp/fm-fx-after/other)</symlink>`, `(End of file - total 2 lines, 23 bytes)`.
  - read of a CRLF file: nothing -> `<line-endings>crlf</line-endings>`.
  - write via `link.txt -> real.txt`: `Wrote file successfully.` -> `Wrote file successfully: /tmp/fm-fx-after/proj/link.txt -> /tmp/fm-fx-after/proj/real.txt (17 bytes).`
  - write via a dangling link: `Wrote file successfully.` and `does-not-exist.txt` created -> `Refusing to write .../dangling.txt: it is a symbolic link to does-not-exist.txt (.../does-not-exist.txt), which does not exist. Write to .../does-not-exist.txt to create it.`, nothing created.
  - edit after an outside append, `oldString` still present: `Edit applied successfully.` -> the same plus `Note: the file had changed on disk since your last read; re-read it before edits that depend on surrounding content.`
  - write after a second outside append: `Wrote file successfully.`, outside changes lost -> `File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.`, file kept.
  - directory listing: plain names -> `dangling.txt -> does-not-exist.txt (missing)`, `link-into-other-repo/ -> ../other/sub`, `link-other.txt -> ../other/sub/target.txt`, `link.txt -> real.txt`.
- OMO's `write-existing-file-guard` was not loaded in the isolated run; its interplay was checked against its source (`forks/oh-my-openagent` `ef58803d38`), see the feature record.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` on desktop and m4max (m4max after `git pull --ff-only` and `bun install --frozen-lockfile`); v2 guard gate PASSED on both.
- Installed artifact: `1.19.5-vt-421-006d837c50` on both hosts; desktop inode `49955615`, m4max inode `56260985`; retry marker and the stale-read string present; `.vibeterm/smoke.sh <binary>` SMOKE OK on both.
- Running services: not restarted.

## Commit provenance

- `e563b42081` - feature; `9911a26b09` - merge; `c22174c762` - upstream twin (local).
- Required trailer: `AI-Session-ID: ses_e3b5c833cffeNAR8nbTGc9S6Gx`

## Unknowns and blocked verification

- `file-metadata-upstream` is not pushed: it stacks on `b6bdc91b38`, which its session left local with its disclosure route pending.
