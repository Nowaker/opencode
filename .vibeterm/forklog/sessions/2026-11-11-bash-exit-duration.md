# Time a background bash exit from spawn to exit

## Identity

- Workday: 2026-11-11
- Session: [`ses_e3b66e073ffeBjngD0B2e6LCl8`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b66e073ffeBjngD0B2e6LCl8)
- Agent/platform: `Sisyphus - ultraworker` (`anthropic/claude-opus-5-5`, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/bash-background`
- Upstream base: `006d837c50` (`v1.19.5`, `github/v1`)
- Source result commit(s): `2e8e50f138`, merge `60daedd693`
- Forklog commit: this file's introducing commit

## User requests

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), bug 4 of the package's bug list: "Bash exit notice duration is measured to notice delivery, not to process exit (`sleep 5; exit 3` reported 41s)."

## Goals

- The `[BASH COMMAND ...]` notice reports how long the process ran.

## Constraints and non-goals

- The background limit (`bash_background.timeout`) keeps counting from the call.
- Keep the uncommitted retry-header cap in both main checkouts.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `feat/bash-background` | `5cc30c46fb` | `2e8e50f138` | commit |
| `opencode` | `dev-nowaker` | `28c40637aa` | `60daedd693` | merge |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Run bash commands in the background and move a timed-out one there](../features/2026-11-10-bash-background.md) | changed | `shell-background.test.ts` red/green below |

## Other delivered work

- None in this repository. The same session fixed OMO bugs 1 and 7 on the OMO fork the same day.

## Verification

- Cause, from the demo session [`ses_e385330dbffecE52YqOIuWaTHZ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e385330dbffecE52YqOIuWaTHZ): in the same turn, `date -u; sleep 8` started as a tool call at +14.2 s and printed its first date at +39 s, so spawning took about 25 s on the loaded host; `durationMs` was `Date.now() - startedAt` at publish, with `startedAt` the call's start.
- `bun test test/tool/shell-background.test.ts` with a spawner wrapped to take 3 s - red: `Expected: < 3000, Received: 3218`, 6 pass 1 fail; green after the fix: 7 pass, also on the merge.
- `test/tool/shell.test.ts`: the 3 `[zsh]` external-directory permission tests fail with and without the fix (the base also fails a 4th, the shell.env ids test).
- `bun run typecheck` in `packages/opencode` - clean on the branch and the merge.
- Live, isolated (OMO `feat-cc-tools-step4` `run-bash.sh bgexit`, this branch's server from source, scratch XDG + HOME, fake LLM): `echo first; sleep 2; echo second; exit 3` reported "Background command failed with exit code 3 after 2s"; sandbox session rows in the real DB 0; no server left.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` from each main checkout at `60daedd693`, with the uncommitted retry-header cap in place.
- Installed artifact: `1.19.5-vt-445-006d837c50` on desktop (inode 49985163) and m4max (inode 56782562); v2 guard gate PASSED on both; `.vibeterm/smoke.sh <binary>` SMOKE OK on both.
- A first m4max build ran on the old `ad94a7b36dc` because `git pull --ff-only` there has no upstream branch; it was stopped in the guard gate before installing (the installed vt-442 was untouched), and the checkout was pulled with `git pull --ff-only origin dev-nowaker`.
- Running services were not restarted.

## Commit provenance

- `2e8e50f138` - fix; `60daedd693` - merge.
- Required trailer: `AI-Session-ID: ses_e3b66e073ffeBjngD0B2e6LCl8`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-11-bash-exit-duration.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- The 25 s spawn delay itself was not reproduced live; the test injects a 3 s spawn delay.
