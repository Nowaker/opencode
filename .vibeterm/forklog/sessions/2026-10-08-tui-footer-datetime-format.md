# Date and time format, each message ID once, and the hint line footer

## Identity

- Workday: 2026-10-08
- Session: `ses_ee68aab01ffei41gwUGJ5ESj6W`
- Agent/platform: `Sisyphus - ultraworker` (anthropic/claude-opus-5-5, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode` (GitLab `origin`, GitHub `nowaker-github`)
- Integration branch: `dev-nowaker`
- Development branch(es): `footer-elements` (worktree); upstream `tui-footer-elements`
- Upstream base: `907b3bc518` (contains `v1.18.34`); upstream stack on `663fbd7573`
- Source result commit(s): `42ce3944c3`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, from the user on
vt-177 with every footer key `"all"`:

> we should only keep this info once.

> allow me to define my datetime format. and set it for me to:
> YYYY-MM-DD HH:MM:SS, defaults to be what opencode does. (continue to skip
> date if date is today)

> let's do instead: `Click to expand · 2:18 PM · 4.8s · msg_...`

## Goals

- A message ID shows once per message: on the assistant footer, and on a
  tool call only when that footer does not show it.
- `datetime_format` in `tui.json`; unset output unchanged; `YYYY-MM-DD` and
  `HH:mm:ss` on both hosts.
- A block tool's expand/collapse hint carries the footer on the same line;
  clicking the hint still toggles, clicking a `msg_` still copies.

## Constraints and non-goals

- Never touch the primary checkout's uncommitted retry patch or `.gitignore`.
- No serve or tab restarts.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `e23cc19484` | `42ce3944c3` | fast-forward from `footer-elements`; pushed both remotes |
| `opencode` (GitHub fork + GitLab) | `tui-footer-elements` | `cc947a75a7` | `2b2a43d6db` | change folded into the feature commit, no AI trailers; force-with-lease both remotes; PR #53877 body updated |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Choose every message footer detail the same way](../features/2026-10-07-tui-footer-elements.md) | extended: `datetime_format`, message ID once, hint line | tests, isolated captures, mouse clicks |
| [Choose which transcript entries show timestamps](../features/2026-10-06-tui-part-timestamps.md) | extended: entry timestamps follow `datetime_format` | `fmt` capture |
| [Per-turn completion time and duration](../features/2026-10-04-tui-turn-timing.md) | extended: turn times follow `datetime_format`, date-first on other days | `locale.test.ts` |

## Other delivered work

- Vanilla upstream `dev` (`388406238b`): no date/time option; Bun prints
  `11:21 PM 10/7/2026` with `LANG`/`LC_TIME=de_DE.UTF-8` too.
- Host config: `"datetime_format": {"date": "YYYY-MM-DD", "time":
  "HH:mm:ss"}` in `~/.config/opencode/tui.json` on desktop and m4max by a
  jsonc-parser `modify` plus temp-file rename; only `datetime_format` changed.
  Decoded with the new schema, both render `2026-10-07 14:20:07` for an older
  entry and `16:07:41` for today.

## Verification

- `bun typecheck` in `packages/tui` exit 0; full suite 368 pass, 1 skip,
  0 fail; upstream stack 51 focused tests pass; pre-push hook 30/30.
- Manual surface: see the feature record's `42ce3944c3` verification entry.

## Build and install

- desktop: `.vibeterm/build.sh` at `42ce3944c3` (retry patch sha1 matches the
  canonical patch): `1.18.34-vt-180-907b3bc518`, inode `49946746`, with the
  `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` and `datetime_format` schema markers.
  `opencode-serve-tailscale` (PID 2451613) and `opencode-serve-lan` (PID
  2451599) kept their PIDs and start times.
- m4max: checkout fast-forwarded to `42ce3944c3`; `1.18.34-vt-180-907b3bc518`,
  inode `22236352`, same markers and matching retry patch.
- Running TUIs pick it up on their next restart.

## Commit provenance

- `42ce3944c3` - `datetime_format`, message ID once, hint line footer.
- Required trailer: `AI-Session-ID: ses_ee68aab01ffei41gwUGJ5ESj6W`

## Unknowns and blocked verification

- GitHub keeps PR #53877's head at `cc947a75a7` because the PR is closed; the
  branch holds `2b2a43d6db`.
