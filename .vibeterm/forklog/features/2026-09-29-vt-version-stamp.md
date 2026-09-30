# Tracked build script and vt version stamp

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `vt-version-stamp`
- First local commit: `8bfa57bb26`
- Current local commit(s): `8bfa57bb26`
- Upstream base when introduced: `2406400f0a` (upstream `dev`, contains `v1.18.32`)
- Last checked against upstream: `2fa3363c92` (upstream `dev`, contains `v1.18.33`)

## Original request

Spawned as track C by coordinator `ses_f0fb0c406ffewPrI2P1ighbjaX`. From the
brief:

> The canonical build script is `~/projekty/webapps/opencode-build/build.sh`,
> which lives in no repository. Move it into the fork, committed on
> `dev-nowaker` [...] Change the version stamp. It is NOT +1 patch, and it is
> NOT the bare upstream release. It becomes `<base>-vt-<seq>-<sha>` [...] The
> point: a real upstream release on the system (1.18.34) is then detectable as
> newer than the vt build's base (1.18.33).

## Goals

- The build/install script is versioned with the fork at `.vibeterm/build.sh`;
  `~/projekty/webapps/opencode-build/build.sh` stays a working entry point.
- `opencode --version` of a fork build prints `<base>-vt-<seq>-<sha>`, e.g.
  `1.18.32-vt-48-2406400f0a`.
- Plugin loading, config-directory dependency installs and the upgrade check
  behave exactly as they did with the bare release stamp.

## Non-goals

- No change to where the binary installs or to the mv+cp inode swap.
- Reintegrating onto a newer upstream is a separate updater action.

## Rationale and constraints

- The bare release stamp made every fork build indistinguishable from that
  release; tooling could not tell an upstream release on the system apart
  from, or newer than, the fork.
- `base`: newest release HEAD contains (highest `vX.Y.Z` whose release
  commit's parent is an ancestor), never a v2 tag cut from another line.
  `seq`: `git rev-list --count $(git merge-base HEAD github/dev)..HEAD`.
  `sha`: first 10 hex chars of that merge-base.
- The stamp must not start with `0.0.0-`: the Script module would then infer
  a preview channel instead of `latest`.
- The stamp is a semver prerelease of `base`. No registry publishes it, and
  `semver.satisfies("1.18.32-vt-...", ">=1.0.0")` is false, so registry pins
  and ranges must use the base.
- The opencode-tools parser (`_lib/opencode-binary/vt-version.ts`) matches
  `^(\d+)\.(\d+)\.(\d+)-vt-(\d+)-([0-9a-f]{10})$`; `baseVersion` strips the
  same suffix and nothing looser.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `8bfa57bb26` | 2026-09-29 | Track the build script; vt stamp; `--print-version` | `.vibeterm/build.sh` `detect_version` |
| `8bfa57bb26` | 2026-09-29 | `InstallationBaseVersion` for the plugin pin, `engines.opencode` check and upgrade check | `packages/core/src/installation/version.ts` `baseVersion`; `packages/opencode/src/config/config.ts`, `config/tui.ts`, `plugin/loader.ts`, `cli/upgrade.ts`, `cli/cmd/upgrade.ts` |

Consumers deliberately left on the full stamp: every `User-Agent`, TUI
sidebar/debug/error display, `/global/health`, OTLP `serviceVersion`, MCP and
ACP client info, the session `version` field, and the CLI daemon registry
(equality with itself).

## Verification

- `bun test test/installation-version.test.ts` (packages/core) - 3 pass.
- `bun run typecheck` in packages/core, packages/opencode, packages/tui - exit 0.
- `bun test test/plugin test/config` (packages/opencode) - 435 pass / 5 fail;
  the same 5 fail on `d1d03f9ef4` without this change.
- `.vibeterm/build.sh --print-version` on `d1d03f9ef4` - `1.18.32-vt-48-2406400f0a`,
  matching the hand-computed merge-base and count.
- Build and installed-binary checks: see the linked session record.

## Timeline

- 2026-09-29 [`ses_f0fa472b3ffewPFKUIOfLnesvB`](../sessions/2026-09-29-vt-version-stamp.md) -
  initial build. Evidence: `8bfa57bb26`.
- 2026-09-30 [`ses_f0f108c6dffeMymgpAsLy9LESM`](../sessions/2026-09-30-upstream-1.18.33.md) -
  rebased onto upstream `dev` `2fa3363c92` (contains `v1.18.33`); `e469ed80f8`
  makes `build.sh` install beside the primary checkout on either host and fall
  back to an `upstream` tag remote. Evidence: both hosts build and report
  `1.18.33-vt-52-2fa3363c92`.

## Current maintenance notes

- Every new `InstallationVersion` consumer that talks to a registry, a semver
  range or an "is this the latest release" check must use
  `InstallationBaseVersion` instead.
- `OPENCODE_UPSTREAM_REF` (default `<OPENCODE_TAG_REMOTE>/dev`) chooses the
  ref the merge-base is taken against.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- `rg -n 'InstallationVersion' packages` and classify new consumers.
- Confirm `packages/script/src/index.ts` still infers channel `latest` for a
  non-`0.0.0-` `OPENCODE_VERSION`.
- Build through `.vibeterm/build.sh` and check `--version` prints the new base
  and a `seq` equal to the fork commit count.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
