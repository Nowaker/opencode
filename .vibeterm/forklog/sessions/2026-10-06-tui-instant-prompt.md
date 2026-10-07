# Instant home and session prompt and early input at startup

## Identity

- Workday: 2026-10-06
- Session: `ses_eebf9a83fffeIQQwW9gVFo5jaO`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high, later max) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `provisional-prompt` (`8b7f258af6` stage 1, `f829a6a3f7` stage 2, on upstream `dev` `ecc4916b5a`; they replace `0dae58048c` and `620cd1e333`); landing branch `provisional-prompt-land`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `b12845f999` (cherry-pick of `0dae58048c`), `5621b2c706` (cherry-pick of `620cd1e333`), `12a11e65f1` (the diff from `620cd1e333` to `f829a6a3f7`)
- Forklog commits: `26ac18bc93` (stage 1), `31b6919091` (stage 2), and a third that records the startup fix

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 19); the
verbatim requests are quoted in the
[feature record](../features/2026-10-06-tui-instant-prompt.md#original-request).

## Goals

- Stage 1 (this record): new-session instant home prompt, early input for the
  TUI and `--mini`, landed on `dev-nowaker`, installed on desktop and m4max.
- Stage 2 (this record's second forklog commit): existing-session screen for
  `-s`/`-c`, landed and installed on both hosts.
- Startup fix (this record's third forklog commit): a damaged startup cache or
  a small pane no longer stops startup; landed and installed on both hosts.

## Constraints and non-goals

- Isolation: scratch `XDG_*`, `OPENCODE_TOOLS_DATA_DIR` and
  `OPENCODE_PLUGINS_DATA_DIR`, throwaway tmux sockets, never the live
  `opencode.db` or config.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `provisional-prompt` | - | `0dae58048c` | new branch on upstream `dev` `ecc4916b5a`; pushed to `nowaker-github` and `origin` |
| `opencode` | `provisional-prompt` | `0dae58048c` | `620cd1e333` | stage 2 commit on top; pushed to both remotes; PR #53698 body updated |
| `opencode` | `provisional-prompt` | `620cd1e333` | `f829a6a3f7` (parent `8b7f258af6`) | both commits rebuilt on `ecc4916b5a` with the startup fix folded into each stage and without AI trailers; force-pushed with lease to both remotes; PR #53698 title and body rewritten |
| `opencode` | `dev-nowaker` | `31b6919091` | `12a11e65f1` + the third forklog commit | startup fix applied on `provisional-prompt-land` as the diff from `620cd1e333` to `f829a6a3f7`; fast-forward; pushed to both remotes |
| `opencode` | `dev-nowaker` | `26ac18bc93` | `5621b2c706` + the stage 2 forklog commit | cherry-pick on `provisional-prompt-land`; conflicts in `routes/session/index.tsx` (the fork's timestamp/keep-scroll memos kept, sidebar rule moved to `layout.ts`) and `routes/session/sidebar.tsx` (the fork's `pin_title` title block kept; `sidebarShowsSessionId` now takes kv, `sidebar.session_id` and channel, and the loader reads the same three); fast-forward; pushed to both remotes |
| `opencode` | `dev-nowaker` | `08f08f672b` | `b12845f999` + this forklog commit | cherry-pick on `provisional-prompt-land`; conflicts in `config/keybind.ts` (the fork's added keybinds moved into `keybind-definitions.ts` unchanged) and `tui.mdx` (kept both sections); fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Instant home and session prompt and early input at startup](../features/2026-10-06-tui-instant-prompt.md) | introduced, extended, fixed | `b12845f999`, `5621b2c706`, `12a11e65f1`; tests; tmux captures; timings; startup repro |

## Other delivered work

- Upstream: issue #53696 and PR #53698.
- Item 19b handed to `ses_eeadda349ffep0Jwwis5g1DJXi` (opencode-tools): make
  Vibeterm skip its own provisional loader when opencode paints this screen,
  and check screen-based readiness detection before prompt delivery. Done for
  new-session tabs in opencode-tools `0b281fa` (binary marker scan, route
  `ready` flag for delivery) and for existing-session tabs in `9d3bd0e`
  (session-boot loader skipped; the compact, rate-limit rescue and notify
  typists wait for the real prompt); rolled out on desktop and m4max.
- An audit of `1.18.34-vt-146` found two startup failures: a cached agent
  without `label` or a numeric theme color made opencode exit at startup, and
  the spinner-only redraw threw for a spinner off the grid of a short or
  narrow pane, so the loading screen stopped drawing. Fixed in `12a11e65f1`.
- PR #53698: both commits rebuilt without AI trailers, with the attribution as
  the body's last line (the forklog README's upstream rule); retitled
  "feat(tui): paint an editable prompt before the TUI loads"; body rewritten
  to describe the current result. Upstream's `test`, `typecheck`, `nix-eval`
  and `storybook` runs await maintainer approval (`action_required`); its
  PR-standards checks pass.
- Pre-push hook: the push to `dev-nowaker` first failed on
  `Cannot find module 'jsonc-parser'`, because the primary checkout's
  `node_modules` predated the new dependency; `bun install --frozen-lockfile`
  there fixed it. Pushes ran the real hook inside
  `bwrap ... --tmpfs ~/node_modules` (the ambient `@types/node` issue recorded
  by `ses_eec44cf7effeFCqQefM0NkWLaW`).
- opencode-idle-bench `ttp` exposed a bug fixed before landing: an `exec`'d
  opencode survived `kill-server` during the first second, because the SIGHUP
  handler's terminal restore could throw before `process.exit`.

## Verification

- See the feature record's Verification section: typechecks, 317/0 tui tests on
  the landing branch, the parity suite, tmux captures, and timings on desktop,
  m2pro and m4max.
- `packages/opencode` `test/cli`, `test/config/tui.test.ts`: the failures seen
  were environmental. With `TMPDIR` inside the repo, the config walk-up finds
  the repo's own `.opencode/tui.json`. The spawn plugin injected by this
  Vibeterm session adds a server plugin. The `resolveZedSelection` tests time
  out at load 40. With `TMPDIR` outside the repo, help snapshots and
  credential redaction pass.
- Startup fix: see the feature record for the same-test red/green runs and the
  startup repro. The PR branch passes 33 instant tests and 227 tui tests.

## Build and install

- Build command: `~/projekty/webapps/opencode/.vibeterm/build.sh` on desktop;
  `.vibeterm/build.sh` on m4max after fast-forwarding its checkout to
  `b12845f999`.
- Installed artifact: desktop `1.18.34-vt-144-907b3bc518` (inode `49955766`),
  m4max `1.18.34-vt-144-907b3bc518` (inode `21913287`). Both contain the
  retry-header marker and the instant-prompt strings, and both pass the
  keystroke check (52/52 keys shown).
- Retry-header cap: the dirty diff matched the canonical patch on both hosts
  before the build.
- Running services: none restarted; `opencode-serve-tailscale` PID `1507297`
  and `opencode-serve-lan` PID `1509289` unchanged across the build.
- Stage 2: desktop `1.18.34-vt-146-907b3bc518` (inode `49955797`), m4max
  `1.18.34-vt-146-907b3bc518` (inode `21929794`); retry marker and the
  "Loading session" string present on both; retry patch matched before each
  build; serve PIDs `1507297`/`1509289` unchanged.
- Startup fix: desktop `1.18.34-vt-148-907b3bc518` (inode `49955806`), m4max
  `1.18.34-vt-148-907b3bc518` (inode `21933833`); retry marker present and
  retry patch matched before each build; serve PIDs `1507297`/`1509289`
  unchanged; the startup repro passes on both installed binaries.
- m2pro: measurement-only scratch clone at `~/projects/tmp/item19-opencode`
  (branch `provisional-prompt`), not installed; removed after the
  measurements.

## Commit provenance

- `b12845f999` - instant home prompt and early input.
- `5621b2c706` - session screen for `--session`/`--continue`.
- `12a11e65f1` - keep a damaged startup cache or a small pane from breaking
  startup.
- Required trailer: `AI-Session-ID: ses_eebf9a83fffeIQQwW9gVFo5jaO`

## Unknowns and blocked verification

- No real-terminal recording yet; the PR has a slot for it.
- Upstream CI for PR #53698 has not run; it awaits maintainer approval.
- This session has three forklog commits for the 2026-10-06 workday: each
  earlier one was already pushed to `dev-nowaker` when the next change landed,
  and pushed commits on `dev-nowaker` are never amended.
