# messageID for the shell.env hook

## Identity

- Workday: 2026-10-08
- Session: `ses_ee26f677effe6fzY9wzepyBf13`
- Agent/platform: `Sisyphus - ultraworker` (anthropic/claude-opus-5-5, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode` (GitLab `origin`, GitHub `nowaker-github`)
- Integration branch: `dev-nowaker`
- Development branch(es): `shell-env-message-id` (worktree); upstream `shell-env-message`
- Upstream base: `907b3bc518` (contains `v1.18.34`); upstream PR branch on `388406238b`
- Source result commit(s): `6c3472125a`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` for the sudo prompt
work (`ses_ee292f99effed8oYaV2bZXAUH8`):

> The sudo backend needs, in every shell tool call's environment, the
> AUTHORITATIVE ids of that call.

## Goals

- `messageID` in the `shell.env` hook input for the shell tool and `!`.
- An upstream v1 PR with the v1-maintenance note first and the attribution
  line last.

## Constraints and non-goals

- PTY path unchanged. The primary checkout's uncommitted retry patch and
  `.gitignore` untouched.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `77b469563f` | `6c3472125a` | fast-forward from `shell-env-message-id`; pushed both remotes |
| `opencode` (GitHub fork + GitLab) | `shell-env-message` | - | `b005b94a86` | cherry-pick onto `github/dev` `388406238b`, no AI trailers; PR #54032 |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Pass messageID to the shell.env hook](../features/2026-10-08-shell-env-message-id.md) | new | focused tests, runtime test |

## Other delivered work

- opencode-tools `4111af4`: the spawn plugin's `shell.env` hook sets
  `VIBETERM_SESSION_ID`, `VIBETERM_MESSAGE_ID`, `VIBETERM_CALL_ID` and
  `VIBETERM_ROOT_SESSION_ID` per call.
- Comment on upstream #21767 linking PR #54032.

## Verification

- `test/tool/shell.test.ts -t shell.env` and `test/session/prompt.test.ts -t "shell (passes|captures|completes)"`
  with `--timeout 180000` (host load average ~91) - all pass; same on the
  upstream branch.
- `bun typecheck` in `packages/opencode` and `packages/plugin` - clean.
- opencode-tools `shell-env.runtime.test.ts` against `1.18.34-vt-187-907b3bc518` - pass.

## Build and install

- Build command: `~/projekty/webapps/opencode-build/build.sh` on both hosts,
  retry patch verified against the canonical patch first.
- Installed artifact: desktop `1.18.34-vt-187-907b3bc518` (built from
  `892b6c4dbb`, the same source tree before a rebase over the forklog-only
  `77b469563f`); m4max `1.18.34-vt-188-907b3bc518` (`6c3472125a`). The v2
  migration guard gate passed on both.
- Running services: no serve unit restarted; tabs pick the build up through
  `vibeterm_restart_tab`.

## Commit provenance

- `6c3472125a` - `feat(plugin): pass messageID to the shell.env hook`
- Required trailer: `AI-Session-ID: ses_ee26f677effe6fzY9wzepyBf13`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-08-shell-env-message-id.md
```

## Unknowns and blocked verification

- None.
