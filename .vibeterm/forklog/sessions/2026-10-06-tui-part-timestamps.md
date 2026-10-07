# Choose which transcript entries show timestamps

## Identity

- Workday: 2026-10-06
- Session: `ses_eec3e5569ffe2otGPxp4LBssZb`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-part-timestamps` (`da278a9c97`, on `tui-turn-timing` `b14b75e5d8`); landing branch `part-timestamps-land`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `9163ac0f36` (cherry-pick of `da278a9c97`)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 18 of its
"opencode TUI improvements" effort), quoting the user:

> i noticed tool calls are missing datetimes; since that is different from ai
> responses, it should have a separate switch to whether include them or not.
> default: no, here: yes. include all time stamps etc. on tool calls, and if
> other message types aren't getting their dates, they should get them also,
> for consistency. maybe a single knob with a list of message types that get
> them or not, with a sane default that matches today's opencode, also 'all',
> or a comma delimited list of message types that get them. config docs to
> explain all available values. (does tui.conf come with comments in jsonc? if
> so, include options there)

## Goals

- One setting listing which entry types get timestamps; default identical to
  today's rendering; `all` on both hosts.

## Constraints and non-goals

- Existing `/timestamps`, `/turn-times`, `turn_timing` configs and kv values
  keep working.
- No TUI tab, serve unit or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` (GitHub fork + GitLab) | `tui-part-timestamps` | - | `da278a9c97` | new branch on `tui-turn-timing`; head of PR #53654 |
| `opencode` | `dev-nowaker` | `c602afcb13` | `9163ac0f36` + this forklog commit | cherry-pick (schema and session-route conflicts resolved by keeping both sides), fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Choose which transcript entries show timestamps](../features/2026-10-06-tui-part-timestamps.md) | introduced | tests, typecheck, before/after tmux frames |
| [Per-turn completion time and duration in the TUI](../features/2026-10-04-tui-turn-timing.md) | extended: `timestamps` overrides `turn_timing.time` when set | `after-all` frame with a stale kv; unset frames identical |

## Other delivered work

- Upstream: design comment on the existing request
  [#42498](https://github.com/anomalyco/opencode/issues/42498#issuecomment-6028995049)
  instead of a duplicate issue; PR
  [#53654](https://github.com/anomalyco/opencode/pull/53654), stating it
  builds on #53195.
- Host config: `"timestamps": "all"` added to `~/.config/opencode/tui.json`
  on desktop and m4max by a jsonc-parser `modify` plus temp-file rename;
  `diff` against a copy shows only that key added, and both files parse.

## Verification

- `bun typecheck` in `packages/tui` and `packages/opencode` - exit 0.
- Tests: see the feature record (31 pass in `packages/tui`; 4 known
  plugin-merge failures in `packages/opencode/test/config/tui.test.ts`).
- Pre-push hook (`bun turbo typecheck`) 30/30 on every push.

## Build and install

- desktop: `.vibeterm/build.sh` from the primary checkout at `9163ac0f36`
  (with the uncommitted retry-header cap); installed
  `1.18.34-vt-130-907b3bc518`, inode `49963233`. The binary contains the
  `timestamps` schema description and `OPENCODE_RETRY_MAX_HEADER_DELAY_MS`.
  `opencode-serve-tailscale` (PID 1507297) and `opencode-serve-lan` (PID
  1509289) kept their PIDs and start times.
- m4max: checkout fast-forwarded to `9163ac0f36`; `.vibeterm/build.sh`
  installed `1.18.34-vt-130-907b3bc518` at
  `/Volumes/projects/webapps/opencode-build/bin/opencode` (inode `21723457`)
  with the same two markers.
- Running TUIs pick the feature up on their next restart.

## Commit provenance

- `9163ac0f36` - TUI change, docs, tests.
- Required trailer: `AI-Session-ID: ses_eec3e5569ffe2otGPxp4LBssZb`

## Unknowns and blocked verification

- On desktop, `packages/opencode` typecheck resolved `@types/node` 25.9.2
  from the ambient `~/node_modules` (no hoisted `node_modules/@types/node`
  in the checkout), failing `src/bus/global.ts` TS2416 on any branch off
  upstream `dev`. A symlink `node_modules/@types/node` ->
  `.bun/@types+node@24.12.2/...` in the worktrees and the primary checkout
  (ignored, local only) restored the pinned version; the hook then passed
  30/30.
