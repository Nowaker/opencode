# Show and load the messages a long session hides

## Identity

- Workday: 2026-10-06
- Session: `ses_eec5b71ddffe4A47jCysfkQh6l`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-history-crop` (`525471e9a2`, the upstream PR head); landing branch `tui-history-land`
- Upstream base: `ecc4916b5a` (upstream `dev`) for the PR; `dev-nowaker` stays on `907b3bc518`
- Source result commit(s): `fcf142f4c4` (cherry-pick of `525471e9a2`)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as item 12 of the
"opencode TUI improvements" effort; the user's words are quoted in the
[feature record](../features/2026-10-06-tui-history-crop.md#original-request).

## Goals

- Answer what the TUI's scrollback limit is and make it a `tui.json` setting.
- Keep the first prompt visible when history is cropped (default on).
- A divider wherever messages are hidden, with portal-style load actions.
- Measure RSS and idle CPU at half, default and double the limit.

## Constraints and non-goals

- Measurements ran against a `VACUUM INTO` copy of the live database in the
  worktree's `tmp/`, never the live `opencode.db`; `.backup` was abandoned
  after it restarted from scratch whenever the live database was written.
- Host `tui.json` left unchanged: `max_messages` stays at its default and
  `keep_first_prompt` defaults to `true`.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `tui-history-crop` | - | `525471e9a2` | new branch on `ecc4916b5a`; pushed to `nowaker-github` and `origin` |
| `opencode` | `dev-nowaker` | `a04c68d8e2` | `fcf142f4c4` + this forklog commit | cherry-pick on `tui-history-land` (conflicts in `config/index.tsx` and `tui.mdx`, adjacent additions, kept both; `sync-scroll-anchor.test.tsx` now mounts `TuiConfigProvider`), fast-forward; pushed to both remotes. Another session then landed `2333a1edb1` on top |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Show and load the messages a long session hides](../features/2026-10-06-tui-history-crop.md) | introduced | `fcf142f4c4`; store and pagination tests; tmux captures |
| [Keep a scrolled-up reader's place in a long session](../features/2026-10-04-scroll-anchor.md) | re-verified | `sync-scroll-anchor.test.tsx` passes with the gap store; a load below the viewport leaves 19 viewport rows unchanged on the installed build |

## Other delivered work

- Upstream: issue [#53642](https://github.com/anomalyco/opencode/issues/53642) and
  PR [#53660](https://github.com/anomalyco/opencode/pull/53660), with the
  measurement table and a note offering `keep_first_prompt` default `false`.
- Pushes go through `bwrap --tmpfs /home/nowaker/node_modules` so the husky
  pre-push typecheck does not pick up the ambient `@types/node`.

## Verification

- See the feature record's Verification and Measurements sections.
- `bun typecheck` and `bun test` in `packages/tui` on the landing branch:
  290 pass, 0 fail.

## Build and install

- Build command: `~/projekty/webapps/opencode-build/build.sh` on desktop at
  `fcf142f4c4`; `.vibeterm/build.sh` on m4max after fast-forwarding its
  checkout to `2333a1edb1` (this commit plus `sidebar.session_id`).
- Installed artifact: desktop `1.18.34-vt-135-907b3bc518` (inode
  `49955682`), m4max `1.18.34-vt-136-907b3bc518` (inode `21729142`); both
  contain `messages_hidden_above` and the retry-header marker.
- Retry-header cap: the dirty diff's hunks matched the canonical patch before
  the build.
- Running services: none restarted; `opencode-serve-tailscale` PID `1507297`
  and `opencode-serve-lan` PID `1509289` unchanged across the build.

## Commit provenance

- `fcf142f4c4` - settings, gap store, divider, load commands, paged-route
  directions.
- Required trailer: `AI-Session-ID: ses_eec5b71ddffe4A47jCysfkQh6l`

## Unknowns and blocked verification

- One measurement run per row on a loaded desktop; `branch-100` was rerun
  because a pre-push typecheck overlapped the first run.
- No real-terminal screenshots yet; the PR has a slot for them.
