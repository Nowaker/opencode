# Atomic session metadata merge on v2

## Identity

- Status: active; desktop and m4max installed and verified as vt-19, including plugin merge parity. The historical Mac notification failure below was repaired before its later gates.
- Source integration branch: `v2-nowaker`; this provenance is tracked only on `dev-nowaker`.
- Development branches: `metadata-merge`, then `synthetic-append` for plugin parity.
- First local commit: `8c859a94ca013bb2c26782e0f41dc0acaa17b89a`. Plugin parity: `838da4b2f00fecc3031104e7394d4983fe343403`.
- Upstream base when introduced: `v2.2.7`; fork parent `1f6d9fb8c1e844e4bd5e78770f50b02b19063c3d`.
- Last checked against upstream: the candidate's existing upstream base; no separate upstream refresh.

## Original request

TBD - original human wording is not quoted in this record. Decision 18 is recorded in [the migration plan](https://gitlab.com/Nowaker/opencode-tools/-/blob/master/docs/research/2026-10-07-vibeterm-core-on-opencode-v2.md#2-decisions-recorded-user-2026-10-07): key-scoped RFC 7396 updates, with Vibeterm writing only `session.metadata.vibeterm`. [W4](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ) owns implementation and verification for the [coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC).

## Goals and non-goals

- Concurrent merge writers retain unrelated top-level and nested metadata keys.
- Omitted or explicit replacement mode retains complete replacement and literal null values.
- The existing durable event and client reducer retain full-record replacement semantics.
- Child creation, fork inheritance and transfers/imports retain their current behavior. Plugin updates retain replacement by default and honor the explicit merge selector. Message/tool metadata is outside this change.

## Rationale and constraints

- Handler read-modify-write can lose keys written by another engine between its read and publication. `Session.setMetadata` prepares its update inside the Bus-owned `BEGIN IMMEDIATE` transaction, before projection and event persistence; notification follows commit.
- The public selector is `experimental.metadataMode: "merge"` on the existing JSON PATCH payload. The repository's `httpapi-codegen` rejects multiple payload schemas, so using both JSON and merge-patch Content-Types would require a broader generator change.
- Keep `session.metadata.updated.1` carrying the complete merged result. Replay and existing clients need no alternate patch interpretation. The payload can be larger than a delta; this preserves the established event contract.
- Merge objects recursively, delete null members and replace array/scalar members. The metadata root remains a JSON object. `capabilities.sessionMetadataMergePatch` advertises support; older servers omit it.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `8c859a94ca` | 2026-11-10 | Prepared durable publication and opt-in metadata merge, Protocol/HTTP capability and regenerated clients | `Bus.publishPrepared`, `Session.setMetadata`, `experimental.metadataMode`, `session.metadata.updated.1` |
| `838da4b2f0` | 2026-11-13 | Forward plugin merge selection to the same atomic owner and advertise it in plugin app capabilities | `PluginHost` session update, `ctx.app.capabilities.sessionMetadataMergePatch` |

## Writer audit

| Owner | Disposition |
|---|---|
| Core `session.ts` interface and `session/session.ts` setter | Changed: optional merge selection; both modes read the session under prepared publication. |
| Server session PATCH | Changed: passes merge only when explicitly selected. |
| Protocol and generated Promise/Effect clients | Changed: optional selector and advertised capability. |
| Plugin host `session.update`, Promise/Effect plugin session APIs | Explicit `experimental.metadataMode: "merge"` uses the atomic Session owner; omitted/default or explicit replacement stays complete replacement. |
| Core/session and HTTP creation, child metadata inheritance | Unchanged: initialization or explicit complete override. |
| Session fork and its projector | Unchanged: copy parent metadata. |
| Transfer import/export, HTTP import and redaction | Unchanged: transfer the complete record. |
| Durable event schema, metadata projector and Solid reducer | Unchanged: persist/apply the full resulting record. |
| TUI and SDK consumers | Unchanged: no independent metadata writer found; SDK transport consumes regenerated clients. |
| Prompt, synthetic, tool, permission and provider metadata; v1 migration | Unchanged: distinct metadata domains or initialization. |

## Verification

- Main rerun from `packages/core`: `bash /home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/w4-env.sh env -u TMPDIR bun run script/test.ts test/bus.test.ts test/bus-unpersisted.test.ts test/bus-session-routing.test.ts test/bus-prepared.test.ts test/session-metadata.test.ts test/session-owned.test.ts test/session-projector.test.ts test/session-create.test.ts test/session-log.test.ts`: 214 pass, 0 fail, 756 assertions. The 27 new tests are included.
- Main HTTP run from `packages/server`: the same environment wrapper followed by `bun test test/session-metadata-merge.test.ts test/session-update.test.ts test/event-replay.test.ts`: initially 17 pass, 0 fail, 86 assertions, including replay over a different receiving baseline. The real source CLI probe then exposed root null decoding as omitted metadata. The final PATCH field uses the existing Schema package `optional` helper, preserving client-side undefined omission while rejecting wire root null. Final merge/update run: 9 pass, 0 fail, 46 assertions. Literal null members in default replacement remain intact.
- The Core owner reports nine red controls restored byte-for-byte and clean typecheck/diagnostics. Main reviews the production diff. Protocol and generated Client typechecks pass; two generator runs have identical output.
- Cross-process regression: 10 repeated runs, 320 rounds and 1,020 assertions pass. Two independent ServerFetch processes share one scratch database; a real API-created child identifies the third logical actor. Moving read/merge before publication loses `vibeterm.round` in round 0 despite three 204 responses. Original source bytes were restored before the green reruns. Engine readiness is serialized to exclude the existing fresh-schema creation race; metadata writes run concurrently.
- Main source CLI proof `.vibeterm/tmp/metadata-merge-proof/run-y0SxDw/report.json` passes with 24 rounds, three processes, 72 concurrent same-parent writes and 73 full metadata events replayed through HTTP/SSE into a differing baseline. This is source version `vlocal`, not an installed-binary result. Final `bun run check` passes all 34 workspace tasks with 554 warnings and zero errors; second generation is unchanged.
- Initial gate review found one SDK omission regression in the intermediate exact-optional schema. A new generated Effect-client test reproduces both title-only and archive-only updates failing before HTTP (0 pass, 2 fail). Reusing the existing `optional` helper and regenerating restores both; the client run has 11 pass, 0 fail including adjacent Effect tests. Root-null rejection and default replacement keepers remain green. The [narrow re-review](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3665007affeKsycmYEuJcYn4D) approves with high confidence and no required findings.
- The new capability-aware tooling probe has 65 unit tests passing and correctly skips installed pre-capability vt-8. Tools probe `9380172f5f6` is fast-forwarded and pushed before the metadata source commit; decision 18 is published as tools `0d5cf1a8419`. Desktop installation and the controller demo are verified below. Mac remains on the initial vt-8 installation; the coordinator explicitly holds vt-9 pending the host repair.

## Desktop installation

- Canonical `.vibeterm/build.sh --v2` exits 0 against source `8c859a94ca`, building the native CLI and embedded app. Its preinstall runtime gate has 12 pass, 0 fail, 0 skip, including metadata merge, default replacement, replay/SSE/TUI, seven database refusals, plugins and two active engines. Report: `/home/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-1VCPwj/report.json`; build log: `/home/nowaker/.local/share/opencode/tool-output/tool_1c9a6c756001NyX0q8g6LWr4cy`.
- Installed `opencode v2.2.7-vt-9-5f76acb125`, inode `49985162`, 239996016 bytes, is byte-identical to the tested `packages/cli/dist/cli-linux-x64/bin/opencode`. V1 retains inode `49972367` and 198720624 bytes across this install. Protected serve units remain inactive with PID 0 and unchanged start timestamps.
- The gate retains the known stale `Data migration failed` TUI toast after reconnect; reconnect and subsequent rename succeed. This existing UI issue is outside metadata merge.
- The [v1 controller demo](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e36494458ffe4L6LxO9w7Ak2jY) runs the exact installed binary and passes. Main reads its report and receipt at `/home/nowaker/projekty/tmp/vibeterm/opencode-omo-demos/.vibeterm/tmp/metadata-merge-proof/run-V5cpw5/`: three distinct writer PIDs, 24 rounds, 72 same-parent writes, actual parent/child IDs and all `write0` through `write23` keys survive. Seventy-three full update events replay into a differing baseline with native SSE and receiver-only deletion.

## Timeline and maintenance

- 2026-11-13 [W1 plugin parity and installed proof](../sessions/2026-11-13-v2-plugin-controls.md#immediate-append-and-plugin-metadata-parity) fixes the host dropping the existing merge selector. The six Promise/Effect mode cases reproduce the lost sibling key before correction and pass afterward. Both hosts install source `7da31d898a`, including parity commit `838da4b2f0`, as vt-19 through separate 12/12 gates; installed RPC verifies both capabilities and the merge/default-replace outcomes.
- 2026-11-10 [W4 session record](../sessions/2026-11-10-v2-patches.md), [session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ): decision 18, atomic publication design, source/HTTP regressions, both-mirror publication and desktop vt-9 installation/demo. At 2026-11-11 09:04 UTC the coordinator requests this combined record now and holds the Mac vt-9 build until its fseventsd fault is repaired; no gate is bypassed.
- Recheck `Bus.publishPrepared` transaction ownership, typed preparation errors and post-commit notification on an upstream bump. Regenerate clients from `packages/client`; preserve default replacement and rerun the concurrent installed-binary probe.

## Upstreamability

- Upstream candidate: general, explicitly selected RFC 7396 session metadata updates preserve the established replacement API and durable event contract. No upstream PR was opened.
