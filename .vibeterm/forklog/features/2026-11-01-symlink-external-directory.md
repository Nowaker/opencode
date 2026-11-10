# Prompt external_directory for symlinks that resolve outside the project

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `symlink-external-dir` (upstreamable, on `github/v1`, local only until the disclosure route is decided), merged through `symlink-external-dir-merge`
- First local commit: `b6bdc91b38`
- Current local commit(s): `b6bdc91b38`, merge `1511b34f5a`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> is it opencode bug? if so, PR to v1 and v2, since this is critical. they don't accept v1 patches any more unless critical - this is critical.

and for the dangling-link message:

> it isn't critical per se but still buggy link resolution behavior, so i would 'sneak' it together with the security PR.

## Goals

- `read`, `write`, `edit`, `apply_patch`, `glob`, `grep` and `lsp` prompt for `external_directory` when a path inside the project resolves outside it through a file link, a linked parent directory, a link into another repository, or a dangling link (whose target `write` would create).
- Reading a dangling link says `File not found: <path> is a symbolic link to <target> (<abs target>), which does not exist.` instead of suggesting the link itself.

## Non-goals

- The other file-metadata items in opencode-tools `docs/research/2026-11-01-file-tool-metadata.md` (symlink facts on read, byte sizes, stale-read guard, write-through-link policy) wait on the user's decision.
- Paths written outside the project keep their written form; one-hop escapes from an already-approved external alias are not re-checked.

## Rationale and constraints

- `assertExternalDirectoryEffect` compared only the written path with the project, so an in-project link escaped the prompt (research doc section 2, last row).
- Paths written outside the project keep their written form. The upstream grep test `does not ask for external_directory when alias path is allowed` pins `external_directory` rules on an alias.
- Resolution follows every link, including a dangling final one, and caps hops at 40 (Linux MAXSYMLINKS) so cycles terminate. A cycle resolves to the written path, and the operation itself then fails with ELOOP.
- Upstream v2 (`packages/core/src/file-access.ts`) is lexical by design: PR #38180 (2026-07-21, requested by maintainer rekram1-node) removed the resolved-path `location_escape` rejection, and two v2 tests pin it. Upstream SECURITY.md calls the permission system "a UX feature" with sandbox escapes out of scope.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `b6bdc91b38` | 2026-11-01 | Resolve in-project paths through symlinks before the external check | `assertExternalDirectoryEffect`, `resolveTarget` in `tool/external-directory.ts` |
| `b6bdc91b38` | 2026-11-01 | Dangling-link read message | `ReadTool.miss` in `tool/read.ts` (`fs.readLink`) |
| `b6bdc91b38` | 2026-11-01 | Tests | `external-directory.test.ts` `symlinks`, `symlinks` blocks in `read`/`write`/`edit`/`apply_patch`/`glob`/`grep` tests |
| `1511b34f5a` | 2026-11-01 | Fork merge, no conflicts | - |

## Verification

See [the session record](../sessions/2026-11-01-symlink-external-directory.md#verification).

## Timeline

- 2026-11-01 [`ses_e6489be9fffe4C9rbuuFTkKk1E`](../sessions/2026-11-01-symlink-external-directory.md) - initial build on `github/v1`, merge into `dev-nowaker`, install on desktop and m4max. Evidence: `b6bdc91b38`, `1511b34f5a`.
- 2026-11-10 [`ses_e3b5c833cffeNAR8nbTGc9S6Gx`](../sessions/2026-11-10-file-tool-metadata.md) - re-verified: its symlink tests pass on the merged file-metadata tree with `TMPDIR=/tmp`; `resolveTarget` is now exported and reused by `tool/file-facts.ts`, and the upstream twin `file-metadata-upstream` stacks on `b6bdc91b38`. Evidence: `e563b42081`, merge `9911a26b09`.

## Current maintenance notes

- Focused tests, from `packages/opencode`, with `TMPDIR` outside any git repository (this host's `.vibeterm/tmp` sits inside the opencode checkout, which turns "outside" fixtures into worktree-internal paths): `TMPDIR=/tmp/oc-symlink-tests bun test test/tool/external-directory.test.ts test/tool/read.test.ts test/tool/write.test.ts test/tool/edit.test.ts test/tool/apply_patch.test.ts test/tool/glob.test.ts test/tool/grep.test.ts test/tool/lsp.test.ts`.
- Upstream PR material (not submitted): `.vibeterm/tmp/opencode/pr-body-symlink-external-dir-v1.md`, `issue-symlink-external-dir.md`, `advisory-notes-symlink-external-dir.md`.
- If upstream v1 adopts v2's `FileAccess`, re-check: v2 authorizes by lexical path on purpose.

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
