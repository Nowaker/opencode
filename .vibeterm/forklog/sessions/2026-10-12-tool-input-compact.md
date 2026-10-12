# Tool input block: one row per value, compact YAML

## Identity

- Workday: 2026-10-12
- Session: `ses_ed1e2b932ffe6tTqhsOiGuYXRE`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `syntax-integration` (off `dev-nowaker`); upstream `tool-input-block`
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`); unchanged
- Source result commit(s): `84d27d0f49`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` after a collapsed
`vibeterm_async_question` call showed only keys and `…`:

> kind of useless when only showing keys and not values. for the lines being
> shows before expanded, let's show ONE full line (visually; accounting for
> word wrapping). [...] also, excesssive indents. use this og yaml format

## Goals

- Collapsed: every value takes one visual row, cut with `…` at the block width.
- Compact YAML everywhere: list items at their key's indent.
- Keep the no-red palette; recompute on layout and resize only.

## Constraints and non-goals

- No tab, serve unit or `vibeterm` tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `tool-input-block` | `02be94024c` | `491363e6cf` | amended; PR #54707 body updated |
| `opencode` | `dev-nowaker` | `3d554e9df1` | `84d27d0f49` + this forklog commit | fix commit, fast-forward; pushed to both remotes |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Syntax coloring in tool calls](../features/2026-10-11-tool-syntax-coloring.md) | changed | `84d27d0f49`; tests and PTY below |
| [Choose how much tool output shows before "Click to expand"](../features/2026-10-08-tui-tool-output-collapse.md) | preserved | the input block reads the generic limit only for `"never"` (always whole) |

## Verification

- packages/tui on `syntax-integration`: typecheck clean; full suite 574 pass,
  1 skip, 0 fail. `tool-input-block`: 117 focused tests pass.
- Render test: collapsed frames at 40, 80 and 160 columns, one row per value,
  no row wider than the block; the measured width equals the block width.
- Real PTY (compiled vt-243, throwaway tmux socket, `generic: 0`) at 80 and
  160 columns: a question list and nested MCP input render in compact YAML,
  each value cut with a muted `…` at the block edge; no red cell in the block.
- Latency, A/B/B/A vs vt-241 on the 6154-part session copy, 60 samples per
  run: scroll p50 12.2 -> 11.7 ms, p95 24.1 -> 22.7 ms; keystroke p50
  19.9 -> 16.1 ms, p95 36.5 -> 28.3 ms; idle CPU 4.5% -> 3.8%.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`
  on desktop and m4max.
- v1 database guard gate: PASSED on both hosts; retry-header patch reverse-applied on both.
- Installed artifact: desktop `1.19.0-vt-243-dfb56f76c7` (inode `49962235`),
  m4max `1.19.0-vt-243-dfb56f76c7` (inode `30683812`); both carry the retry marker.
- Running services: none restarted by this session; desktop
  `opencode-serve-tailscale` is PID `4038768`, started 2026-10-12 03:45:55 CDT,
  before this work began.

## Commit provenance

- `84d27d0f49` - show every tool input value on one row, in compact YAML
- Required trailer: `AI-Session-ID: ses_ed1e2b932ffe6tTqhsOiGuYXRE`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-12-tool-input-compact.md
```

## Unknowns and blocked verification

- Running TUI tabs pick up the build only when restarted; none was restarted.
