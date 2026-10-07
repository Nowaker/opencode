# Instant home prompt and early input at startup

## Identity

- Workday: 2026-10-06
- Session: `ses_eebf9a83fffeIQQwW9gVFo5jaO`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `provisional-prompt` (`0dae58048c`, on upstream `dev` `ecc4916b5a`); landing branch `provisional-prompt-land`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `b12845f999` (cherry-pick of `0dae58048c`)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 19); the
verbatim requests are quoted in the
[feature record](../features/2026-10-06-tui-instant-prompt.md#original-request).

## Goals

- Stage 1 (this record): new-session instant home prompt, early input for the
  TUI and `--mini`, landed on `dev-nowaker`, installed on desktop and m4max.
- Stage 2 (existing-session loading screen) follows on the same development
  branch.

## Constraints and non-goals

- Isolation: scratch `XDG_*`, `OPENCODE_TOOLS_DATA_DIR` and
  `OPENCODE_PLUGINS_DATA_DIR`, throwaway tmux sockets, never the live
  `opencode.db` or config.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `provisional-prompt` | - | `0dae58048c` | new branch on upstream `dev` `ecc4916b5a`; pushed to `nowaker-github` and `origin` |
| `opencode` | `dev-nowaker` | `08f08f672b` | `b12845f999` + this forklog commit | cherry-pick on `provisional-prompt-land`; conflicts in `config/keybind.ts` (the fork's added keybinds moved into `keybind-definitions.ts` unchanged) and `tui.mdx` (kept both sections); fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Instant home prompt and early input at startup](../features/2026-10-06-tui-instant-prompt.md) | introduced | `b12845f999`; tests; tmux captures; timings |

## Other delivered work

- Upstream: issue #53696 and PR #53698.
- Item 19b handed to `ses_eeadda349ffep0Jwwis5g1DJXi` (opencode-tools): make
  Vibeterm skip its own provisional loader when opencode paints this screen,
  and check screen-based readiness detection before prompt delivery.
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
- m2pro: measurement-only scratch clone at `~/projects/tmp/item19-opencode`
  (branch `provisional-prompt`), not installed.

## Commit provenance

- `b12845f999` - instant home prompt and early input.
- Required trailer: `AI-Session-ID: ses_eebf9a83fffeIQQwW9gVFo5jaO`

## Unknowns and blocked verification

- No real-terminal recording yet; the PR has a slot for it.
- Vibeterm-side change pending in item 19b.
