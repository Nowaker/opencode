# W13 awaited compaction summary completion

## Identity and scope

- Session: [ses_e353f4451ffeLxU5ojxVo28GCb](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e353f4451ffeLxU5ojxVo28GCb).
- Coordinator: [ses_e383ee7faffe6JX8m2EP26dXUC](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC).
- Repository: `/home/nowaker/projekty/webapps/opencode`; source branch `compaction-summary` into `v2-nowaker`; forklog branch `compaction-record` into `dev-nowaker`.
- Agent: Hephaestus, `openai/gpt-6.1-sol`, xhigh, Linux.
- Work began November 11, was explicitly paused for desktop memory pressure, and resumed November 13. The original v1 checkout and its deliberate retry/header and `.gitignore` changes were untouched.

> Add an AWAITED compaction-summary completion stage for plugins:

The assignment requires real identities, pre-publication awaiting, failure propagation, local generation stop boundaries and prior-summary edit retention. W10 owns the native database ledger adapter. The coordinator explicitly changed closing scope on November 13 to a stage-only plugin demo, with the real-ledger controller demo following once W10 delivers its adapter.

## Source and API

- [Awaited v2 summary completion](../features/2026-11-11-v2-compaction-summary.md): source `17d20080b1d287604eedfa405c4fa02b28069967`, based on published `45a7c497966461ae3d7bba19192fb794095f9227` after rebasing from `398e98d11c` through W1/W12's `72527fce0c`.
- The [v1 compacting-hook record](../features/2026-10-18-compacting-hook-summary.md) links its v2 counterpart and no longer says v2 has no plugin hook. Its v1 implementation and historical evidence are unchanged.
- W10 explicitly agreed the API before coding. An attempt ID does not imply a durable message row. Held candidates retain the original generation cutoff and snapshot metadata, then bind to the actual compaction marker at adoption.
- Textual completion includes hook-supplied summaries and ordinary native metadata. Provider replacement windows skip textual completion; preparation exposes them so a plaintext retention plugin can reject them honestly.
- Callback failure records `compaction.failed` with generated usage, without a provider retry. Manual interruption settles once with `aborted / Compaction cancelled` and usage retained.
- Both plugin SDKs document the contract; `compactionSummary` is advertised in app capabilities and server info. Generated clients were regenerated, not edited by hand.

## Verification

- Baseline: 48 compaction/native/transport tests passed, 292 assertions.
- The external W10 witness on installed vt-11 establishes observer mutation cannot change durable summary, compaction bypasses ordinary text completion, reserved generated text reaches deltas, and the old ledger reader lacks the v1 message table on v2. It is a diagnostic witness, not positive adapter acceptance.
- Final focused command from `packages/core`: `bun run script/test.ts test/session-compaction-summary.test.ts test/session-compaction-stop.test.ts test/session-compaction-precompute.test.ts test/session-compaction.test.ts test/session-compaction-transport.test.ts test/session-native-compaction.test.ts test/session-runner.test.ts --test-name-pattern 'compaction|summary|background adoption|provider replacement|speculative|boundary|preparation snapshot'`: 124 pass, 0 fail, 188 filtered out, 859 assertions.
- Mutation proof: disable completion dispatch, local matching and prior projection; five selected tests fail. Restore the implementation and the focused run passes. Review regressions independently fail on missing native-metadata completion, missing interrupted usage, and two generations when conversation/summarizer identities are confused.
- Typechecks pass in Core (2,069 files/two projects), Plugin (331 files), Protocol (152), Server (1,652/two projects) and Client (179). Changed-file lint: zero warnings/errors. Canonical `bun run check` passes, including all 34 workspace typecheck tasks; both normal push hooks pass the same 34 tasks.
- [Oracle review session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35368854ffekuEbaIF7lZAk4y) accepted all three corrections and then accepted the untouched-checkpoint recombination. It performed source inspection only; main ran the tests.

## Publication, installation and demonstration

- Both live source remote tips verified as `17d20080b1d287604eedfa405c4fa02b28069967`; local `v2-nowaker` fast-forwarded from `45a7c49796`.
- Desktop canonical command: `GIT_MASTER=1 OPENCODE_SRC=/home/nowaker/projekty/webapps/opencode/.vibeterm/worktrees/compaction-summary VIBETERM_V2_PROBE=/home/nowaker/projekty/nowaker/opencode-tools/vibeterm-opencode-client/bin/vibeterm-v2-probe bash /home/nowaker/projekty/webapps/opencode/.vibeterm/build.sh --v2`. It exits zero after the full native/embedded-app build and mandatory 12/12 gate, with zero failures/skips. Immediately before launch, MemAvailable was 73,825,032 kB and memory PSI full avg60 was 1.27, within the coordinator's gate. Full build output: `/home/nowaker/.local/share/opencode/tool-output/tool_1d692d06e001g6gsWWx4wJ4ov4`; probe report: `/home/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-iTtTLm/report.json`.
- Installed `opencode v2.2.7-vt-17-5f76acb125`, inode 49971753, 240,254,064 bytes, compares byte-identical to the tested native artifact. V1 retains inode 49972526 and 198,921,328 bytes. Protected serve units retain inactive state, PID 0 and start fields 285713642691 / 0; W13 restarted no live process or service.
- Main installed stage proof: `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/w13-proof-6Ahha2/result.json`, run through the reusable `w13-proof.ts` and `w13-proof-plugin.ts` beside it. A real Promise plugin gates completion on a release file; the actual marker remains running until release, then the summary persists two frozen source records. Cross-delta stop text never reaches deltas. A subsequent rejected callback yields a failed compaction with 100 input tokens retained. The first driver incorrectly retried compaction with no new conversation and reached `compaction.unavailable`; adding a normal turn makes the rejection case exercise the intended stage. No engine change was needed.
- [V1 stage controller demo](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2960da49ffe1jpoRnmJwy1z3I) passes and quotes the actual saved summary and receipt with `controller` / `v2 session` labels. Main independently reads `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/w13-proof-cXlwm7/result.json`, verifying vt-17, held completion, appended records, clean deltas and rejection with usage. Its engine receipt records exit code zero; the main proof's engine also exits zero. The desktop slot was released to the coordinator immediately afterward.
- The controller remains v1 and drives only scratch v2 HOME/XDG/config/database/tools/plugin stores with a loopback fake provider. No live v2 database, user process, service or default tmux server is a test target.
- W4 independently verifies the included toast fix on the same installed vt-17: its TUI survives a same-port engine restart, live tabs reload works, and the recovered screen has no stale migration toast. W4 reports an unchanged installed inode/size/mtime and owned-resource cleanup at `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/w4-installed-reconnect/run-YRiJZk/receipt.json`.
- m4max: no build authorized for W13. The coordinator receives source-update and canonical host-native build commands after desktop delivery.

## m4max commands for the coordinator's assigned slot

Run these only after the coordinator grants the Mac build slot. Each host builds from its own published source; no binaries or dependency trees are copied.

```sh
export PATH="/opt/homebrew/bin:$PATH"
repo="$HOME/projects/webapps/opencode"
tools="$HOME/projects/nowaker/opencode-tools/vibeterm-opencode-client/bin"
GIT_MASTER=1 git -C "$repo" fetch origin dev-nowaker v2-nowaker
test "$(GIT_MASTER=1 git -C "$repo" symbolic-ref --short HEAD)" = dev-nowaker && GIT_MASTER=1 git -C "$repo" merge --ff-only origin/dev-nowaker
"$tools/vt-worktree-create" branch=v2-nowaker parent=origin/v2-nowaker directory="$repo" install=false
tree="$repo/.vibeterm/worktrees/v2-nowaker"
test "$(GIT_MASTER=1 git -C "$tree" symbolic-ref --short HEAD)" = v2-nowaker && GIT_MASTER=1 git -C "$tree" merge --ff-only origin/v2-nowaker
GIT_MASTER=1 git -C "$tree" merge-base --is-ancestor 17d20080b1d287604eedfa405c4fa02b28069967 HEAD
GIT_MASTER=1 OPENCODE_SRC="$tree" VIBETERM_V2_PROBE="$tools/vibeterm-v2-probe" bash "$repo/.vibeterm/build.sh" --v2
```

## Provenance and follow-up

- The unpublished source commit initially contained an incorrect harness trailer. The coordinator authorized a message-only correction to `AI-Harness: Vibeterm 54d31d38908`; tree comparison after that amend is empty. No published or integration history was rewritten.
- Required source/forklog trailer: `AI-Session-ID: ses_e353f4451ffeLxU5ojxVo28GCb`.
- Production native ledger adapter and real-ledger acceptance/demo remain W10's explicitly assigned follow-up. No retention parity is claimed by this host API record.
