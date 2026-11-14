# W4 Phase 2 early input and reconnect delivery

## Identity and assigned scope

- User workday: 2026-11-13, including its after-midnight continuation. Phase 2 work began November 11; the [earlier Phase 0/metadata record](./2026-11-10-v2-patches.md) remains separate.
- Session: [ses_e37e57935ffeTjd0whAV8iFPzQ](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ); coordinator: [ses_e383ee7faffe6JX8m2EP26dXUC](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC).
- Agent/platform: Hephaestus, `openai/gpt-6.1-sol`, xhigh, Linux. Source integration: `v2-nowaker`; documentation integration: `dev-nowaker`.
- Development branches: `early-input`, `reconnect-toast`; documentation branch: `phase2-tui-records`.
- Upstream release: `v2.2.7`, `fedc6f208aa2bd54c1019227214568083f6380ad`. Stamp suffix `5f76acb125` is distinct from the source SHA.

The original human prompt is TBD in this documentation pass. The retained November 13 coordinator recovery request explicitly says to finish the early input owner, compare against the preserved vt-9 binary, install through the canonical gate and demonstrate it. One desktop build at a time, more than 30 GB available memory, memory PSI full avg60 below 5, at most two children and serial focused tests were required. All proofs used owned HOME/XDG/config/DB/tools/plugins and loopback fixtures; no real provider or live v2 state was used.

## Source and features

| Commit | Result | Feature |
|---|---|---|
| `45a7c497966461ae3d7bba19192fb794095f9227` | Retry typed migration-status transport failures while preserving actual failures and unrelated notices | [Reconnect status](../features/2026-11-11-v2-reconnect-status.md) |
| `2af4fdae50` | Correct adjacent configuration-root fixture for the isolated v2 namespace | [Early input](../features/2026-11-11-v2-early-input.md) |
| `2a0a4c41a280ebe720b415bb01084879d10094e1` | Full default TUI early terminal owner and native renderer/composer handover | [Early input](../features/2026-11-11-v2-early-input.md) |
| `3c3d6ae0bd0e763e13d0e659be799a8d64ec6762` | Keep the CLI entrypoint executable | [Early input](../features/2026-11-11-v2-early-input.md) |

The source series rebased above published `8ea9dbc3f1f3e368f8e43b6400585c4a0f0511ac`, fast-forwarded into `v2-nowaker` and normally pushed to both fork mirrors; both live tips were verified at `3c3d6ae0bd`. No protected integration history was rewritten. General early-input ownership/packaging and the typed reconnect correction are upstream candidates; no PR was opened. No public Protocol/HttpApi or generated client changed.

## Review and source checks

- The initial review rejected failed continuation handling, proof of Bun read ownership, parked state, swallowed acquisition errors and unchecked assertions. The second round reproduced native selection loss before route claim. Corrections use synchronous nonblocking intake, exact live-selection restoration before key/paste/mouse dispatch, wrapper-ownership cleanup and retained explicit-clear history.
- [Final Oracle review](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e27e2c230ffeeQ1mq8akefwGRW) approves source readiness with high confidence and no required findings. It is bound to the corrected source hashes, not the rejected intermediate candidate.
- Final rebased TUI run: 104 pass, 0 fail, 400 assertions, seven files; `/home/nowaker/.local/share/opencode/tool-output/tool_1d84d96d400187ZyO4rv7zmcGv`.
- Adjacent CLI run: 28 pass, 0 fail, 113 assertions; `/home/nowaker/.local/share/opencode/tool-output/tool_1d84dfd07001lCA0o78BMcYble`.
- Canonical `bun run check`: 34 tasks pass, 554 warnings, zero errors; `/home/nowaker/.local/share/opencode/tool-output/tool_1d85199a3001TiHlDy0N9AKJ75`. Affected source diagnostics and TUI package typecheck pass. Unchanged unrelated formatting hunks were not reformatted.
- Mutation controls cover discarded bytes, wrong offset units, incomplete-token cutoffs, lost anchors, wrong route claim, parked Enter, short writes, cached-only native selection, omitted mouse restoration, wrapper clobbering, lost dirty history and stale saved drafts. Each meaningful control fails and source is restored byte-identically.
- An earlier child adjacent run observed one unchanged session-home page-cancel failure, then that file passed 17/17 twice. Two fixture `GET /health` observations have no established cause. They were not suppressed or presented as diagnosed; final owned focused runs above are clean.

## Native builds and runtime proofs

- Desktop source `3c3d6ae0bd` built and installed once through `.vibeterm/build.sh --v2`, with the mandatory preinstall runtime gate: 12 pass, 0 fail, 0 skip. Native artifact `cmp` passed. Installed `opencode v2.2.7-vt-28-5f76acb125`, inode `49972574`, 240438384 bytes. V1 and both protected serve PID/start identities were unchanged around this installation.
- Desktop gate: `/home/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-tKdqmY/report.json`; build log: `/home/nowaker/.local/share/opencode/tool-output/tool_1d85399d9001zY6lxGbj5grP53`.
- An actual Node SEA executable was built sequentially from the canonical app archive and checksummed Node 26.4.0. Shipped `--version`/`--help` and real PTY startup cases passed. Log: `/home/nowaker/.local/share/opencode/tool-output/tool_1d85b85b5001JzPQu6TwS2fkCJ`. Build outputs were later removed by managed retirement; source/recipe/logs remain.
- Compiled Bun and SEA prove held-connection Unicode/caret/selection editing, all sixty burst characters, native continuation `abcZ` without a prompt POST, exactly one early-Enter submission, zero edited-seed submission, one untouched-seed submission, bypasses and cleanup.
- Signal-test correction: existing `packages/cli/src/shutdown-deadline.ts` converts runtime SIGHUP to SIGTERM. Forced pre-import source proof requires 129; runtime proof first observes a real HTTP request and requires 143. No production signal code changed. Corrected compiled keeper: `tool_1d86092480014y0xKHWTQ6E6NW`; SEA keeper: `tool_1d8617ec4001J6FsBepzRQNSkT`; full SEA: `tool_1d85dbc69001xz9DPgoELK8BOa`, all in `/home/nowaker/.local/share/opencode/tool-output/`. The earlier compiled log `tool_1d85ce6b9001PA3tjmq2BY0G7N` contains the obsolete phase-ambiguous expectation and is not an all-green signal receipt.
- At coordinator direction, the one native m4max build used W1's published Core guard source `f22a3cca010ec09e59fce4aa3ff7b7f1fedf7ca9`, a descendant with no CLI/TUI diff from `3c3d6ae0bd`. It installed host-built `opencode v2.2.7-vt-30-5f76acb125`, inode `74931944`, 231786018 bytes; canonical gate 12/12, native `cmp`, scratch `--version` and `/api/info` 200 pass. V1 before/after remains inode `74219429`, 182209968 bytes. No binary was copied between hosts.
- Mac gate: `/Users/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-yX65oC/report.json`; installed smoke: `/Users/nowaker/projects/webapps/opencode/.vibeterm/worktrees/v2-nowaker/.vibeterm/tmp/w4-installed.OCuI5z/result.json`; desktop-captured build log: `/home/nowaker/.local/share/opencode/tool-output/tool_1d86617af001Cd1GdJVmqAVjo1`.
- Historical Mac compiled proof: all eight families pass; `/home/nowaker/.local/share/opencode/tool-output/tool_1d891ac0c0016GWgG6fL2nEy6P`. Mac log: `/Volumes/projects/webapps/opencode/.vibeterm/worktrees/v2-nowaker/.vibeterm/tmp/phase2-pty/proof-compiled-1794634789031-69205.log`. Per-thread CPU was not measured there because the harness counter uses Linux procfs.
- W1 separately installed desktop vt-30 from `f22a3cca01` with gate `run-d1vPK0`; that later desktop build is W1's delivery, not W4's. A subsequent subscription `SQLITE_BUSY` error did not undo the native Mac build and did not cause a duplicate build. Both build slots were released.

## First input is distinct from full readiness

The frozen W7 harness hash is `557d1c602d2d8c5e184053774490ca6b953c40d9be9ec28ad234cb29ca5c7cff`. Both campaigns contain eight cases with five samples each. BEFORE binary vt-9: SHA-256 `fd7dd6d8dc5a6500033fb5430e2c35ba16eaaa123dac67a270aabc3857157d39`, 239996016 bytes. AFTER immutable vt-28: SHA-256 `64ca565ea7ac0c90cf0dc245078932a78e766d22283dc694de964c3ed10ec08b`, 240438384 bytes. Both snapshots remain in `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/` as `opencode2-phase2-before-vt9` and `opencode2-phase2-after-vt28`.

Case digits mean session/cold/plugin. Values are milliseconds: median [complete range].

| Case | BEFORE | AFTER |
|---|---|---|
| 000 | 2768 [920-4256] | 95 [92-217] |
| 001 | 1342 [1225-3475] | 93 [83-108] |
| 010 | 4549 [1586-5078] | 86 [83-109] |
| 011 | 3053 [2593-6373] | 90 [55-105] |
| 100 | 2735 [2337-5380] | 90 [82-100] |
| 101 | 5130 [2786-10832] | 89 [86-97] |
| 110 | 4382 [2895-5299] | 88 [76-102] |
| 111 | 4756 [4005-6017] | 89 [84-104] |

The independent raw-ledger audit passes all forty AFTER samples, exact typed probes/timestamps/byte totals/fingerprint, eight case counts and twenty plugin witnesses. Zero HTTP calls occur before first visible input; all twenty session samples precede the fixture history-title marker. The original verifier FAILS its history-title-at-first-input assertion (`tool_1d86a3851001I39OVrdN4ONSEt`). It was not weakened. Full composer/history readiness is separately exercised by native PTY and visual cases. Different desktop load and intervening sibling source prevent an isolated causal speedup claim; these observations are not vt-33 measurements.

Raw data and independent audit: `/home/nowaker/projekty/tmp/v2-phase0-proofs/tui-coldstart/{results-phase2-before-selected-40.json,results-phase2-after-selected-40.json,verification-phase2-after-first-input.json}`. Audit output: `/home/nowaker/.local/share/opencode/tool-output/tool_1d893efd7001NxghARjSXFJ3r0`.

## Visual evidence and controller demonstration

- Independent vt-28 review passes eight home/session x 44/100-column x light/dark cases, inspecting all twenty-four standard and eight extra early frames. Complete mixed-script drafts wrap and retain the caret after `zz`, with no clipping/overlap/toast. Home first editable frames appear at 13-25 ms. Two dark home cases visibly accept the draft in the early editor and carry it into the full composer.
- The early editor uses terminal-default colors and dim text, without the full model/footer/background. A placeholder marker alone is not complete composer readiness. A real temporary-logo cosmetic finding makes its shaded `n` read as `o`; final full logo is correct. The later correction/disposition belongs in the current closing record.
- Evidence: `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/phase2-visual/{before,after}/`; review `after/review/notes.txt` and `zoom-logo-early-final-beforeready.png`. QA-only `capture-after.ts` handles an honestly empty startup frame with a no-op replay and adds an early diagnostic frame; frozen `capture.ts`, cases/probe/clocks/readiness rules remain unchanged. Runner SHA-256 `bfd00f9c7674106b4ce1a53cd2f14fa51b860f5b42126ef4269b8e57c3530c24`.
- [V1 controller demo](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e36494458ffe4L6LxO9w7Ak2jY) ultimately passes all six vt-28 compiled cases, exit 0. Main recovered and read its actual log on November 14: `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/phase2-native-proof/proof-compiled-1794635134675-2425279.log`. Early entry/typed text/cursor repaint were observed at 38/78/99 ms, not a controlled benchmark. Exact final Unicode/selection text matches, all sixty burst characters survive, native continuation yields `abcZ` with zero POSTs, and session/edited-seed/untouched-seed POST counts are 1/0/1. Two cases emit explicit normal-exit/alternate-screen/no-descendant receipts; no separate cleanup receipt is printed by the other four.

## Evidence preservation and limits

- Canonical source/Node bundle/SEA scripts, logs and receipts were preserved as 309 byte-compared files (6148656 bytes) in `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/phase2-native-proof/`, manifest `preserved.json`.
- Verified cache/log archive cleanup recovered 2767 MiB net; archive `w4-prune-eGevz8/preserved.tar.zst`, SHA-256 `bfa0ba881be127872879da3305fdea0e2dcf14195afa5d861b6c2897f870dd50`. Managed retirement of `early-input` and `reconnect-toast` recovered another 9985 MiB by last-link accounting, retaining branches/salvage refs; receipt `w4-retired-result.json`. Paths are under the same opencode scratch root. No live cwd/fd/mapping was removed.
- W15/W18 received the existing internal handover and focused-editor inspection contracts. Arbitrary cross-process draft/caret/parser transfer remains an integration gap; no new public API or full-ready marker was invented.
- Full session identity remains in every fork-authored commit. This record's introducing commit is discoverable through its file history; it cannot name its own eventual hash.
