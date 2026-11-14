# Editable input before the full v2 TUI loads

## Identity

- Status: active. First user workday: 2026-11-11.
- Source integration: `v2-nowaker`; forklog integration: `dev-nowaker`; development branch: `early-input`.
- First implementation: `2a0a4c41a280ebe720b415bb01084879d10094e1`; executable entrypoint correction: `3c3d6ae0bd0e763e13d0e659be799a8d64ec6762`; adjacent namespace test correction: `2af4fdae50`; current logo correction: `25d9d35bb04beda2eeaff73c2eb262fb60d0e8b7`.
- Upstream release base: `fedc6f208aa2bd54c1019227214568083f6380ad` (`v2.2.7`); source integration parent: `8ea9dbc3f1f3e368f8e43b6400585c4a0f0511ac`. Build stamps retain `5f76acb125`; that stamp is not the source result SHA.
- Last checked against a newer upstream: TBD; this delivery rebased onto the fork's published integration, not a newer upstream release.

## Original request and goals

TBD - the original human Phase 2 prompt was not recovered in this documentation pass. The retained coordinator recovery request asks to finish the early input owner, compare timings against the preserved vt-9 binary, perform a gated installation and demonstrate it. [The source session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ) preserves that assignment and its subsequent constraints.

- Make the normal full TUI editable before heavy module evaluation and connection/history readiness.
- Transfer text, UTF-16 caret and selection direction, original unread input bytes and submission intent exactly once to the intended native composer.
- Keep actual Bun and Node packaging, signals and terminal ownership correct; preserve permission parking, delayed/failed continuation and explicit draft clears.
- This is the v2 implementation. The [v1 instant-prompt feature](./2026-10-06-tui-instant-prompt.md) retains its own implementation and upstream history.

## Stable seams

| Commit | Workday | Behavior | Stable seam |
|---|---|---|---|
| `2af4fdae50` | 2026-11-13 | Isolate default and explicit configuration roots in the adjacent namespace regression | `packages/cli/test/debug-paths.test.ts` |
| `2a0a4c41a2` | 2026-11-13 | Start a terminal worker before the CLI graph; transfer at a complete tokenizer boundary | `packages/cli/src/index.ts`, `main.ts`, `startup-worker.ts`; `packages/tui/src/startup/{index,worker,input,intake,reader,protocol}.ts` |
| `2a0a4c41a2` | 2026-11-13 | Keep one renderer/parser and a temporary native editor until route claim | `startup/{layer,composer,frame,editor,layout}.ts`; `component/prompt/index.tsx`; home/session routes |
| `2a0a4c41a2` | 2026-11-13 | Preserve workers and lazy entrypoints in native distributions | CLI `script/build.ts`, `script/build-node.ts`, `vite.node.config.ts`, `src/node/{index,loader,main}.ts` |
| `3c3d6ae0bd` | 2026-11-13 | Retain executable mode on the startup entrypoint | `packages/cli/src/index.ts` file mode |
| `25d9d35bb0` | 2026-11-14 | Dim the wordmark's shadow cells without changing visible centering | `packages/tui/src/startup/frame.ts`; `test/startup/editor.test.ts` |

The Bun reader performs `fs.readSync` and intake synchronously on an owned nonblocking descriptor; no asynchronous read can consume bytes after transfer. Node retains its event-driven reader. Pending Escape/token state keeps its deadline and complete-byte cutoff. Windows deliberately bypasses this Unix early owner.

The native bridge restores shared selection before parsed key/paste dispatch and raw mouse parsing, captures the actual resulting native selection, and removes only wrappers it still owns. Edited-then-cleared drafts consume superseded saved state; untouched drafts retain ordinary restoration.

## Verification and evidence

- Final source approval, related tests, mutation controls, compiled Bun/Node SEA proofs, native installation receipts and the full timing table are in the [November 13 session record](../sessions/2026-11-13-v2-early-input.md).
- Focused TUI verification: 104 pass, 0 fail, 400 assertions across seven files. Adjacent CLI verification: 28 pass, 0 fail, 113 assertions. Canonical `bun run check`: 34 tasks pass, 554 warnings and zero errors.
- Forty vt-9 and forty vt-28 samples use the same frozen W7 harness. AFTER first-visible-input medians are 86-95 ms, with zero HTTP calls before visible input. All twenty session cases precede the history-title marker; the old history-title-at-first-input assertion fails. These are separate verdicts, not a full-history-readiness or controlled causal speedup claim.
- Eight vt-28 visual cases pass at 44/100 columns in light/dark on home/session routes. Native continuation, selection, sixty-character handover bursts and exact prompt counts have separate real-PTY proofs.
- The [November 14 record](../sessions/2026-11-14-v2-early-input.md) independently qualifies installed vt-33 with eight visual and six controller cases. A persistent complete-frame wordmark defect is fixed in source with two red/green regressions and production-frame pixel checks; installation waits for W1's already-planned gated build. The coordinator accepts the installed cosmetic limitation only until that build.

## Timeline

- 2026-11-11 [source session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ) - Phase 2 ownership implementation and frozen BEFORE evidence began; the later delivery record below retains the verification and publication outcome.
- 2026-11-13 [delivery record](../sessions/2026-11-13-v2-early-input.md) - corrected review findings, published the three-commit series to both mirrors, installed desktop vt-28 and native m4max vt-30, and retained comparison, visual and controller evidence.
- 2026-11-14 [desktop requalification](../sessions/2026-11-14-v2-early-input.md) - installed vt-33 input/layout and controller proofs pass; source-only wordmark correction `25d9d35bb0` is normally published to both mirrors, with no separate build. Current Mac checks follow the coordinator's host release.

## Maintenance and scope

- No public Protocol/HttpApi or generated client changed. No new user flag or public full-ready marker was added.
- A caller can supply `--prompt TEXT`; arbitrary external draft/caret/parser injection remains unsupported. Internal `Snapshot` and `Transfer` are in-process contracts, not a cross-process API. `--server` still performs its existing single request with a five-second abort deadline.
- Upstream candidate: general startup responsiveness, input ownership and worker packaging. No upstream PR was opened here. The fork's namespace policy remains separate.
- On a bump inspect worker packaging and every ownership/cleanup seam, run focused startup/lifecycle tests and affected package checks, then use the canonical gated host installer. Preserve protected serve processes.
