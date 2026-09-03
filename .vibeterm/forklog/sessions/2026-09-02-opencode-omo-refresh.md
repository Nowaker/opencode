# 2026-09-02 - Dual-host OpenCode and OMO refresh

## Identity

- Workday: 2026-09-02
- Session: `ses_166c2c2b5ffe5Fr8aJwwuDgWT3`
- Agent/platform: OpenCode through Vibeterm / Linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Related tooling: `/home/nowaker/projekty/nowaker/opencode-tools`
- Remote checkout: `/Users/nowaker/projects/webapps/opencode` on `m4max`
- Integration branch: `master-nowaker`
- Development branch(es): `perf/prompt-editor-large-input`; macOS
  `master-nowaker`; temporary `bump-v1-18-27`
- Prior upstream base: `10765ff2a` (`v1.18.25`)
- Upstream base: `f12e14cf1` (`v1.18.27`)
- Source result commit(s): `24326cf48`, `6630dbc2c`, `5b80c26d6`
- Forklog commit: resolve this file's introducing commit through its
  `AI-Session-ID` trailer

## User requests

> bump opencode here, reintegrate here; bump our opencode on m4max; bump omo on
> both ends; check if meridian runs the same same integrated version as desktop.
> after omo bump, use omo-agents-ls.ts to check the config; i want the overrides
> specified as the tool says.

## Goals

- Reconcile independent Linux and macOS fork work into one source history.
- Integrate upstream `v1.18.27` without losing any durable local behavior.
- Install matching native OpenCode builds on Linux and macOS.
- Refresh OMO on both hosts and make every audit recommendation explicit.
- Verify the running Meridian services match their desktop checkout without
  changing or restarting them.

## Constraints and non-goals

- Keep the retry-header cap as the canonical uncommitted two-file divergence.
- Preserve unrelated dirty files in both tools checkouts.
- Do not restart either protected Linux OpenCode serve unit.
- Do not restart, edit, or otherwise touch either Meridian service.
- Keep `disabled_providers: ["google"]`; accept no Gemini assignment.
- Use one unsquashed forklog commit for this session and user workday.
- Use the reproducible OMO no-refresh audit while exposed provider credentials
  remain pending rotation or explicit risk acceptance.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| OpenCode (Linux) | `master-nowaker` | `c1edb418f` | `6630dbc2c` | Rebase the Mac-native command commits above the Linux prompt-latency work |
| OpenCode (Linux) | `master-nowaker` | `6630dbc2c` | `5b80c26d6` | Merge `f12e14cf1` (`v1.18.27`) |
| OpenCode origin | `master-nowaker` | `76e1c3cb1` | `5b80c26d6` | Push the verified source integration |
| OpenCode (macOS) | `master-nowaker` | `97940fdbe` | `5b80c26d6` | Rebase onto origin; Git skips both patch-equivalent local commits |
| opencode-tools | `master` | `40ce11928` | `184c51816` | Pin the two Fable 5.1 assignments and publish the policy |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Global memory diagnostics](../features/2026-05-13-global-memory-diagnostics.md) | preserved | Global HTTP API coverage passes in the semantic gate |
| [Message shape normalization](../features/2026-05-23-message-shape-normalization.md) | preserved | Message, pagination, and compaction coverage passes |
| [Interrupted assistant tail](../features/2026-05-29-interrupted-assistant-tail.md) | preserved | Prompt dispatch coverage passes |
| [Sync hot path](../features/2026-05-29-sync-hot-path.md) | preserved | Sync and compression coverage passes |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | preserved | Provider coverage passes |
| [Compaction tracing](../features/2026-06-16-compaction-decision-tracing.md) | preserved | Prompt and compaction coverage passes |
| [Global bus typing](../features/2026-07-21-global-bus-typing.md) | preserved | `packages/opencode` typecheck passes |
| [Retry-header cap](../features/2026-08-06-retry-header-delay-cap.md) | rebased | Canonical patch comparison, retry tests, and binary marker pass |
| [Native tool commands](../features/2026-08-08-native-tool-commands.md) | extended | Required positional arguments imported and command suites pass |
| [TUI stream throttle](../features/2026-08-25-tui-stream-throttle.md) | preserved | Focused and full TUI suites pass |
| [Prompt input latency](../features/2026-08-31-prompt-input-latency.md) | recorded and preserved | Focused and full TUI suites plus typecheck pass |

## Other delivered work

- Linux and macOS both install OpenCode `1.18.28` from source commit
  `5b80c26d6`.
- The macOS build wrapper now derives an untagged development version from
  `packages/opencode/package.json`; its fork remote does not mirror upstream
  tags and had incorrectly stamped the prior artifact as `1.14.51`.
- Both PATH-level OMO installations report `4.19.4`, the registry's current
  version during this workday.
- The OMO baseline had two findings: Prometheus and Artistry inherited
  `anthropic/claude-fable-5`. Policy commit `184c51816` explicitly moves both to
  `anthropic/claude-fable-5-1` with variant `high`.
- Both final OMO reports have zero findings and zero Google assignments.
- Meridian primary and standby remain untouched. Both report healthy
  passthrough version `1.60.0` from checkout `0f8bbf71b`; its last tracked write
  predates both service starts.

## Verification

- Focused OpenCode seam gate: 339 pass / 4 skip / 0 fail across 12 files.
- Full `packages/opencode` suite: 2791 pass / 12 skip / 0 fail across 228 files.
- Full `packages/opencode` typecheck exits 0.
- Focused TUI gate: 7 pass / 0 fail; full TUI suite: 32 pass / 0 fail.
- Full `packages/tui` typecheck exits 0.
- Shared native-command suite: 385 pass / 0 fail.
- JavaScript SDK and client generation each leave no second-run diff.
- The dirty retry diff equals the canonical external patch byte for byte and
  the installed Linux and macOS binaries each contain one retry marker.
- The opencode-tools OMO suite passes 120 tests in the primary checkout.
- Linux and macOS `omo-agents-ls.ts --override --no-refresh --no-color --json`
  reports each return `findingCount: 0`, explicit Fable 5.1 assignments, and no
  Google provider assignment.
- Linux and macOS installed CLI QA observes version `1.18.28`, rendered help,
  and an invalid option exiting 1.
- Meridian health probes on ports 3457 and 3456 both return version `1.60.0`
  and mode `passthrough`.

## Build and install

- Linux build command: `~/projekty/webapps/opencode-build/build.sh`.
- Linux artifact: `~/projekty/webapps/opencode-build/bin/opencode`, version
  `1.18.28`, device/inode `64768:49961879`.
- Protected Linux services kept PIDs `270361` and `269782`, their unchanged
  2026-08-30 start timestamps, and old executable inode `64768:49950833`.
- macOS build command: `~/projects/webapps/opencode-build/build.sh`.
- macOS artifact: `~/projects/webapps/opencode-build/bin/opencode`, version
  `1.18.28`, arm64 device/inode `16777235:15171108`.
- macOS Vibeterm resolves
  `/Users/nowaker/projects/webapps/opencode-build/bin/opencode` for new tabs.

## Commit provenance

- `f4f805ce3` through `c1edb418f` - prior Linux session's prompt-input
  measurement, fix, and documentation.
- `a544c70d8`, `97940fdbe` - original macOS positional-command commits.
- `24326cf48`, `6630dbc2c` - patch-equivalent commits rebased above the Linux
  work and retained in the integrated history.
- `5b80c26d6` - merge upstream `v1.18.27` lineage.
- `184c51816` - publish explicit Fable 5.1 OMO policy.
- This record's commit carries
  `AI-Session-ID: ses_166c2c2b5ffe5Fr8aJwwuDgWT3`.

## Historical evidence carried forward

- `ses_fa830212effeMiM1hcYBzUbIXW` introduced prompt-input latency work on
  2026-08-31 and reported the reproducible 100 KB terminal A/B measurements.
- `ses_faf0eb9eeffetWvwBHm3DEkcse` introduced required positional arguments on
  macOS on 2026-08-31 and verified positional, named, and malformed-JSON paths
  through the installed TUI.
- Neither earlier session created its own forklog record. Their durable source
  commits and exact transcript evidence are linked from the applicable feature
  timelines rather than attributed to this forklog commit.

## Unknowns and blocked verification

- The JSONC and TypeScript LSP requests timed out or lacked a configured Biome
  server; repository tests, typechecks, JSON audits, and diff checks replace
  those diagnostics.
- An online provider-catalog refresh was not run after a credential exposure.
  The requested reproducible `--no-refresh` audit used the existing catalog and
  required no provider request.
