# Migration-status polling through a v2 reconnect

## Identity

- Status: active. First user workday: 2026-11-11.
- Source integration: `v2-nowaker`; forklog integration: `dev-nowaker`; development branch: `reconnect-toast`.
- First/current commit: `45a7c497966461ae3d7bba19192fb794095f9227`.
- Upstream release base: `v2.2.7`, `fedc6f208aa2bd54c1019227214568083f6380ad`. Last comparison against newer upstream: TBD.

## Original request and goals

TBD - the original human prompt was not recovered in this pass. The Phase 2 assignment in the [source session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ) requests reconnect feedback without a stale migration-failed notice after transport recovery.

- Keep asking the current client for migration status after a transient transport failure.
- Preserve actual migration errors and unrelated notices.
- Do not change general toast handling, connection policy or the server API.

## Change and stable seams

| Commit | Workday | Behavior | Stable seam |
|---|---|---|---|
| `45a7c49796` | 2026-11-13 | Treat a typed transport failure as no migration-status answer and continue polling | `packages/tui/src/component/migration-overlay.tsx`; `packages/tui/test/app-lifecycle.test.tsx` |

The typed `ClientError` reason `Transport` identifies a failed request rather than a returned migration error. Polling uses the current `client.api`, so reconnection can supply the later answer. Returned `status: "error"` and non-transport failures still notify the user. `toast.tsx` is unchanged.

## Verification

- The recovery regression failed three of three runs before the correction. Focused recovery, resumed progress, unrelated-notice preservation and actual-error keepers pass after it; package checks and diagnostics pass.
- Real PTY bytes replayed through canonical xterm.js show the old notice before the fix and its absence after recovery with the fix. Independent pixel inspection distinguishes the expected source/compiled footer difference.
- Installed vt-17 same-port engine restart keeps TUI PID `3802781` alive across engine PIDs `3801929` and `3803586`, displays the post-restart rename and leaves no stale migration toast. Installed inode `49971753` and size 240254064 bytes remain unchanged throughout.
- Installed receipt: `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/w4-installed-reconnect/run-YRiJZk/receipt.json`; output: `/home/nowaker/.local/share/opencode/tool-output/tool_1d69b5a76001tOHgIP63WGWA4f`.
- Later vt-28 and native Mac vt-30 canonical gates each pass all twelve rows; their reconnect checks report no stale toast. Exact paths are in the linked delivery record.

## Timeline

- 2026-11-11 [source session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ) - began the transport-status correction and before/after visual proof.
- 2026-11-13 [installed verification record](../sessions/2026-11-13-v2-early-input.md) - committed and published the correction, verified vt-17 recovery and later gated native distributions, preserving evidence before worktree retirement.

## Maintenance

- Upstream candidate: typed request-error handling in the migration overlay. No upstream PR was opened.
- Inspect the typed client error and polling owner after upstream changes; retain both transport recovery and real-error regressions. No generated artifacts or capability flags are involved.
