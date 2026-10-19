# 2026-10-18 - plugin seams: compacting hook prior summary, shell.env source

## Identity

- Workday: 2026-10-18 (started 2026-10-19 03:58 CDT, after midnight)
- Session: `ses_eac9cdf26ffeEPtXV2TXi0WMOu`
- Agent/platform: Sisyphus (opencode, `anthropic/claude-opus-5-5`) / linux (desktop)
- Repository: `~/projekty/webapps/opencode` (desktop)
- Integration branch: `dev-nowaker`
- Development branch(es): `compacting-hook-seams` (worktree `.vibeterm/worktrees/compacting-hook-seams`, cut from `dev-nowaker` `0a6d075e52`)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Source result commit(s): `e160264623`, integrated onto `dev-nowaker` `ea0e25b4b4` by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` after the user approved landing (2026-10-19)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> Extend the EXISTING `experimental.session.compacting` hook, additively

> `shell.env` hook input gains an optional `source: "tool" | "shell" | "pty"`.

From `ses_ebc8f2bc4ffehcETvBMsNJHPhX`:

> Required lossless delivery seam additive: TuiComposerDeliverRequest ... needs metadata?:Record<string,unknown> for SAME textpart metadata forwarding

## Goals

- A plugin can rewrite the prior summary the compaction prompt anchors to, knowing both models and what survives.
- A `shell.env` plugin can tell agent bash from a user `!` command and a user terminal.
- Prove that text-part metadata on a prompt is stored and never reaches the model (server side of the TUI delivery-metadata change, which the `tui-provenance` worktree implements).

## Constraints and non-goals

- Additive only: no hook, an untouched hook output, or a request without metadata behaves byte-identically.
- PTY env precedence unchanged. Fork-only, no upstream PR.
- No commit, push, install or restart.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode | `compacting-hook-seams` | `0a6d075e52` | uncommitted diff | worktree edits |
| opencode | `dev-nowaker` | `ea0e25b4b4` | `e160264623` | coordinator applied the frozen diff and committed it |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Let the compacting hook project the prior summary](../features/2026-10-18-compacting-hook-summary.md) | new | compaction tests |
| [Pass messageID to the shell.env hook](../features/2026-10-08-shell-env-message-id.md) | changed (`source`) | shell, prompt, PTY tests |

## Other delivered work

- Candidate binaries built in the worktree for isolated QA (not installed).
- A TUI delivery-metadata implementation (plugin type, `deliveryMetadata: true` capability, `createPromptSend` text part) was built and then withdrawn because the `tui-provenance` worktree already carries a fuller one. It is saved as `tmp/part-c-tui-composer-metadata.patch` in the worktree (untracked) for its capability flag.

## Verification

- `packages/opencode`: `test/session/compaction.test.ts` 62 pass, 0 fail on its first full run. A later full run under load average ~80 had 2 failures: "publishes compacted event on continue" timed out at 30s and passes alone; "does not leave a summary assistant when aborted before processor setup" fails identically on the unmodified checkout.
- `packages/opencode`: `test/tool/shell.test.ts`, `test/server/httpapi-pty.test.ts` and `test/server/httpapi-v2-pty.test.ts` gave 35 pass, 3 fail. The 3 failures are the zsh `external_directory` permission tests, which also fail on the unmodified checkout. `test/session/prompt.test.ts -t shell.env` 1 pass.
- `packages/opencode`: `prompt.test.ts` "stores a prompt text part's metadata without sending it to the model" passes with `--timeout 240000`. It timed out at the default 30s under load.
- `bun typecheck` in `packages/opencode` and `packages/plugin` - clean.

## Build and install

- Build command: `OPENCODE_VERSION=1.19.0-vt-361-dfb56f76c7-seams-candidate2 OPENCODE_INSTALL_METHOD=unknown bun ./script/build.ts --single` in `packages/opencode` (lockfile restored afterwards).
- Installed artifact: not installed; candidate at `packages/opencode/dist/opencode-linux-x64/bin/opencode` in the worktree.
- Running services: not restarted.

## Commit provenance

- `e160264623` feat(plugin): shell.env source and compacting hook summary seams
- Required trailer: `AI-Session-ID: ses_eac9cdf26ffeEPtXV2TXi0WMOu`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-18-fork-hook-seams.md
```

## Historical evidence carried forward

- None

## Unknowns and blocked verification

- Live QA of the candidate is owned by `ses_eaca897c8ffeIYP6pE4WlO6Iu4` (shell.env) and `ses_ebc8f2bc4ffehcETvBMsNJHPhX` (compaction, delivery).
