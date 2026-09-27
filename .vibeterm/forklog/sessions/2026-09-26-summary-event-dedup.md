# Summary emitter-only integration

## Identity

- Workday: 2026-09-26
- Session: `ses_f1f9b9b74ffe8xPPTsmvM4op8M`
- Agent/platform: Hephaestus / Linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch: `summary-event-dedup`
- Contribution base: upstream `b471c2b449`
- Integration upstream base remains `2406400f0`; no upstream upgrade.
- Forklog commit: this file's introducing commit

## Request and constraints

Coordinator relayed the user's choice:

> Fix the emitter only

The coordinator subsequently authorized bounded integration, both fork remotes,
and canonical build/install. No live DB access, pruning, VACUUM, db-clean,
provider-policy change, OMO upgrade, or live-process restart was authorized.

## Branch movement and feature

| Branch | Before | Source result | Action |
|---|---|---|---|
| `summary-event-dedup` | `b471c2b449` | `927891b095` | Upstream-based contribution |
| `dev-nowaker` | `0fffecf930` | `ff79c7b333` | Cherry-pick only the reviewed fix |

- [Unchanged summary suppression](../features/2026-09-26-summary-event-dedup.md)
  - Introduced and verified; two production lines plus regression tests.

## Verification

- Before fix: repeated empty summaries appended an extra event; eight repeated
  real oversized summaries appended eight extra events.
- Integration: `bun test test/session/summary-events.test.ts
  test/session/snapshot-tool-race.test.ts --timeout 60000` from
  `packages/opencode`: 3 pass, 0 fail, 24 assertions.
- `bun typecheck` from `packages/opencode`: exit 0; both changed TypeScript
  files had clean LSP diagnostics after integration.
- Installed CLI driven with disposable HOME/XDG/database and a loopback fake
  OpenAI-compatible provider: eight model turns and seven actual bash tools.
  Two meaningful file changes emitted two distinct 1,200,495-byte summaries,
  each occurring once despite unchanged intervening steps. Projection retained
  the oversized diff. Help exited 0; invalid format exited 1.
- No real provider credentials or live database were used by that driver.
- Concurrent calls with already-current state are covered. Concurrent first
  updates loading the same old state remain capable of duplicate publication.

## Build and install

- Command: `OPENCODE_VERSION=1.18.32
  /home/nowaker/projekty/webapps/opencode-build/build.sh` from the integration
  checkout, exit 0. Explicit version avoids tag discovery; no upstream or OMO
  update performed. Build restored its temporary lockfile changes.
- Installed: `/home/nowaker/projekty/webapps/opencode-build/bin/opencode`.
- Version: `1.18.32`; inode changed from `49959519` to `49966977`.
- SHA-256: `0f23e74422a848484247bd4af7c567f5fac364a9d940c65efe0577fc1ee64c38`.
- Protected units retained their before-build identities:
  - tailscale PID `1957344`, start `2026-09-26 20:51:16 CDT`.
  - LAN PID `1949190`, start `2026-09-26 20:50:39 CDT`.
- Existing processes were not restarted; only newly started processes use the
  replaced installed path. Installed-binary behavior was tested in a new process.
- Desktop-only patch install: the two-host rule applies to version bumps; this
  task explicitly excludes a bump. No m4max GUI/process operations performed.

## Preserved local state

These dirty files retained their pre-integration SHA-256 values:

- `.gitignore`: `943797ef9f8c36648c01faedcaae19b9d94a78faa77d416cf16759cbc6f5f7e6`
- `packages/opencode/src/session/retry.ts`: `63fb966dbae2dce16065338658cd8045d34eb8010db728b211cd8429bb5f03a5`
- `packages/opencode/test/session/retry.test.ts`: `3949c623924c2afcd337931e766f83e381a9f339134321c5edf0c0ed7cd08325`

The retry divergence remains uncommitted and was included in the local build,
unchanged. SQLite failure causation from historical event growth is unproven.
