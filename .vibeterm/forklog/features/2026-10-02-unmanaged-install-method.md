# Unmanaged install method for fork builds

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `fork-install-method`
- First local commit: `c8ce109f25`
- Current local commit(s): `c8ce109f25`
- Upstream base when introduced: `2fa3363c92` (upstream `dev`, contains `v1.18.33`)
- Last checked against upstream: `2fa3363c92` (upstream `dev`, contains `v1.18.33`)

## Original request

Relayed by Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo`. The user
answered "Fork fix only" (leave the Homebrew formula installed) and commented,
verbatim:

> vibeterm should not care about any other opencode binaries other than the one it is configured to use.

## Goals

- A binary built by `.vibeterm/build.sh` reports install method `unknown`, so
  a Homebrew or npm opencode on the same machine never drives upgrade checks,
  the "Update Available" modal, or auto-upgrades.

## Non-goals

- No change to upstream release builds or to builds without the stamp: they
  keep package-manager detection.
- No change to the Homebrew or npm copies themselves.

## Rationale and constraints

- Upstream `Installation.method()` asks npm, yarn, pnpm, bun, brew, scoop and
  choco whether they have an opencode. On m4max, Homebrew's 1.18.30 made a
  fork build report `brew`, and the startup check offered Homebrew's
  `v2.0.20` as an update.
- A build-time marker, not a path heuristic: the install path is overridable
  (`OPENCODE_INSTALL`), differs per host, and upstream already maps
  `~/.local/bin` to `curl`. Only the build knows that it is a fork build.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `c8ce109f25` | 2026-10-02 | `script/build.ts` defines `OPENCODE_INSTALL_METHOD` from the environment; `.vibeterm/build.sh` sets it to `unknown`. `Installation.stampedMethod` short-circuits `method()`, and an `unknown` stamp returns from `cli/upgrade.ts` before any registry request, whatever `autoupdate` says | `define` in `packages/opencode/script/build.ts`; `stampedMethod` and `method()` in `src/installation/index.ts`; the first guard in `src/cli/upgrade.ts`; `test/installation/installation.test.ts` |

## Verification

- `test/installation/installation.test.ts` - 13 pass. The new test spawns a
  child bun with `--define OPENCODE_INSTALL_METHOD:"unknown"` beside logging
  npm/brew stubs: `unknown`, zero stub calls. Without the change it reports
  `bun`.
- m4max, fresh XDG config without `autoupdate`, logging package-manager stubs
  first on PATH, TUI for 40 s: `1.18.33-vt-55` shows no modal and makes 0
  package-manager calls, even with `OPENCODE_ALWAYS_NOTIFY_UPDATE=1`; the
  previous `vt-54` binary makes 7 and shows "A new release v2.0.20".

## Timeline

- 2026-10-02
  [`ses_f01c05e81ffeH39PdmzetO2pyw`](../sessions/2026-10-02-openai-gateway-parity.md)
  - `c8ce109f25`: introduce the stamp; build and install on desktop and m4max.

## Current maintenance notes

- Upstream changes to `Installation.method()` or the startup check in
  `cli/upgrade.ts` must keep the stamp first.
- `opencode upgrade` on a stamped build still asks "Install anyways?", as for
  any `unknown` install; that command is never the update path for a fork
  build.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Run `test/installation/installation.test.ts` and `bun typecheck` in `packages/opencode`.
- Build through `.vibeterm/build.sh` and confirm a fresh TUI makes no package-manager calls.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
