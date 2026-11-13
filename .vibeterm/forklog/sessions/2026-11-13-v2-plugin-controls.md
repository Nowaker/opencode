# W1 native v2 plugin controls

## Identity and scope

- Workday: 2026-11-13, resuming work paused on November 11 for desktop memory pressure.
- Session: [ses_e3832b1b0ffe6q98OeUzhgqhjQ](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ). Coordinator: [ses_e383ee7faffe6JX8m2EP26dXUC](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC). Main coordinator: [ses_ef8235798ffejGr4sa22eXmVNv](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv).
- Agent/platform: Hephaestus, `openai/gpt-6.1-sol`, xhigh, Linux. Repository: `/home/nowaker/projekty/webapps/opencode`.
- Source integration: `v2-nowaker`, upstream `v2.2.7` (`fedc6f208aa2bd54c1019227214568083f6380ad`). Forklog: `dev-nowaker` only. Feature branches rebase; integration history is preserved.

> From coordinator ses_ef8235798ffe: TASK: continue: you were aborted at 13:55Z at Damian's order to cut desktop load. Check your worktree for half-done state, finish the patch-1 admission race fix and review on de4fe36eee, then publish; then patch 3 (cancelChild plus ctx.job.list/cancel); one gated install; forklog. One desktop build at a time; report to ses_e383ee7faffe6JX8m2EP26dXUC.

## Source and review

| Commit | Result |
|---|---|
| `457cab7c5e` | Durable session-message pager in both plugin runtimes, matching the existing HTTP contract. Published and installed in the earlier vt-11 receipt. |
| `398e98d11caadbf20ba9544fcf251a15805e77a0` | Read-only database guard schema checks share one SQLite snapshot. Published base at resumption. |
| `de4fe36eeeec035688d7a0a527dfeba13764e6c8` | Native context forks, notice suppression/groups, timed foreground handoff and ordinary plugin forks. |
| `1d2ebb120e77594294e79c7678079053d033c677` | Reviewed history/output/default-agent/admission/recovery corrections. Both remote tips independently verified after native publication. |
| `ea2e468b5376f41ec58762b2d12d2cd07fcf35cc` | Parent-scoped child cancellation, plugin Job listing and native Job cancellation, with physical stop and cleanup settlement. |

Both worktrees retained their expected uncommitted source across the pause, with no interrupted rebase. Native corrections stayed on `subagent-notices`; cancellation stayed on `child-cancellation`. Source was fast-forwarded locally into `v2-nowaker`. No integration branch was rebased or force-pushed. Rebase conflicts combined all capability keys and plugin methods; clients were regenerated from the combined contracts.

Both remote `v2-nowaker` tips were independently verified by `ls-remote` at `ea2e468b5376f41ec58762b2d12d2cd07fcf35cc` after Patch 3 publication. Both ordinary push hooks passed lint and all 34 workspace typechecks; the second mirror reused verified cache results. GitLab redirects the historical `Nowaker/opencode` remote to `vibeterm/opencode`; this session did not change remote configuration.

The retained [reviewer](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3569b951ffeQp1HZhJCMdbdod) initially found five native defects: cross-model native-compaction fallback, recovered-group idle wake, final output after twenty messages, implicit default primary selection and competing group admissions. A second pass found the ordinary pre-lock ordering and a stale restart Job snapshot. All were reproduced and corrected before publication. Cancellation review found repeated shell cancellation could claim a terminal state during physical shutdown, then found an early waiter could miss a later native-stop latch; both now have red/green regressions and final clearance.

## Features touched

- [Native v2 plugin controls](../features/2026-11-10-v2-plugin-controls.md): durable message paging, forks, notices and truthful cancellation.
- [Guarded v2 foundation](../features/2026-11-10-v2-foundation.md): correct the WAL inspection/nonmutation wording and retain the earlier installed vt-11 proof.

## Verification

- Parent native/messages/WAL run: 173 pass, 0 fail, 762 assertions before the later review corrections. Parent native correction subset: 30 pass, 0 fail, 131 assertions. Final admission/recovery subset: 9 pass, 0 fail, 44 assertions.
- Parent cancellation suite before the last review fixes: 93 pass, 0 fail, 498 assertions. Corrected final six-file settlement/owner/plugin/HTTP run: 43 pass, 0 fail, 244 assertions; log `/home/nowaker/.local/share/opencode/tool-output/tool_1d4e7bc600012mkzj3jgEqvx6x`.
- Both early-waiter cases failed on the pre-fix owner with `Deferred.isDone` true while native cleanup was gated. Moving cleanup-latch collection after the terminal Deferred fixed successful and failed cleanup. The first attempted fixture run used an invalid duration string; it is a test-setup failure and is not counted as regression evidence.
- Combined rebased source passed 46 tests, 0 failures, 223 assertions across ten focused files; log `/home/nowaker/.local/share/opencode/tool-output/tool_1d4ec3aed001VaIxpZ1etWurVw`. Regeneration ran twice with identical second-run output; log `/home/nowaker/.local/share/opencode/tool-output/tool_1d4eb9cc3001Kh63pNAzwOU2Wj`.
- Core typecheck passed for 2,035 files across two projects after the final waiter fix. Changed-file lint/format checks passed. Native publication's ordinary push hooks passed all 34 workspace typechecks on both mirrors; the second mirror reused verified cache results. No checks were bypassed.
- After the memory restriction, tests were focused and serialized. No new broad suite was run; required push hooks retained their concurrency-two typecheck policy. No m4max build or protected service restart was performed.

## Gated desktop install

- The coordinator assigned W1 the first single desktop build slot, with W12 next. Source was clean at the published `ea2e468b53` before and after the build.
- Command: `OPENCODE_SRC=/home/nowaker/projekty/webapps/opencode/.vibeterm/worktrees/child-cancellation VIBETERM_V2_PROBE=/home/nowaker/projekty/nowaker/opencode-tools/vibeterm-opencode-client/bin/vibeterm-v2-probe GIT_MASTER=1 bash /home/nowaker/projekty/webapps/opencode/.vibeterm/build.sh --v2`. The full CLI and embedded app built locally; exit 0. Build log: `/home/nowaker/.local/share/opencode/tool-output/tool_1d4f23ad3001skjlnbf0cnyYXG`.
- Canonical native gate: 12 pass, 0 fail, 0 skip. Receipt: `/home/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-ikffTn`. It covered seven database refusals, fresh readiness, asynchronous plugin loading, concurrent WAL engines, metadata replacement/merge/replay, namespace isolation, real TUI reconnect and replay.
- Installed `/home/nowaker/projekty/webapps/opencode-build/bin/opencode2`: `opencode v2.2.7-vt-14-5f76acb125`, inode `49980722`, 240151664 bytes. The prior binary was archived by the canonical installer as `opencode2.prev-1794574334`.
- V1 retained inode `49972526` and size 198921328 bytes. Both protected serve units remained inactive with MainPID 0 and start timestamp fields empty/0 before and after. No operator-controlled process was restarted.
- The existing TUI reconnect probe still observed the stale `Data migration failed` toast after reconnect; its reconnect assertions passed. That pre-existing W4 TUI issue was outside the W1 API changes and was not modified here.

## Installed API demonstration

The existing v1 [controller session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37fc6aa2ffeItmFQYimsW3v7l) ran `.vibeterm/tmp/opencode/w1-native-proof.ts` against the installed binary. All four behaviors passed on the first run, exit 0, with no harness corrections. W1 read the resulting `.vibeterm/tmp/opencode/w1-native-wz4788/result.json`; the controller separately confirmed no owned engine, hold process or scratch-named process remained.

- Two background own-agent forks each received the settled ancestor marker and excluded the parent's active spawn calls. The parent received exactly one grouped synthetic notice containing both final child outputs.
- Native `todowrite` completed, manual compaction completed, and the plugin recovered its successful todo metadata through durable paging. The source message ID was absent from the four message IDs in the compacted context.
- Plugin `ctx.job.list` returned its running native shell. A foreign parent received HTTP 409 without stopping the process; owner cancellation returned `cancelled` and the real PID was then absent with ESRCH.
- Foreign-parent child cancellation returned HTTP 409. Generic Job cancellation of the subagent returned `unsupported` directing `session.cancelChild`; the child remained running. Owner `cancelChild` returned `cancelled`, then the native child wait returned HTTP 204.
- HTTP info exposed `sessionMessages`, `subagentOptions`, `childCancellation`, `jobControl`, `persistentPty` and `sessionMetadataMergePatch`, all true. The canonical gate and this demo used only scratch databases, configuration, providers and runtime stores.

The driver overwrites per-action receipt files on each control call, so the final `list.json` and `cancel-job.json` contain the later child phase. Shell ownership, cancellation and PID assertions ran during the successful driver execution; the final aggregate JSON records all four passing behaviors. No raw fake-provider request dump was needed for the parent handoff.

W1 released the desktop slot directly to [W12](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35a0c9d8ffeV0Ic4uhdjveeAc) after this installed proof, with the exact source SHA and installed stamp. Any subsequent W12 installation is a separate delivery; the receipts above remain bound to W1's vt-14.

## Limits

- Cross-process cancellation without a native owner route is intentionally `unsupported`; no success is inferred from a persisted claim alone.
- Native restart regressions exercise real services and durable recovery records, including modeled crash windows. This session does not claim a separate native-fan-out SIGKILL/restart installed demonstration.
- The deliberate v1 retry-header source/test divergence and the pre-existing `.gitignore` edit remained untouched.
- m4max is pending under the coordinator's explicit handoff: it remains on vt-9 and receives one native build after W12 publishes. W1 performed no Mac build and makes no claim that the new APIs are installed there.
- Forklog delivery uses managed worktree `v2-controls-log`, fast-forwarded into current `dev-nowaker` as one ordinary, unsquashed session commit. Only the four forklog paths are included.

## Earlier installed message and WAL proof

Before the pause, desktop vt-11 was built from clean published `398e98d11c`. The canonical gate passed 12/12 with no failures or skips, receipt `/home/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-08w6lf`. Installed native `todowrite`, completed manual compaction and plugin durable reads recovered todo metadata absent from compacted context, evidence `.vibeterm/tmp/opencode/w1-native-zryBMo/result.json`.

The WAL correction passed 28 guard/WAL tests and 75 assertions. Removing the read transaction reproduced a false poison refusal; restoring the exact owner returned green. Live and orphaned WAL-only legacy schema/poison were detected while main and pre-existing committed WAL bytes stayed unchanged. Read-only SQLite connections can create or update WAL/SHM bookkeeping. This corrects the earlier blanket byte-preservation interpretation; immutable mode is unsuitable because it hides committed WAL.
