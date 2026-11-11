# Separate opencode2 global storage

## Identity and request

- Status: active. Source integration: `v2-nowaker`; forklog integration: `dev-nowaker`.
- Upstream base: `v2.2.7` (`fedc6f208a`), fork base `d90d41a907`.
- Source commit: `116b7b3b0d`.

> move every global root opencode2 derives from the `opencode` app namespace to `opencode2`

## Behavior and stable seams

- `packages/util/src/global.ts`: application namespace `opencode2` supplies data, cache, state, computed config and temporary roots. Snapshots/logs/repos derive from data; bin derives from cache; locks derive from state.
- Default data: `$HOME/.local/share/opencode2`; cache: `$HOME/.cache/opencode2`; state: `$HOME/.local/state/opencode2`; temporary root: `os.tmpdir()/opencode2`.
- `packages/client/src/service-probe.ts`: Promise and Effect clients discover the matching `opencode2/service.json` state record.
- `packages/core/src/database/guard.ts`: preserve explicit rejection of the legacy XDG `opencode/opencode.db`, including symlink/hardlink aliases, after moving the effective v2 data root. HOME default and schema/poison checks remain intact.
- `OPENCODE_DB` remains mandatory with no binary fallback. Test and managed launch configuration continues to select `OPENCODE_CONFIG_DIR` explicitly.
- The one-shot legacy credential importer reads `Global.data/auth.json` under `opencode2`, intentionally stopping automatic import of v1's `auth.json`.
- `packages/desktop/src/main/native/logging.ts`: both native debug-export server log roots use `opencode2`, so the archive includes v2 logs without mixing in v1 logs. System-wide configuration discovery is unchanged.

## Verification

- Util root tests: 6 pass, 0 fail, 57 assertions. Acquired production roots handle XDG and HOME defaults, honor explicit config, perform actual writes and leave no `opencode` directories.
- Client discovery/decision tests: 5 pass, 0 fail, 17 assertions. Real Promise and Effect clients discover a scratch registration against a loopback HTTP fixture.
- Core database guard: 17 pass, 0 fail, 38 assertions; preload: 2 pass, 0 fail, 17 assertions. The old path guard failed the three XDG cases, including actual migration of empty alias targets, before correction.
- Global and client old-namespace controls fail the new actual-write cases. Util/client typechecks and changed-file diagnostics pass.
- Native debug export regression invokes the real logging service and ZIP writer over mixed v1/v2 filesystem fixtures, with only Electron's platform adapters isolated in a disposable child. The old roots export `v1-0` instead of `v2-0` and fail; the corrected logging/export suites pass 12 tests, 0 fail, 22 assertions. Desktop typecheck passes 3,448 files across two projects; both changed files pass formatting.
- Installed snapshot/log/cache/state proof: `.vibeterm/tmp/opencode/w4-proof-aJTJ4D/result.json`. The executing engine creates a real snapshot store under its scratch `data/opencode2/snapshot`; both engines use `opencode2` logs/cache/state and create no old `opencode` roots.
- Desktop vt-9's canonical 12-row gate re-verifies isolated data/log/repos/cache/bin/state/tmp under `opencode2`, explicit configuration and seven v1 database refusals. The binary installed by inode swap matches the exact tested artifact; the shared W4 session record preserves its receipt.

## Upstreamability

- Fork-only. The namespace distinguishes this coexisting `opencode2` installation from upstream/v1. No upstream PR was opened.

## Timeline

- 2026-11-10 [W4 session record](../sessions/2026-11-10-v2-patches.md), [source session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ): isolate derived roots after W6 found v1/v2 sharing snapshot, log, cache and state directories.
