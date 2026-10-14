# Collapse long bash commands; optional output tail

## Identity

- Workday: 2026-10-14
- Session: `ses_ed1e2b932ffe6tTqhsOiGuYXRE`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `shell-command-collapse` (off `dev-nowaker`); upstream v1 `tui-command-collapse` (stacked on `tui-tool-collapse` `0bea99ea61`); upstream v2 `v2-shell-collapse` (off `github/dev` `f44c40b4d3`)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`); unchanged
- Source result commit(s): `c946d6626d`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` on 2026-10-14: the
user approved collapsing long bash commands v2-style, implemented the fork's
way: a `tool_input.collapse` key shaped like `tool_output.collapse`, separate
limits for command and output, and v2's output tail behind a setting. On the
tail:

> if v2 has a function - output tail - then we can't delete it

## Goals

- `tool_input.collapse` (per group `bash` or tool name; rows, `0`, `"never"`;
  default `"never"`) cuts the command after that many rendered rows with
  `ClippedRows`, keeping wrapping and shell/heredoc coloring.
- Command and output keep separate limits; one click expands both.
- `tool_output.tail` (per group `bash`/`generic` or tool name; default off)
  shows the last lines under `(N earlier lines)` with v2's `collapseTail`.
- User value set only through Vibeterm settings: `tool_input.collapse.bash` 5.

## Constraints and non-goals

- `tool_output.collapse` keeps its record shape; the new keys have explicit
  `bash`/`generic` properties so Vibeterm's knob catalog sees them.
- No tab, serve unit or `vibeterm` tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `923c65444a` | `c946d6626d` | feature commit, fast-forward; pushed to both remotes |
| `opencode` | `tui-command-collapse` | - | `1483f9fcac` | new, on `0bea99ea61`; both remotes; PR [#55421](https://github.com/anomalyco/opencode/pull/55421), issue [#55420](https://github.com/anomalyco/opencode/issues/55420) |
| `opencode` | `v2-shell-collapse` | - | `7e6fa14a42` | new, off `github/dev`; both remotes; PR [#55444](https://github.com/anomalyco/opencode/pull/55444) |
| `opencode-tools` | `master` | `bf416d2` | `a42e4c6` | Focus decisions for the new knobs, undecided-knob guard, catalog regenerated |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Choose how much tool output shows before "Click to expand"](../features/2026-10-08-tui-tool-output-collapse.md) | extended: `tool_input.collapse`, `tool_output.tail` | `c946d6626d`; tests and PTY below |

## Other delivered work

- opencode-tools `a42e4c6`: the collector regenerated the TUI knob catalog
  from `c946d6626d`; `tool_output.tail.*` and `tool_input.collapse.bash` had no
  Focus decision, so `settingSpecs()` threw and every process dropped
  `vibeterm.shared.yaml` (`settings shared unreadable-or-invalid ...
  fallback=layer-omitted`) from 13:53Z. The four new knobs (also item 37's
  `syntax.user_messages`) are global-only; an undecided catalog knob is now
  left out instead of throwing. Collector restarted on desktop 14:59:22Z;
  no warning since; cold reads `settingsReadFailures() = []` on both hosts.
- v2 PR #55444 makes v2's two hardcoded shell limits configurable
  (`session.shell_lines` default 10, `session.shell_command_lines` default 2).

## Verification

- `bun typecheck` in `packages/tui` and `packages/opencode`: exit 0.
- `bun test` in `packages/tui`: 663 pass, 1 fail (`test/instant/editor.test.ts`
  5 s timeout at load average 95; passes with `--timeout 60000`).
- Focused: config decode/precedence, `collapseTail`/`collapseOutput`, clipped
  command frames at 40/80/160 columns: 36 pass.
- Manual surface: scratch build `1.19.0-vt-287` on an isolated XDG/DB and a
  throwaway tmux socket (fixture with a 40-line output). `{"tool_input":
  {"collapse":{"bash":2}}}` at 80 columns: long and heredoc commands show 2
  rows and `Click to expand`; 2-row commands no hint. At 160 with
  `tail.bash`: `(31 earlier lines)` then lines 32-40. `{}`: commands in full.
  Real click through a PTY client at `bash: 1`: expands the whole command with
  both heredoc bodies; a second click folds it back; widest row 78 of 80.
- v1 branch: `bun test` in `packages/tui` 245 pass.

## Build and install

- Build command: `.vibeterm/build.sh` with `VIBETERM_V2_GUARD`; desktop as
  systemd unit `oc-install-cmdcollapse`, m4max via `nohup` over ssh.
- Installed artifact: `1.19.0-vt-288-dfb56f76c7` on both hosts; desktop inode
  49964682 -> 49959280; m4max inode 33778199; gate PASSED on both; retry
  marker present.
- Running services: not restarted.
- Settings: `opencodeTui.tool_input.collapse.bash` enforced `5` through
  `vibeterm-settings-set.ts` on both hosts; `tui.json` reads
  `"tool_input": {"collapse": {"bash": 5}}`; `tool_output.tail` unset.

## Commit provenance

- `c946d6626d` - feature
- Required trailer: `AI-Session-ID: ses_ed1e2b932ffe6tTqhsOiGuYXRE`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-14-shell-command-collapse.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- v2 PR #55444 was not run in a real terminal; unit and config tests only.
