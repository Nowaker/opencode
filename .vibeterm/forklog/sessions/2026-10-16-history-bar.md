# 2026-10-16 - long-session memory benchmark and the three-row hidden-messages bar

## Identity

- Workday: 2026-10-16
- Session: `ses_eec5b71ddffe4A47jCysfkQh6l`
- Agent/platform: Sisyphus (opencode, `anthropic/claude-opus-5-5`, variant high) / linux (desktop)
- Repository: `~/projekty/webapps/opencode` (desktop), `~/projects/webapps/opencode` (m4max)
- Integration branch: `dev-nowaker`
- Development branch(es): `history-bar` (worktree, cut from `tui-history-crop` `7661b165d6`), pushed as `tui-history-crop`; landing branch `history-bar-land`
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Source result commit(s): `3f2116de60` on `tui-history-crop`; `f25a2b83a7` (cherry-pick) on `dev-nowaker`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> what is opencode tui's usage when session is open? find 10 long session, not a coordinator one because they don't have that uch file edits. find a session, load it, check how much it uses. then load it with half of data loaded (however data is defined, wgether it;s number of messages loaded, or by limit, whatever). compare memory usage.
>
> > ─ 3,249 messages hidden ───────────────────────────────────────────────────────────────────
> > load 50 above   load 50 below   load all
>
> change to:
> ```
>                    load 50 above   load 100 above
> ---------------- 3,250 messages hidden:  load all (slow / memory heavy) -------------------
>                    load 50 below   load 100 below
> ```
> we'll do load all, or load all (slow), or load all (memory heavy) - based on your benchmark. check a session like this that has 3k+ - how much memory it uses on load all. if memory heavy - choose that. if it's cpu slow - mark that. if both, we'll say slow and memory heavy.

## Goals

- Measure TUI memory for a long session at the default window, half the window, and after load all.
- Replace the hidden-messages bar with the three-row layout and a load-all label chosen from the measurements.

## Constraints and non-goals

- The live database was only read: indexed queries under `timeout`, opened `mode=ro`, rows of the 10 sessions copied into a scratch database.
- Host `tui.json` unchanged; no tab, serve unit or vibeterm tmux server restarted.

## Benchmark

Ten non-coordinator sessions with the most file-tool calls (`read`, `edit`, `write`, `apply_patch`, `grep`, `glob`, `multiedit`), nine with 3,000+ messages. Selection used `message_session_time_created_id_idx` (covering scan, 0.1 s) and `part_session_idx` (`EXPLAIN QUERY PLAN`: `SEARCH part USING COVERING INDEX`). Their rows (53,873 messages, 228,928 parts) went into an 853 MB scratch database with the schema, migration and project tables, triggers created after the rows.

Installed `1.19.0-vt-322-dfb56f76c7`, scratch `XDG_*`, `OPENCODE_TOOLS_DATA_DIR`, `OPENCODE_PLUGINS_DATA_DIR`, throwaway tmux socket `oc-tui-bench` at 160x50, one run at a time, on the desktop at load average 50-65 (18 cores). "Half" is the real mechanism: `transcript.max_messages` 50 against the default 100. RSS is the TUI process `VmRSS` once it is idle. Load all was pressed with the divider on screen; "transcript shown" is until the rule leaves the screen, "back to idle" the first 2 s window under 15% of a core.

| Session | Messages | Parts | DB bytes | RSS half (50) | RSS default (100) | RSS after load all | Load all: transcript shown | Load all: back to idle | CPU-s to idle |
|---|---|---|---|---|---|---|---|---|---|
| `ses_19acecfc9ffeLwGYd7kS56G7wf` | 13,261 | 45,052 | 48 MB | 665 MB | 828 MB | 5,162 MB | 164 s | 248 s | 120 |
| `ses_fafa47d08ffentT1bIhM9Y4Op6` | 7,152 | 33,798 | 107 MB | 711 MB | 747 MB | 3,902 MB | 80 s | 255 s | 115 |
| `ses_007f2e82fffemOY8Cw5giLUCV1` | 4,310 | 20,262 | 126 MB | 882 MB | 867 MB | 3,215 MB | 61 s | 433 s | 178 |
| `ses_2907c1bb8ffea6dho411fHEE29` | 6,417 | 24,231 | 67 MB | 785 MB | 831 MB | 3,039 MB | 58 s | 62 s | 28 |
| `ses_fb51fe851ffe15yH0Zgs2zqHby` | 4,227 | 22,585 | 63 MB | 774 MB | 706 MB | 3,404 MB | 47 s | 136 s | 53 |
| `ses_1b665b000ffeXyQmgbMk6K4nm7` | 3,438 | 13,396 | 22 MB | 777 MB | 856 MB | 2,182 MB | 29 s | 32 s | 16 |
| `ses_fc520f481ffe61011ANn06aSh7` | 4,777 | 20,603 | 73 MB | 780 MB | 722 MB | 3,109 MB | 44 s | 51 s | 27 |
| `ses_fbe526667ffe8NDc78DcLo0200` | 4,155 | 20,252 | 58 MB | 782 MB | 864 MB | 2,977 MB | 32 s | not idle in 900 s | 390 |
| `ses_02445b543ffehq7fivaYkjOQtI` | 2,912 | 12,608 | 47 MB | 796 MB | 729 MB | 2,826 MB | 19 s | 25 s | 19 |
| `ses_fa6f07246ffesHatXMn9ijqyAW` | 3,224 | 16,141 | 54 MB | 778 MB | 714 MB | 2,395 MB | 15 s | 712 s | 244 |

- Half against default: mean 773 vs 786 MB, inside the run-to-run spread (about ±150 MB). An open TUI is 700-900 MB whatever the window holds.
- Load all grows RSS by 1.3 to 4.3 GB, 0.33-0.75 MB per hidden message (median 0.52), and takes 15-164 s before the transcript shows, 4.9-14.5 ms per hidden message (median 9.3). In 6 of 10 sessions the process then stays busy for 2-15 minutes with nothing changing on screen.
- The server worker's JS heap (`/global/memory`) moved by about +70 MB; the growth is in the TUI thread.

## Label rule

Per gap, from 10 ms and 0.5 MB per hidden message: `load all` below 300 hidden, `load all (slow)` at 300-499 (estimated freeze of 3 s or more), `load all (slow / memory heavy)` from 500 (estimated 250 MB or more, about a third of an idle TUI). Time crosses its threshold first, so `(memory heavy)` alone never occurs. Every 3,000+ session above gets `(slow / memory heavy)`.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `tui-history-crop` | `7661b165d6` | `3f2116de60` | commit on `history-bar`, fast-forward push to `nowaker-github` and `origin` |
| `opencode` | `dev-nowaker` | `de17779440` | `f25a2b83a7` + this forklog commit | cherry-pick on `history-bar-land`; conflicts with the moved `keybind-definitions.ts` and `FilteredNotice` resolved keeping both; fast-forward; pushed to both remotes |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Show and load the messages a long session hides](../features/2026-10-06-tui-history-crop.md) | changed | `f25a2b83a7`; benchmark above; frame tests; PTY check |

## Other delivered work

- Upstream: PR #53660 (against `dev`) is closed and no v1 PR exists for this feature, so there was nothing to update; the v1 branch `tui-history-crop` carries both commits.
- Vibeterm: no change. The new keybinds are not catalog knobs and no other `tui.json` key was added.

## Verification

- `packages/tui` on `dev-nowaker`: `bun typecheck` exit 0; `bun test` 779 pass, 0 fail, including `test/routes/session/hidden-divider.test.tsx` (frames at 40, 80 and 160 columns, 51-100 and 1-message gaps, label thresholds, clicks, `loading…`) and the 100-page case in `sync-hidden-messages.test.tsx`.
- Manual surface: installed `vt-326`, scratch database, `ses_02445b543ffehq7fivaYkjOQtI` at 120x45: three rows `load 50 above   load 100 above` / `2,811 messages hidden:  load all (slow / memory heavy)` / `load 50 below   load 100 below`; clicking `load 100 below` -> `2,711 messages hidden`.

## Build and install

- Build command: `VIBETERM_V2_GUARD=.../vibeterm-v2-guard .vibeterm/build.sh` on desktop and on m4max after fast-forwarding its checkout to `f25a2b83a7`; the v2 migration guard gate passed on both.
- Installed artifact: desktop `1.19.0-vt-326-dfb56f76c7` (inode `49958248`), m4max `1.19.0-vt-326-dfb56f76c7` (inode `41929834`); both contain `messages_hidden_above_100` and the retry-header marker.
- Retry-header cap: the dirty diff's hunks matched the canonical patch before the build.
- Running services: none restarted; `opencode-serve-tailscale` PID `665762` and `opencode-serve-lan` PID `663085` unchanged across the build.

## Commit provenance

- `3f2116de60` / `f25a2b83a7` - three-row bar, 100-message pages, costed load-all label.
- Required trailer: `AI-Session-ID: ses_eec5b71ddffe4A47jCysfkQh6l`

## Unknowns and blocked verification

- One run per row on a loaded desktop.
- The post-load-all CPU tail (up to 390 CPU-s with nothing changing on screen) is not explained here.
