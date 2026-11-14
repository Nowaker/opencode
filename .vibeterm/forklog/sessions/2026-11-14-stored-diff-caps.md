# Bound stored file-edit diffs

## Identity

- Workday: 2026-11-14
- Session: [`ses_e26ade36cffe6IX1G9BDtSy0us`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e26ade36cffe6IX1G9BDtSy0us)
- Agent/platform: Sisyphus-Junior, `openai/gpt-6.1-sol` / Linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch: `cap-stored-diffs`, created with `vt-worktree-create` from fetched `origin/dev-nowaker` at `e15b236d4b3556ea88e5eeb0ad0a43e1dfa64672`
- Upstream queue branch: `stored-diff-upstream`, based on `github/v1` at `acc8c26da40f918e1ce222cb03c3342242c3ed6a`
- Fork source commit: `d1fa02fa49401fcc5eea013be221b47dc05dd653`
- Upstream source commit: `abbf523742eb6846495265e9d1076ac831fab6bf`
- Forklog commit: this file's introducing commit

## User request and evidence

> In the opencode fork (v1, ~/projekty/webapps/opencode, branch dev-nowaker), bound the size of the diffs that the file-editing tools store in tool-part metadata and permission metadata.

The reported apply_patch deletion result, part `prt_1d8e3deea001ezex5tnf3x3dZi` in session prefix `ses_e2796d9b4ffe` on m4max, was 392,459,917 bytes and drove session sync to 23 GB of memory. This session used the supplied evidence and did not inspect or mutate that database row.

## Delivered behavior

- `capDiff` beside `trimDiff` in `packages/opencode/src/tool/edit.ts` retains complete UTF-8 lines and one marker with the exact discarded byte and line counts. It encodes only a bounded prefix rather than allocating another full diff buffer.
- `MAX_FILE_DIFF_BYTES = 262144` bounds edit permission metadata, edit interim/result `diff` and `filediff.patch`, write permission metadata, and each apply_patch file patch. `MAX_TOTAL_DIFF_BYTES = 1048576` bounds apply_patch's combined permission/result `metadata.diff`.
- Additions and deletions come from full content, independently of previews. Deleted-file counts exclude the synthetic empty line after a trailing newline and count empty files as zero lines.
- Model-facing `output` is unchanged. The upstream twin retains upstream's plain write-success string; the fork test retains the fork's existing byte-count string.
- TUI split and unified diff rendering already catches invalid partial hunks and displays the raw patch, including the truncation marker. Session UI normalization already catches partial-hunk parse failures and preserves the filename and exact counts with an empty hunk list. CLI projection forwards the bounded strings. No renderer production code changed.

## Verification

The nine new tool regression cases first failed on the unmodified producers for exceeding their byte bounds. These cover 20 MiB apply_patch add, update, delete and move; edit creation and replacement; write creation and overwrite; and a six-file combined diff. Helper tests cover a boundary-sized diff, UTF-8 byte/line counts with and without a trailing newline, and one oversized line.

Suites ran one at a time without increasing their timeouts. Run from each named package:

| Package | Command | Fork result | Upstream queue result |
|---|---|---|---|
| `packages/opencode` | `bun run test test/tool/cap-diff.test.ts` | 4 pass, 0 fail | 4 pass, 0 fail |
| `packages/opencode` | `bun run test test/tool/apply_patch.test.ts` | 38 pass, 0 fail | 33 pass, 0 fail |
| `packages/opencode` | `TMPDIR=/var/tmp bun run test test/tool/edit.test.ts` | 38 pass, 0 fail | 31 pass, 0 fail |
| `packages/opencode` | `TMPDIR=/var/tmp bun run test test/tool/write.test.ts` | 26 pass, 0 fail | 17 pass, 0 fail |
| `packages/session-ui` | `bun test src/components/session-diff.test.ts` | 11 pass, 0 fail | 11 pass, 0 fail |
| `packages/tui` | `TMPDIR=/var/tmp bun run test test/cli/tui/inline-tool-wrap-snapshot.test.tsx` | 26 pass, 8 snapshots, 0 fail | 19 pass, 8 snapshots, 0 fail |

- Totals: fork 143 pass, upstream queue 115 pass; 0 failures in the successful runs.
- `bun typecheck` passed separately in `packages/opencode`, `packages/tui` and `packages/session-ui` on both branches. Both upstream branch push hooks also reported 30 successful typecheck tasks.
- Changed-file LSP diagnostics were clean in the fork. `check-test-junk.ts` reported no findings. `git diff --check` passed.
- Resource preflight samples stayed above the required 30 GB MemAvailable with memory PSI full avg60 below 5 before the broad checks; the upstream run began with 71,714,524 kB available and full avg60 0.39.
- The initial full edit suite under the inherited repository-local TMPDIR exposed its two already-documented symlink fixture failures. The suite passed unchanged with OS scratch at `/var/tmp`; see the existing note in the linked feature record. The apply_patch regression fixture was given its own Git repository so its exact output paths are independent of the surrounding checkout.

## Integration and queue

- `dev-nowaker` fast-forwarded from `e15b236d4b` to `d1fa02fa49`; no rebasing, history rewriting or force pushing.
- The upstream twin resolves only the import conflict caused by the fork's `FileFacts` customization and changes the write regression's expected string to upstream's existing output.
- [Queue entry 07](../pr-queue/07-stored-diff-caps.md) contains the ready-to-file title, body and command. The upstream branch was pushed to both remotes; no PR was filed.
- [File tool metadata](../features/2026-11-10-file-tool-metadata.md) records the shared maintenance seam and links back to this session.

## Constraints and provenance

- No binary build or installation, process restart, existing database-row edit, upstream PR or `.gitignore`/retry edit was performed. The coordinator owns binary scheduling.
- The source commits' `AI-Harness` suffix was mistakenly stamped `2590d941e58`; the session's actual harness stamp is `Vibeterm 66db936f9ac`. The tool, model, platform and full session ID identify the session correctly; protected history is preserved.
- Managed checkouts are retired through `vt-worktree-retire` after publication; source branches and the queue head remain available.
