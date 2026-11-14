# Tell the model about links, size, line endings and stale files

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `file-metadata` (cut from `dev-nowaker`); upstreamable twin `file-metadata-upstream` (`c22174c762`, local, on `symlink-external-dir` `b6bdc91b38` on `github/v1`, PR not opened)
- First local commit: `e563b42081`
- Current local commit(s): `e563b42081`, merge `9911a26b09`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), relaying the user's "Build the rest" ([`qst_19b75c778001zKxJpAYYTwNIi0`](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_19b75c778001zKxJpAYYTwNIi0)) of the file-tool metadata package in opencode-tools `docs/research/2026-11-01-file-tool-metadata.md` (`345b710275d`):

> 1. read: a `<symlink>` line when the path or a parent directory is a link: the link, the resolved target, and whether the target is inside the worktree, in another git repo (name its root), or elsewhere. 2. Byte size in the read footer and in write results. 3. Line endings and BOM, shown only when the file isn't plain LF without BOM (CRLF, mixed, CR, UTF-8 BOM, UTF-16). 4. Directory listings show `name -> target` for links, plus `(missing)` for dangling ones. 5. Write through a link: always follow it and say so in the result ("wrote <link> -> <real path>"). The permission check runs on the real path (already true since vt-397; verify it). Refuse only a dangling link, naming the would-be target. 6. A stale-read guard on write, edit and apply_patch. [...] 7. No mtime in any output. Keep every addition to one short line and leave the output unchanged for the common case (a plain LF file that isn't a link).

## Goals

- read: `<symlink>`, `<line-endings>` and `<encoding>` lines after `<type>`, each only when it applies; the byte size in every footer; links marked in directory listings.
- write, edit and apply_patch name the real path when they go through a link, and refuse a dangling link with the file it would create.
- A per-session stale-read guard with Claude Code's wording; a still-matching edit proceeds with a note.

## Non-goals

- Refusing writes through links (Claude Code does; option D of the research was replaced by "always follow" in the request).
- Guarding files the session never read: OMO's `write-existing-file-guard` covers write-without-read inside the session root.
- mtime in any output.

## Rationale and constraints

- No harness tells the model a path is a link (research section 3), so a read through a link into another repo, or a write that changes a dotfiles link's target, was invisible to it.
- Parent-directory links are checked only inside the project, so a project under a linked directory (`~/projects -> /Volumes/projects` on the Macs) does not mark every file.
- OMO interplay: OMO blocks a `write` of an existing file the session has not read (in `tool.execute.before`, before the tool runs), and consumes the read permission on each write. The stale guard only acts on files the session read or wrote, after OMO lets the call through, so a call gets at most one of the two refusals.
- The stamp map is process memory, at most 256 sessions x 1024 files, least recently used dropped; a restarted opencode has no stamps and guards nothing until the next read.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `e563b42081` | 2026-11-10 | Shared facts: link resolution and scope, line-ending counter, BOM sniff, stale stamps | `packages/opencode/src/tool/file-facts.ts` (`FileFacts.link`, `describe`, `lineEndings`, `encoding`, `remember`, `changed`, `STALE`, `STALE_NOTE`); `resolveTarget` exported from `external-directory.ts` |
| `e563b42081` | 2026-11-10 | read envelope lines, footer sizes, listing arrows, stamp on read | `ReadTool` in `tool/read.ts`: `list`, `lines` (`endings`), the `output` array and footers |
| `e563b42081` | 2026-11-10 | write/edit/apply_patch: link note, dangling refusal, stale guard, stamp after write | `tool/write.ts`, `tool/edit.ts` (`stale`, the `replace` `Effect.try`), `tool/apply_patch.ts` (hunk loop, summary lines) |
| `e563b42081` | 2026-11-10 | Tests and docs | `test/tool/{read,write,edit,apply_patch}.test.ts` "file facts" / "tool.read symlinks"; `packages/web/src/content/docs/tools.mdx` |
| `9911a26b09` | 2026-11-10 | Fork merge, no conflicts | - |

## Verification

- 25 new tests; with the four tool files reverted to `770f0e7efd` and `file-facts.ts` kept, 22 fail and 3 (false-positive guards) pass.
- `TMPDIR=/tmp bun test test/tool test/acp`: 539 pass, 1 fail (`tool.task` description sort, a 5 s timeout; the same file fails identically on the unchanged tree at load average 25-50).
- The two vt-397 write symlink tests fail under this session's default `TMPDIR` (inside the opencode checkout) and pass with `TMPDIR=/tmp`; same on the old code.
- Isolated real opencode (`opencode run`, scratch XDG, throwaway tmux socket, scripted OpenAI-compatible mock provider on loopback, no OMO): before/after transcripts in the session record.

## Timeline

- 2026-11-10 [`ses_e3b5c833cffeNAR8nbTGc9S6Gx`](../sessions/2026-11-10-file-tool-metadata.md) - initial build, vt-421 on desktop and m4max. Evidence: `e563b42081`, merge `9911a26b09`.
- 2026-11-14 [Stored diff caps](../sessions/2026-11-14-stored-diff-caps.md), session [`ses_e26ade36cffe6IX1G9BDtSy0us`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e26ade36cffe6IX1G9BDtSy0us) - `d1fa02fa49` bounds edit/write/apply_patch permission and result previews; 143 tests pass and three package typechecks pass. Source-only upstream twin `abbf523742` is held in [queue entry 07](../pr-queue/07-stored-diff-caps.md); no binary build or restart.

## Current maintenance notes

- Any upstream change to the read envelope or footers conflicts in `read.ts`; keep the extra lines between `<type>` and `<content>` (the TUI's `readDisplay` slices from `<content>`).
- The upstream twin depends on the vt-397 fix's `resolveTarget`; both must go up together or in order.
- Stored previews use `capDiff` beside `trimDiff` in `tool/edit.ts`: 256 KiB per file, 1 MiB for apply_patch's combined `metadata.diff`, marker included. Preserve full-content addition/deletion counts and keep this cap on permission, interim and result metadata paths. The cap-only upstream twin is independent of the broader file-metadata feature.

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
