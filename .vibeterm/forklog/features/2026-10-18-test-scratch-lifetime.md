# Run-owned test scratch

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch: `scratch-lifetime`
- First local commit: `a464343614`
- Current local commits: `a464343614`, `37cec96404`, `ba2e41f771`, `072812a052`
- Upstream base when introduced: `dfb56f76c7` (`v1.19.0`)
- Last checked against upstream: `dfb56f76c7`; no upstream publication requested

## Original request

> Also fix OpenCode test opencode-tui-test45 and opencode-test* residue in tab TMPDIR by per-run isolated scratch runner cleans after normal/error/concurrent runs, using existing conventions; Meridian5275732b is precedent, not copy requirement.

## Goals and constraints

- Every supervised invocation owns one unique scratch root. Failed test initialization, failed assertions, abrupt child exit and ordinary interruption must not bypass parent cleanup.
- Preserve another concurrent run's active files. Remove only the root allocated by this invocation, never historical files or shared caches.
- Isolate child HOME, XDG stores, tools/plugin data and Node/Bun runtime caches before Bun loads suite preloads.
- Direct `bun test` bypasses supervision; `SIGKILL` cannot run cleanup. These limits are explicit, not recovery guarantees.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `a464343614` | 2026-10-18 | Parent owns scratch through child exit and asynchronous deletion; signal protection covers the whole allocation lifetime | `script/test.ts`, `test/fixture/test-runner.test.ts` |
| `37cec96404` | 2026-10-18 | Route OpenCode/TUI package suites and OpenCode benchmark/profiler through the same supervisor | Both package `test` scripts; `bench-test-suite.ts`, `profile-test-files.ts` |
| `ba2e41f771` | 2026-10-18 | Document supervised invocation and direct-run bypass | `packages/opencode/test/AGENTS.md` |
| `072812a052` | 2026-10-18 | Compare the complete directory-entry list without depending on APFS/Linux enumeration order | Runner regression's active-fixture assertion |

## Verification

- From `packages/opencode`: `bun run test test/fixture/test-runner.test.ts` passes all eight real-process cases on Linux and macOS. A filesystem watcher signals the parent after recursive deletion starts, without sleeps or mocked filesystem APIs.
- Disabling removal made all six then-existing cleanup cases fail. The later teardown-interruption case failed on the initially reviewed runner and passed after signal protection covered initialization and deletion.
- Full TUI suite: 797 pass, one skip, zero fail. OpenCode fixture/home/filesystem/runner selection: 72 pass, zero fail before the eighth teardown case was added. Both package typechecks and all 30 workspace push-hook typecheck tasks pass.
- Full OpenCode suite hit a 20-minute outer watchdog without a complete summary. A selected five-file baseline and candidate both produced 28 pass, two fail: owner-admission timeout and an existing missing `SessionBusyError` OpenAPI response reference. No whole-suite green claim is made.
- Manual tmux checks covered supervised tests, help, malformed timeout, and installed-binary version/help/invalid input. See the linked session for host builds, evidence and caveats.

## Separate extraction ownership

- Concurrent Bun 1.4.3 `bun install --ignore-scripts` invocations sharing only a task-owned cache reproduce the large hash-named OpenCode platform-package directories without running OpenCode. A successful `RENAME_EXCHANGE` leaves the displaced cache tree at the extraction path.
- Exact Bun revision: `c6da4a4d3010e5553438c60f6bd76d981976867c`; directory publication is `src/install/extract_tarball.rs::move_to_cache_directory`, with the successful-exchange path in `src/sys/lib.rs::renameat_concurrently_without_fallback`.
- Sole external fix owner: `ses_eae4e752dffeqjIGjBdi5Grz7V`. No OpenCode reaper or speculative extraction change was added. A reusable `bunx-*` package cache remains owned by the invoking harness's temporary-root lifecycle.

## Timeline

- 2026-10-18 [`ses_eae7b2716ffeejeajH2nwHZP45`](../sessions/2026-10-18-test-scratch-lifetime.md) - Attribute both families, deliver the supervised test runner, verify real processes on both hosts, and hand Bun's confirmed cache-exchange defect to its accepted owner.

## Maintenance

- Use `bun run test [files or Bun test flags]` from `packages/opencode` or `packages/tui`.
- Keep signal handlers installed before scratch allocation and until recursive deletion finishes. Forward only to the active child and retain signal exit status during teardown.
- Recheck both package scripts and profiler/benchmark launchers after an upstream reorganization. Run the eight-case suite on Linux and macOS; directory enumeration order is not a filesystem contract.
