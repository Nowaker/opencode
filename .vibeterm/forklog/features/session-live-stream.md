# Live session output for plugins

## Identity

- Status: active on `dev-nowaker`; m4max installed, desktop delivery delegated to the shared builder.
- Integration branch: `dev-nowaker`.
- Development branch: `session-live-stream`.
- First local commit: `b41fece7764b7a9bf3b7afd747483e064b926566`.
- Combined source: `499ec1775d7e6a93166fb517550d86dd4c0a33ca`, including the pause identity guard at `06067f4c27dea04b66e6be7ed999047362be9d65`.
- Physical-directory ownership correction: `6305b4bfa7d7c6d7cce09e6568a6c6073fa56a00`.
- Upstream base: `006d837c5022ea5278162307c04c78412cfae9f3` on upstream `v1`.

## Goal and constraints

The retained task continuation requests opt-in per-session live output through vibeterm-api's existing SSE transport, with ordinary output unchanged. The original initial prompt is not retained in this record.

- Expose a complete current-turn snapshot followed by ordered live events to a plugin without starting an HTTP server in the TUI.
- Keep native message, part and call identities, native status and completeness fields.
- Keep live payloads out of the database and native EventV2 publication. With no subscribers, perform no snapshot query or payload clone.
- Retain raw tool input only while pending. Retain references to retry-abandoned unfinished text/reasoning until authoritative replacement/removal or processor finalization.

## Stable seams

| Seam | Contract |
|---|---|
| `packages/plugin/src/live-events.ts` | Optional `PluginInput.liveEvents.open({sessionID,signal?})` returns readable frames and an explicit close function. |
| `packages/opencode/src/session/publication-fence.ts` | Atomic snapshot admission relative to transcript/status mutation and synchronous publication. |
| `packages/opencode/src/session/live-events.ts` | Snapshot cut, ordered private events, omitted-message filtering and active processor overlays. |
| `packages/opencode/src/session/processor.ts` | Pending raw input, retry prefix references and deterministic lifetime cleanup. |
| `packages/opencode/src/event-v2-bridge.ts` | Synchronous private capture beside existing native publication. |
| `packages/opencode/src/plugin/index.ts` | Instance-scoped abort lifetime for all plugin attachments. |

The private capability uses `vibeterm.stream.snapshot` and `vibeterm.stream.event`. The API adds a fresh public epoch and starts at sequence zero for every client attachment, even when several clients share one owner connection. The public API contract and AI SDK mapping live in opencode-tools `vibeterm-api/README.md`, section "Opt-in live session output".

## Verification

- Five focused live-event/plugin test files plus `test/session/pause.test.ts` and `test/server/httpapi-session.test.ts`: 102 tests passed, 554 assertions. The physical-directory correction's loaded-plugin regression accepts a symlinked project root and refuses a different directory with 409 or a missing directory with 404. It failed all three added cases before the correction.
- `bun typecheck` in `packages/opencode`: exit 0.
- Corrected scratch build through `.vibeterm/build.sh`: `1.19.5-vt-509-006d837c50`; all 8 v1 migration-guard checks passed.
- Directory-corrected scratch build: `1.19.5-vt-510-006d837c50`, from `6305b4bfa7d7c6d7cce09e6568a6c6073fa56a00`; all 8 v1 migration-guard checks passed.
- Real isolated TUI/API scenarios for live reasoning/text/tool input, tool identity, reconnect and OFF comparison: 4 tests passed, 23 assertions.
- Tools API/control/browser-safe suite: 337 tests passed, 817 assertions; canonical tools typecheck: 0 errors across 4 projects.
- Five pinned vt504 baseline and five corrected vt510 OFF runs all matched 24 ordinary frames, 37 transcript mutations and 99 all-table mutations, normalized row JSON bytes 12,610 before and 36,235 after. The workload's test-only 0.2-second post-output lifetime avoids a separately diagnosed upstream stdout race without excluding or normalizing away writes.
- The existing Oracle reviewer approved the three prior corrections, selected app-tool event wiring, and the later physical-directory/error-boundary correction.
- Both fork mirrors were independently verified at feature source `6305b4bfa7d7c6d7cce09e6568a6c6073fa56a00`. The primary m4max build completed at 2026-11-16T12:56:31Z with the deliberate retry patch, version `1.19.5-vt-510-006d837c50`, and all 8 migration-guard checks passed. A fresh invocation of the installed binary returned that version.

## Timeline

- 2026-11-16: [session record](../sessions/session-live-stream.md), owned by [`ses_e1c8d67dbffeqlzOK8teK7Agt4`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c8d67dbffeqlzOK8teK7Agt4). Tools landed as `d59d27e7bfbf326231c1c48915a621d8b1fbf815`, fork source was published on both mirrors, and m4max's primary binary was installed. The desktop shared builder and app/performance acceptance have their own linked receipt owners in the session record.

## Maintenance

Preserve the publication fence, processor registration during terminal idle cleanup, reference-only retry retention, and plugin-instance cancellation when moving the capability to a new upstream version. Readiness and isolated proof must not use the live database or the default Vibeterm tmux socket.
