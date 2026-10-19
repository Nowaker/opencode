# Extracted-binary attribution and test scratch lifetime

## Identity

- Workday: 2026-10-18
- Session: `ses_eae7b2716ffeejeajH2nwHZP45`
- Coordinator: `ses_eeda1d251ffel81U5Y42j4kb33`
- Agent/platform: Hephaestus / Linux; m4max build worker `ses_eae275e71ffeQgdlMj3gkxOhaD`
- Integration branch: `dev-nowaker`; development branch: `scratch-lifetime`
- Initial primary: `885476e99f`; upstream base: `dfb56f76c7` (`v1.19.0`)
- Source results: `a464343614`, `37cec96404`, `ba2e41f771`, `072812a052`
- Forklog commit: this record's introducing commit, separate from source commits

## User request

> Resolve source-owned leak of extracted OpenCode binaries and suite temp fixtures.

> If extraction belongs external owner and cannot fix locally, complete test lane then return exact narrow handoff instead of speculative code.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Run-owned test scratch](../features/2026-10-18-test-scratch-lifetime.md) | Delivered | Parent-supervised suite commands; eight real-process regressions on both hosts |

## Attribution and source result

- OpenCode fixtures allocate `opencode-test-*` under `os.tmpdir()`; its preload only removes `opencode-test-data-PID`. TUI fixtures allocate `opencode-tui-test-*`. Individual finalizers cannot clean a fixture whose initialization never returned.
- `script/test.ts` allocates one unique root, isolates child environment paths, forwards arguments/stdin/stdout/stderr and ordinary signals, awaits the test child, then removes only that root. Handlers cover allocation through asynchronous removal; signals during teardown do not target a finished child.
- Package tests and OpenCode benchmark/profiler use the supervisor. Existing per-fixture finalizers remain unchanged. Direct `bun test` and `SIGKILL` remain explicit limitations.
- The original seven-case implementation passed its tests but Oracle rejected a signal-lifetime gap outside the live-child wait. A real filesystem-watcher test failed before the fix and passed afterward. Oracle `ses_eae3d1fe5ffeH4WIwYKrgvdbA1` approved the corrected lifecycle. Main independently read all changed files and reran eight cases; it also approved the APFS sorting correction without reducing the expected entry set.

## Extraction handoff

- Actual writer: Bun 1.4.3 revision `c6da4a4d3010e5553438c60f6bd76d981976867c`, `/usr/bin/bun`. Trace TID 2069454 belonged to TGID 2067500, parent strace PID 2067498.
- Two cold `bun install --ignore-scripts` processes with separate HOME/TMPDIR/XDG paths and a shared task-owned Bun cache both exited zero. `RENAME_NOREPLACE` returned `EEXIST`, then `RENAME_EXCHANGE` succeeded; four displaced platform-package trees remained, containing 763822912 executable bytes. Neither OpenCode nor npm lifecycle scripts ran in this decisive scenario.
- A single cold install promoted staging normally. Crossing tmpfs/ext4 alone correctly moved staging into the cache's `.tmp` directory. Direct installed `--version` did not leave the large hash-named package directories. These controls separate package-cache publication from compiled-binary extraction.
- Bun's exact directory seam is [extract_tarball.rs](https://github.com/oven-sh/bun/blob/c6da4a4d3010e5553438c60f6bd76d981976867c/src/install/extract_tarball.rs#L661-L699) calling [renameat_concurrently_without_fallback](https://github.com/oven-sh/bun/blob/c6da4a4d3010e5553438c60f6bd76d981976867c/src/sys/lib.rs#L8925-L9002). Its successful-exchange branch does not delete the displaced source tree. The initially returned manifest-file cache seam in `npm.rs` was rejected as the wrong directory owner before handoff.
- Coordinator accepted sole Bun fix owner `ses_eae4e752dffeqjIGjBdi5Grz7V`. No Bun fix or OpenCode extraction reaper is claimed by this session.
- Retained Linux attribution evidence: `/home/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-scratch-lifetime/creator-7UDCUe/`, including `journal.txt`, `install-race-b-fs-only/fs.2069454`, process relations and cleanup receipt. Both allocated repro roots were removed after all 139 traced PIDs exited; no historical junk was touched.

## Verification and limits

- Eight runner cases pass on Linux and macOS: success, assertion failure, abrupt exit, failed preload, independent parallel active files, SIGTERM, SIGHUP and signal during asynchronous deletion. Mac's initial 5 pass / 3 fail exposed only APFS directory enumeration order; `072812a052` sorts the complete expected entry list. Corrected Mac run: 8 pass, zero fail, 2.20 seconds, temporary root empty.
- Linux TUI: `bun run test` gave 797 pass, one skip, zero fail across 104 files. OpenCode fixture/home/filesystem/runner selection gave 72 pass, zero fail before the final teardown case was added. Both affected package typechecks passed; normal push hooks passed all 30 workspace tasks.
- Full OpenCode run exceeded the outer 20-minute watchdog and has no complete summary. Selected raw baseline and supervised candidate both gave 28 pass / 2 fail across five files: owner-admission's 15-second timeout and the missing `SessionBusyError` OpenAPI response schema. Four additional broad-run timing/global-state failures were not independently attributed by this session and remain unclassified, not claimed fixed.
- Manual Linux tmux checks: final runner 8 pass / zero fail; runner help exit zero; malformed timeout exit one. Installed binary version/help/invalid-format checks returned 0 / 0 / 1 on Linux and macOS.
- Local QA evidence: `/home/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-scratch-lifetime/`. Relevant logs include `teardown-red.log`, `teardown-green.log`, `runner-portable.log`, `runner-cli-final.log`, both baseline/candidate failure logs, `tui-suite.log`, `desktop-build.log` and `desktop-build-receipt.json`.

## Host builds and preservation

- Each host built its own checkout through tracked `.vibeterm/build.sh`; no copied distribution and no skipped migration guard. Later `072812a052` changes only a test assertion and is not bundled into the executable.
- Desktop: installed `1.19.0-vt-357-dfb56f76c7` after normal guard checks using npm v1 `1.19.3` and v2 `2.0.32`. Inode `49970848 -> 49970850`; retry marker present. Both protected systemd MainPID/start snapshots were identical, with MainPID zero for both units. The first build compiled but refused installation because the guard was absent from PATH; setting its explicit executable path resolved this without bypassing the gate.
- m4max: independently built source `ba2e41f771`, installed `1.19.0-vt-355-dfb56f76c7`; inode `43444462 -> 43492693`, retry marker present. The normal guard used cached v1 `1.19.0` / v2 `2.0.29` after its disk-reserve refusal, without version/policy overrides; all six poison checks and both guarded v1 serving checks passed.
- Mac receipt directory: `/Users/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-scratch-lifetime/m4max-eae275-receipts-dE0fFz/`. `runner-portable.log` and `runner-portable-receipt.txt` record the final parent-run acceptance after source fast-forward to `072812a052`.
- Deliberate `.gitignore` and retry divergence were not altered. Mac dirty-file and lockfile hashes remained identical. Relevant launchctl rows stayed unchanged. During the earlier long Mac build lane, eight baseline OpenCode PIDs disappeared independently; the worker issued no kill/restart against them, so universal process preservation is not claimed. The final short Mac acceptance run preserved its complete relevant launchctl snapshot.
- No protected serve unit, live TUI, default Vibeterm server or Meridian was restarted. Only task-owned test children and the isolated QA tmux session were terminated.

## Cleanup and provenance

- Two interrupted Linux QA roots were enumerated and identity-checked, confirmed unheld with `lsof`, then removed separately; `qa-cleanup-manifest.json` and `qa-cleanup-receipt.json` retain exact paths/inodes. All other QA/build roots were invocation-owned and removed after child exit. Mac cleanup receipts retain the same ownership boundary.
- Source branch was rebased onto current local primary and fast-forward integrated, preserving parallel fresh-database and compaction commits. Source and portability correction were pushed to both fork mirrors with normal hooks.
- Attribution correction: source commits `a464343614`, `37cec96404`, `ba2e41f771` and `072812a052` incorrectly carry `AI-Harness: Vibeterm 6a72be9ff9b`. This session's authoritative mandatory context specifies `AI-Harness: Vibeterm bb283034b84`, which is the correct harness for all four. Other recorded agent trailers and human identity are unchanged. History is preserved under the explicit no-amend/no-force constraint; this record corrects the provenance, and its own commit uses the authoritative trailer.
- Required session trailer: `AI-Session-ID: ses_eae7b2716ffeejeajH2nwHZP45`.
