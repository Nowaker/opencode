# TUI composer read for native draft persistence

## Identity

- Workday: 2026-09-27
- Session: `ses_f19bcd194ffecw7EE6UaCiWdxI`
- Agent/platform: Sisyphus (`anthropic/claude-opus-5-5`) / Linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/tui-composer-read` (worktree
  `/home/nowaker/projekty/webapps/opencode-composer-read`)
- Upstream base: `2406400f0` (upstream `dev`, contains `v1.18.32`); no upstream
  upgrade
- Source result commit(s): `2638af5a71` (fast-forward)
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_f19c07ea0ffe0BXye8vomz4ZzU`:

> Text typed into OpenCode's NATIVE TUI prompt/composer must be recoverable
> after the opencode process dies abnormally (OOM kill, `kill -9`, tmux crash,
> reboot), for both an existing session and a brand-new session that has never
> submitted anything (no session row yet).

## Goals

- Expose what the composer holds to TUI plugins, and let `replace()` restore
  parts, so the vibeterm route plugin can keep and restore drafts.

## Constraints and non-goals

- The uncommitted retry-header patch in the primary checkout stayed untouched.
- No restart of `opencode-serve-tailscale`, `opencode-serve-lan`, or any tab.
- Draft storage and restore policy live in `opencode-tools`, not the fork.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `a5e3cc8d81` | `2638af5a71` | fast-forward merge of `feat/tui-composer-read` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [TUI composer read and part-preserving replace](../features/2026-09-27-tui-composer-read.md) | introduced | prompt-control 20 pass, installed e2e |

## Other delivered work

- `opencode-tools` branch `feat/opencode-native-drafts`: draft keeper in the
  route plugin, `_lib/vibeterm-native-drafts` store, relaunch/restore/sidebar
  recovery. See `opencode-tools/docs/opencode-native-drafts.md`.

## Verification

- `bun test test/prompt-control.test.ts` (packages/tui) - 20 pass.
- `bun test test/cli/tui/plugin-composer.test.ts` (packages/opencode) - 1 pass.
- `bunx tsc --noEmit -p .` (packages/tui) - 11 errors, all pre-existing in
  `dialog-move-session.tsx`, same count before the change.
- `opencode-tools` `native-drafts.e2e.test.ts` with
  `NATIVE_DRAFT_TEST_OPENCODE=~/projekty/webapps/opencode-build/bin/opencode` -
  1 pass (kill -9 and kill-server, session and sessionless tabs).

## Build and install

- Build command: `~/projekty/webapps/opencode-build/build.sh`
- Installed artifact: `1.18.32` at `~/projekty/webapps/opencode-build/bin/opencode`,
  byte-identical (`cmp`) to `packages/opencode/dist/opencode-linux-x64/bin/opencode`
  built from `2638af5a71`.
- Running services: `opencode-serve-lan` PID 3878683 and
  `opencode-serve-tailscale` PID 3879113, start times unchanged across the build.

## Commit provenance

- `2638af5a71` - composer read and `promptParts` replace.
- Required trailer: `AI-Session-ID: ses_f19bcd194ffecw7EE6UaCiWdxI`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-09-27-tui-composer-read.md
```

## Unknowns and blocked verification

- The PATH `opencode` is the Arch package (`/usr/bin/opencode` 1.18.31), which
  lacks `api.prompt.read()`; tabs launched with it keep no drafts. Vibeterm
  selects its binary through its own setting.
