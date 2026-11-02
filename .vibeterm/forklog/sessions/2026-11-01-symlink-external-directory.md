# Symlink external_directory check and dangling-link read message

## Identity

- Workday: 2026-11-01 (work continued past midnight into 2026-11-02 CST)
- Session: `ses_e6489be9fffe4C9rbuuFTkKk1E` (spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`)
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (`high`) / `linux`
- Repository: `~/projekty/webapps/opencode`; m4max `/Volumes/projects/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `symlink-external-dir` (managed worktree, cut from `github/v1`), `symlink-external-dir-merge` (cut from `dev-nowaker`), m4max `symlink-external-dir-install` (clean build check), `symlink-external-dir-v2` (cut from `github/dev`, no commits)
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `b6bdc91b38` (fix, no AI trailers), `1511b34f5a` (merge)
- Forklog commit: this file's introducing commit

## User requests

> is it opencode bug? if so, PR to v1 and v2, since this is critical. they don't accept v1 patches any more unless critical - this is critical.

> it isn't critical per se but still buggy link resolution behavior, so i would 'sneak' it together with the security PR.

## Goals

- In-project symlinks that resolve outside the project prompt `external_directory` in every file tool. A dangling-link read names the link's target.

## Constraints and non-goals

- Upstream branch without AI trailers. Merge into `dev-nowaker`, never force-push. Preserve the dirty retry cap and `.gitignore` edit.
- Do not open the PR or advisory. Do not restart tabs, Vibeterm or Meridian. Leave the other file-metadata proposals alone.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `symlink-external-dir` | `006d837c50` | `b6bdc91b38` | commit; not pushed (disclosure route pending) |
| `opencode` | `dev-nowaker` | `d4f44efeef` | `1511b34f5a` | fast-forward from `symlink-external-dir-merge`; pushed to `origin` and `nowaker-github` |
| `opencode` (m4max) | `dev-nowaker` | `d4f44efeef` | `1511b34f5a` | fast-forward from `origin`; dirty diff hash unchanged (`5f31ad51`) |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Prompt external_directory for symlinks that resolve outside the project](../features/2026-11-01-symlink-external-directory.md) | introduced | tests below |

## Other delivered work

- v2 investigation (`github/dev` `ff90ed9160`): same bypass in `FileAccess.resolve`, deliberately lexical since PR #38180. The same dangling-link self-suggestion exists in `ReadTool.missing` (`tool/plugin/read.ts`), and the v2 `Environment.Files` contract has no `readLink`/`realPath`. No v2 commit yet. Route questions `qst_19b7f8441001wRQSTCCHZMkRyw` (disclosure) and `qst_19b9d8d73001szjATMmdH43nOz` (v2 scope) are pending.
- Disclosure material (not submitted): `.vibeterm/tmp/opencode/pr-body-symlink-external-dir-v1.md`, `issue-symlink-external-dir.md`, `advisory-notes-symlink-external-dir.md`.

## Verification

- `github/v1` worktree, from `packages/opencode`, `TMPDIR=/tmp/oc-symlink-tests`: with `external-directory.ts` and `read.ts` restored to `006d837c50`, the new tests fail 14/14 (external-directory 4, read 2, write 3, edit 2, apply_patch 1, glob 1, grep 1); the other 127 tests in those files pass. With the fix, the `external-directory`, `read`, `write`, `edit`, `apply_patch`, `glob`, `grep` and `lsp` suites pass 145/145.
- Merge worktree: the same 145/145; `bun typecheck` clean in both worktrees; prettier clean on changed files.
- `test/tool/shell.test.ts` fails 2/23 on unchanged `github/v1` too (zsh timeouts); untouched.
- With the inherited in-repo `TMPDIR`, the "outside" fixtures land inside the opencode checkout's worktree. Run the symlink tests with `TMPDIR` outside any repository.

## Build and install

- Command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard ~/projekty/webapps/opencode-build/build.sh` from each primary checkout at `1511b34f5a` (dirty retry cap included, identical to the canonical patch), Bun 1.4.4. The v1 database guard gate passed on both hosts (8 ok).
- Desktop: `1.19.5-vt-397-006d837c50`, inode `49970041`, SHA-256 `74ca6322f3068e4b4e7fb3494e499c4c6b198eee969f9f07a324e57592f9289a`, retry marker present. A clean-worktree build ran first and was superseded, so the archived `.prev-*` binaries include it.
- m4max: `1.19.5-vt-397-006d837c50`, inode `53747724`, SHA-256 `64060198c3e2646551d3694dc989285e3426b23e7fcb1611812ee1344c4cc1f1`, retry marker present. A clean `symlink-external-dir-install` build ran first and was superseded.
- The previous installed vt-394 (clean-source apply-revert build) had no retry marker; vt-397 restores it.
- Desktop serve units before and after: tailscale MainPID `0`, start `Fri 2026-10-16 03:05:06 CDT`; LAN MainPID `0`. Nothing was restarted.

## Commit provenance

- `b6bdc91b38` - upstreamable fix, human identity, no AI trailers.
- `1511b34f5a` - merge with full AI trailers.
- Required trailer: `AI-Session-ID: ses_e6489be9fffe4C9rbuuFTkKk1E`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-01-symlink-external-directory.md
```

## Unknowns and blocked verification

- No installed-binary agent run through a symlink. The installed check is version, inode, hash and retry marker; behavior is covered by the source tests.
- The disclosure route and the v2 scope wait on the pending questions above.
