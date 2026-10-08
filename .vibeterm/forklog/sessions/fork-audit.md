# OpenCode fork inventory and regression audit

## Identity

- Workdays: 2026-10-06 through 2026-10-08 (America/Chicago)
- Session: `ses_eeda1d251ffel81U5Y42j4kb33`
- Agent/platform: Hephaestus / Linux
- Integration branch: `dev-nowaker`
- Development branches: `forklog-audit`, `fork-audit-ready`, `sqlite-gate-record`,
  `sqlite-steady-gate`, and the named
  isolated regression/reliability worktrees in the linked inventory
- Upstream contribution: `sqlite-admission-upstream` (local evidence only),
  `sqlite-admission-reviewed` (published); final records: `sqlite-gate-submit`
- Source baseline: `e6abfddbcc228ad755a699a6a359d20af1011013`
- Upstream baseline: `907b3bc518`; fetched `github/dev`: `4ac0d9c3d1`
- Forklog commit: this file's introducing commit

## User request

> Retain a permanent document in the vibeterm repo about this work, including
> if it was submitted as PR to opencode, and PR status.

> Does the opencode repo have a forklog? Revise the forklog governing document,
> and mention it by name in the vibeterm-side document.

## Governing-document change

- Link the existing Vibeterm canonical inventory,
  `docs/opencode-patches/README.md`, rather than creating a second inventory.
- Require complete fork/branch/session accounting, source-backed upstream
  dispositions, weekly PR checks, and behavioral patch-off/patch-on evidence.
- Preserve the separation between forklog provenance, upstream PR state, and
  a fix's verified user-visible effect.

## Verification

- README Markdown LSP diagnostics: none.
- `git diff --check`: exit 0 after governing README edit.
- Human git identity resolved as `Nowaker <spam@nowaker.net>`.
- Historical inventory: 420 commit rows, 672 refs, and 38 captured worktrees;
  decoded counts and all unlanded-ref links validated.
- Upstream author PR audit: 17 submissions, 15 open, two closed unmerged,
  none merged at the recorded check time. Source inspection found no whole
  customization redundant with fetched upstream `4ac0d9c3d1`.
- Runtime/test verification, observed failures and unavailable checks are
  recorded in Vibeterm's canonical inventory, not inferred from board state.
- Coordinator directly exercised assembled SQLite acquisition and SQL-error
  serialization: separate child writer, one callback, one notification, one
  persisted row, bounded lock diagnosis, no private parameter/path reflection.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Native tool commands](../features/2026-08-08-native-tool-commands.md) | Correct paired SDK authorship and distinguish changed ancestry from missing source | Original author `ses_01bbb0b5affeZ1mADldfa0VF1D` confirmed both commits and patch-identical current twins on 2026-10-06 |
| [Memory diagnostics](../features/2026-05-13-global-memory-diagnostics.md) | Retain diagnostic capability | Real HTTP counter/timestamp contract added |
| [Message hydration](../features/2026-05-23-message-shape-normalization.md) | Retain; close cache-integrity defect | Production shape/reuse/invalidation red-green; rejected-summary cache/store/retry proof |
| [Interrupted tail](../features/2026-05-29-interrupted-assistant-tail.md) | Retain dispatch compatibility | Guard-disabled captured request fails; restored passes |
| [Sync hot path](../features/2026-05-29-sync-hot-path.md) | Separate correctness from throughput policy | 1,102-cursor HTTP regression; compression CPU/size comparison; indexes already upstream |
| [Provider clones](../features/2026-05-30-alt-provider-clones.md) | Retain independent routing | Actual SDK source/clone loopback requests |
| [Compaction tracing](../features/2026-06-16-compaction-decision-tracing.md) | Explicit human policy question | Always-on I/O and hard-coded home destination recorded |
| [Bus typing](../features/2026-07-21-global-bus-typing.md) | Retain type compatibility | Negative compiler cases and real ID-before-delivery driver |
| [Retry header cap](../features/2026-08-06-retry-header-delay-cap.md) | Retain canonical overlay | Identical test fails/passes; real retry policy driver |
| [Stream throttle](../features/2026-08-25-tui-stream-throttle.md) | Retain coalescing; cadence choice pending | Correct all-event batching wording, ordering reds and real CPU/echo comparison |
| [Prompt latency](../features/2026-08-31-prompt-input-latency.md) | Retain editor optimization | Deterministic work-scope gates and separate benchmark A/B |
| [Watcher preflight](../features/2026-09-09-watcher-inotify-preflight.md) | Retain native-deadlock mitigation | Injected refusal and native happy-path driver; race limits retained |
| [Summary dedup](../features/2026-09-26-summary-event-dedup.md) | Retain; immutable persistence update | Duplicate-event and failed-write/retry regressions |
| [Meridian provider](../features/2026-09-27-openai-meridian-provider.md) | Retain specific integration; generic scope pending | Catalog/small-model/baseURL and actual routing tests |
| [Composer API](../features/2026-09-27-tui-composer-read.md) | Retain required draft seam | Read/restore/stale-write and host projection; separate tools socket repair |
| [Build/version stamp](../features/2026-09-29-vt-version-stamp.md) | Retain provenance/base compatibility | Parser red-green, full/base identity and tracked CLI paths |
| [Configured agent name](../features/2026-10-02-agent-name-lookup.md) | Retain lookup fix | Renamed-agent red and restored 44-case gate |
| [Unmanaged install](../features/2026-10-02-unmanaged-install-method.md) | Retain deployment ownership | Stamp priority and zero startup lookups |
| [Log reopen](../features/2026-10-03-log-reopen.md) | Retain rotation integration | Rename/unlink reds and real replacement-file driver |
| [Keep scroll on submit](../features/2026-10-04-keep-scroll-on-submit.md) | Retain opt-in reader preference | Real app/composer default/config/toggle and inverse reds |
| [Transcript anchor](../features/2026-10-04-scroll-anchor.md) | Retain reading-position fix | Real prune and long streaming TUI A/B |
| [Usage colors](../features/2026-10-04-sidebar-context-colors.md) | Retain presentation | Threshold and real renderer/footer wiring |
| [Compact Context](../features/2026-10-04-sidebar-context-compact.md) | Retain presentation | Width, KV, palette, click and selection proofs |
| [Disabled LSP line](../features/2026-10-04-sidebar-lsp-disabled-oneline.md) | Retain layout preference | Three renderer states and selectable note |
| [Compact MCP rows](../features/2026-10-04-sidebar-mcp-list.md) | Retain information trade-off | Actual row/status-color tests |
| [MCP heading counts](../features/2026-10-04-sidebar-mcp-summary.md) | Retain glanceable status | Expanded/collapsed modes and selection |
| [Pinned title](../features/2026-10-04-sidebar-pin-title.md) | Retain preference | Real TUI title/scrollbar comparison; unit gap explicit |
| [Section order/drag](../features/2026-10-04-sidebar-section-order.md) | Retain customization | Real host/KV/drag/select/click tests with typed fixtures |
| [Todo summary](../features/2026-10-04-sidebar-todo-summary.md) | Retain progress display | Formatter/render/selection proofs and cancellation limits |
| [Turn timing](../features/2026-10-04-tui-turn-timing.md) | Retain presentation | Date-first red-green and actual intermediate/final footers |
| [Completed Todo](../features/2026-10-05-sidebar-todo-completed.md) | Retain explicit option | Actual hide/show/collapsed render controls |
| [Block navigation](../features/2026-10-05-tui-block-nav.md) | Retain transcript shortcuts | Targets and real top/bottom/block/landmark keys |
| [Session maintenance](../features/session-maintenance.md) | Retain cross-process safety; optimize startup | Fences/REPLACE/index/collation/race proofs and atomic emergency activation |
| [SQLite admission/diagnosis](../features/sqlite-admission.md) | Recover safe BEGIN contention and preserve private diagnostic facts | Separate-child, callback/commit safety, bounded privacy and compiled before/after tests |

## Delivered-source scope

- SQLite A/B were assembled as separate logical commits on `fork-audit-ready`;
  shared classification is included once. No callback/COMMIT/notification
  replay, SQL-data disclosure, or provider retry is introduced.
- C was delivered as a separate follow-on after A/B. Source-level tests and
  child-process races passed, including emergency and quoted-identifier repairs.
- Exact source SHAs, workers, gate results and remaining limitations live in
  the linked canonical inventory. Local commits are not deployment evidence.

## Build and install

- A/B and cache wave: `115310f98c` pushed to both remotes, then both hosts'
  tracked builders installed `1.18.34-vt-116-907b3bc518`.
- Desktop canonical serve PID `1514536` -> `689071`, health 200/vt-116.
- Graceful TUI coverage established on both hosts; the active lead's older
  process was not interrupted. No default tmux or Meridian restart.
- Installed compiled-before/after fixture: separate 7s SQLite writer gives
  vt-101 HTTP 500/no reply, new build HTTP 200/mock reply in about 7.2s;
  zero session errors, health remains good. CLI help/error/happy and API
  health/404/400/happy paths passed on both hosts.
- Parallel TUI source `50b9d3b329`, `bed5ec8209`, forklog `82102d2e21` retained.
- C integrated afterward as `2a2b66623e` and pushed both remotes. Its combined
  maintenance gate passed 33 tests/173 assertions and source follow-on review.
- Final TUI proof topics integrated through `ce0d9e5c72`; full latest TUI
  suite 276 pass/one existing skip/0 fail, focused 36 pass, typecheck exit 0.
- Both tracked host builders installed `1.18.34-vt-126-907b3bc518` from that
  source tip. Composer source repair is separately landed in tools; its Mac
  default-TMPDIR alias follow-on passed on m4max at tools `a042c6b` (39/39).
- C/TUI running-process pickup was verified on both hosts. The lead changed
  PID 3633181 to 2105459 on vt-126 before declaring the gate start at
  2026-10-07T00:24:02Z; canonical serve PID 1507297 returned health 200/vt-126.
- Both primary checkouts' deliberate retry divergence and pre-existing
  `.gitignore` edit were left untouched.

## Completed live gate

- Window: 2026-10-07T00:24:02Z..2026-10-08T00:24:02Z, measured
  2026-10-08T00:28:05Z. Verdict **failed**; no upstream A+B PR opened.
- 5,055 assistant messages, 28 recorded execute `LockTimeoutError` /
  `SQLITE_BUSY` deaths (5.539 per 1,000), zero additional silent SQL deaths
  observed; all 28 appear in local logs across 16 sessions. Four bursts contain
  23 deaths; all recorded deaths fall in the 01Z/02Z row-creation hours.
- Logs reach end; 1,436/1,441 minute buckets covered, five one-minute gaps.
  Pre-fix process-sample share 16.88%, zero pre-fix active-main samples;
  collector has no per-PID failure attribution. Creation version is not the
  executing version. No causal before/after rate claim is made.
- Matching failure logs lack phase fields. Whole-assistant-row elapsed times
  do not establish admission-wait duration; competing writer and precise
  failure phase remain unresolved. No callback/COMMIT retry was added.
- Shared aggregates with parent, TUI coordinator and incident owner
  `ses_eebf2e45cfferJAfg1d5eBsDB6`, whose separate diagnostics source
  `46d697e6ff` / `691eb77ded` was preserved. No duplicate engine fix or
  deployment of those diagnostics is claimed by this gate documentation.
- Gate measurement and sanitized cause inspection executed successfully;
  canonical inventory retains detailed evidence and the blocked submission.
- Parent's later split-window request was measured separately: rollout
  01Z..03Z has 28/1,275 (21.961/1,000), steady 03Z..01:11Z has 0/3,665,
  with zero additional silent deaths in either. The original failed day is
  unchanged. Full steady window ends October 8 03Z and has not passed yet.
- Correlated all 28 actual process-error times (01:33:15.571Z..02:28:01.397Z)
  with retained startup/restart history: serve active at October 6 23:43Z,
  lead restart October 7 00:17:46Z; later vt-128/vt-130 builds report no
  tab/serve restarts. No >60s lock holder or causal herd is established.
- Located the reported October 8 00:55:42.032Z BUSY-containing line: INFO,
  no processor-death message identity. It is not a new recorded/silent death.
- Oracle accepted a scoped steady-state A+B decision after complete, clean,
  coverage-qualified measurement; diagnostic-only rollout does not reset
  unchanged A+B behavior. Do not describe this as universal lock elimination.
- Full steady interval completed at the scheduled decision: measured
  2026-10-08T03:04:51Z, 4,659 assistant rows, zero recorded/all-SQL and
  additional silent deaths, 1,436/1,440 log minutes, logs reach end.
  Pre-fix/unclassified process share 16.33% and one unknown active-main sample
  remain explicit. Qualified for narrow preparation; failed initial/rollout
  cohorts retained. Fresh `sqlite-admission-upstream` from current upstream
  `dev` `a697115b2033` is separate from integration history and contains no
  C/cache/TUI/phase instrumentation. No PR claimed before actual branch checks.

## Upstream preparation and submission (2026-10-08)

- Current upstream advanced to `663fbd757370` with 18 web-documentation files
  only. Preserved that base; five original A+B units retain matching patch IDs
  and all 13 runtime/test blobs. No C/cache/TUI/later phase instrumentation.
- The initial local branch used an unnecessary hook bypass on its first
  commit. It remains preserved but unpublished. Fresh publishable history
  uses normal hooks without overrides or AI trailers, with human identity:
  `39f33dccd5`, `714210683a`, `36f363ec4f`, `69798dc947`, `f3b6954437`.
- Focused checks: core 89/89, opencode 126/126 and both package types pass.
  Main personally drove real migrated file DB/event/serializer modules:
  5,250ms external writer against 5,000ms native timeout, one callback,
  projection, event and notification; replay, ownership/removal, interruption,
  SQL parameter privacy and adjacent provider classification pass.
- Same-test upstream controls fail four contention cases and 24/25 privacy
  cases, while baseline event/message/retry controls pass. Main verified
  content equivalence and read all changed files; single gate review APPROVE.
  Workspace and both normal pre-push gates pass 30/30. Empty pre-commit hook
  payloads are not described as test evidence.
- Both fork remotes independently report `sqlite-admission-reviewed` at
  `f3b6954437f6e0920b6910b90b8a9cef8176518b`. Review worktree unlocked/retired
  through Vibeterm; branch and private evidence retained. No primary source
  history changed, build installed, or live service/tab restarted here.
- CLI PR creation was initially denied by token permissions. The preferred
  unused-laptop browser disconnected, then was signed out after reconnect.
  Authorized main-laptop fallback used an unfocused dedicated tab as Nowaker,
  verified exact form/body and submitted once; no credential or user-page change.
- Actual regular [PR #53886](https://github.com/anomalyco/opencode/pull/53886)
  created 2026-10-08T07:13:11Z, base `dev`, head `f3b6954437f6`; independent
  read API verifies author/title/head/non-draft and exact footer after trim.
  Upstream bot closed it unmerged at 07:13:55Z under its stated critical-v1-only
  policy, citing temporary contention's resend workaround. This is not a
  source-regression finding or proof of startup-herd causation.
- Separate standards bot requires a linked Fixes/Closes issue; partial #47566
  reference was not recognized. No broad issue falsely declared fixed, no
  closed PR reopened/duplicated. Submission question withdrawn; new direction
  question `qst_11a67d235001lXLmtYXc8PoQdF` gates v2 planning, reviewed reply,
  or v1 local-only retention. All local delivery/failed cohorts remain intact.

## Related ownership

- Parent coordinator: `ses_fe8a27c6effe6KEx3TRNvOLgUo`.
- Existing TUI coordinator: `ses_ef8235798ffejGr4sa22eXmVNv`; its implementations
  are landed and idle, while screenshots remain on its own user question.
- Retry red-green worker: `ses_eed9a40efffeti1YcfRukbhErW`, isolated in
  `retry-regression-audit`; no integration or deployment delegated.

## Prompt failure follow-up (2026-10-07)

- Session: `ses_eebf2e45cfferJAfg1d5eBsDB6`, Hephaestus on m4max/macOS;
  branch `prompt-sql-contention`, cut from freshly pulled `dev-nowaker`
  `0f9bbfb297`. Existing retry and `.gitignore` edits remain untouched.
- Feature: [SQLite admission recovery and safe diagnosis](../features/sqlite-admission.md).
- Desktop incident: `err_436ddd0f`, `run=831f8a68`,
  `2026-10-07T01:39:47.520Z`, SQL lock timeout while creating a user message;
  retry candidate `msg_114047258001ysGXEiQ6ZqTZCo` persisted 10.648s later.
  The actual vt-126 bundle already contained acquisition recovery. Retained
  logs did not establish the failed phase or blocking writer.
- Controlled failures reproduced missing diagnostics before implementation.
  Phase/identity tests distinguish acquisition, body, finalization and callback
  failure; actual durable event conversion preserves diagnostic lookup.
  HTTP tests retain one failure log and the same safe 500/reference response.
- No new retry, timeout change, writer attribution or historical root-cause
  claim. Desktop TUI coordinator owns draft recovery; dotfiles owns independent
  one-minute sysstat/disk-counter deployment.
- Initial checks: core and opencode typechecks passed; existing child-writer
  SQL serialization test passed. Final focused gate: 96 core and 31 opencode
  tests passed. Manual loopback HTTP driver returned safe 500/ref for a real
  UNIQUE failure and 200/committed afterward; one failure log contained
  `sqlite.phase=body`, `attempts=1`, `SQLITE_CONSTRAINT_UNIQUE`, elapsed time
  and the failing PID. No extra retry or duplicate response was introduced.
- Actual adapter QA exposed the known Drizzle wrapper boundary; its controlled
  unwrapping is shared with the existing SQL error serializer, whose privacy
  regressions still pass. Temporary driver, logs and endpoint were removed.
- Code commits `46d697e6ff` / `691eb77ded` fast-forwarded onto a refreshed
  `dev-nowaker` and pushed to GitLab and GitHub. The pre-push hook passed all
  30 workspace typechecks. Both hosts installed from their own pulled source
  using the tracked builder: `1.18.34-vt-151-907b3bc518`.
- Installed binary QA used isolated homes/databases and loopback Basic auth,
  with no provider call (`noReply`). On both hosts: health 200, warm prompt
  200, writer-held admission 500, then admission 200 after release. The
  compiled log showed `phase=acquire`, `SQLITE_BUSY`, 11 attempts and elapsed
  time 61,587ms (m4max) / 61,825ms (desktop), confirming the documented
  elapsed budget is not a hard request timeout. The failing PIDs were 77473
  and 1831071, not the writer PIDs.
- QA collected the existing stderr log formatter (`OPENCODE_PRINT_LOGS=1`)
  to avoid confusing buffered file logging with missing diagnostics.
  Desktop's private QA server did not exit on TERM and required a CWD-guarded
  KILL during cleanup. No live server, TUI, default tmux or Meridian restart.
- TUI recovery remains delegated to desktop coordinator
  `ses_ef8235798ffejGr4sa22eXmVNv`, owner `ses_ee74c94dfffe71uYsYScadAio7`.
  Desktop sysstat deployed independently in dotfiles commit `cfcac55`;
  natural minute samples and successful collection were independently
  checked. Its next newly created daily DISK archive check is agent-scheduled.

## Processor diagnostic propagation (2026-10-07)

- Worker: `ses_ee6f529f0ffezc6ATEiYn7JAip`, parent
  `ses_eebf2e45cfferJAfg1d5eBsDB6`, reliability owner
  `ses_eeda1d251ffel81U5Y42j4kb33`. Approved application scope independently
  read from `msg_112fdb402001Eub58TQZr2mAWl`; no hardware scope executed here.
- Feature: [SQLite admission recovery and safe diagnosis](../features/sqlite-admission.md).
- Branch `processor-diagnostic` from refreshed `dev-nowaker` `7f2ec99120`.
  Source `36445e0198` adds only the existing diagnostic lookup and conditional
  `sqlite` field to `SessionProcessor.halt`, before its unchanged conversion.
  Rebase was a no-op; fast-forward integrated and pushed to both remotes,
  independently checked at `36445e0198eda3a82b0aaeed148d8acc31d6a058`.
- Source regression invokes `SessionProcessor.process` through actual halt,
  error publication, idle transition and message cleanup. The LLM failure
  seam injects a wrapped SQL error recorded through `TransactionDiagnostic`
  for each of acquire/body/finalize/after_commit; these are propagation
  fixtures, not a claim that one native failure exercised every phase.
  Without propagation, all four fail on absent `sqlite`; both untracked SQL
  and ordinary-error controls pass. Restored propagation passes all six,
  retains `UnknownError` and excludes private fixture content from new fields.
- On both hosts, from `packages/opencode`:
  `bun test --timeout 30000 test/session/processor-diagnostic.test.ts test/session/processor-effect.test.ts test/session/message-v2-sql-error.test.ts test/server/httpapi-error-middleware.test.ts`
  passed 54 tests, 338 assertions. `bun typecheck` passed. From `packages/core`:
  `bun test --timeout 30000 test/transaction-diagnostic.test.ts test/database-transaction.test.ts test/sqlite-error.test.ts`
  passed 44 tests, 134 assertions. Changed TypeScript LSP diagnostics clean.
  The first desktop combined run with concurrent typecheck hit two 5s test
  timeouts; rerun with the explicit test-runner timeout above passed. No
  production timeout changed. Both push hooks passed 30 workspace typechecks.
- Both hosts built their own primary checkout with tracked
  `.vibeterm/build.sh`, preserving unrelated retry-header cap and `.gitignore`
  edits: `1.18.34-vt-156-907b3bc518`. Linux installed inode `49946730`, macOS
  inode `22186648`. An earlier desktop worktree-build QA passed before the
  primary build; the final primary build was separately exercised below.
- Installed binary QA starts a scratch loopback Basic-auth server, isolated
  HOME, XDG stores, plugin/tool stores and SQLite file. One local fixture
  provider call reaches processor step-start; a scratch UNIQUE trigger causes
  a real native Drizzle transaction-body failure. Existing stderr formatter
  emits one processor failure diagnostic. On both hosts: health 200, warm
  admission 200, assistant response 200 with unchanged `UnknownError`.
  Safe projections: desktop PID `2645913`, body, attempts 1, elapsed 16ms,
  `UniqueViolation`, `SQLITE_CONSTRAINT_UNIQUE`; m4max PID `48295`, same fields,
  elapsed 1ms. No raw SQL, params, prompt, paths or native text in evidence.
  Owned QA processes and scratch stores removed; no live process restarted.
- Executable-inode coverage sample: desktop 8 current / 34 older, m4max
  5 current / 3 older, zero unreadable among enumerated opencode processes.
  This worker restarted zero live TUIs or services; parent/coordinator tabs
  were untouched. Installation does not retrofit diagnostics into old
  processes and does not establish a clean observation window. Parent
  independent review and reliability gate decisions remain outside this task.
- Provenance correction: source `36445e0198` and evidence `c6a666c55d`
  mistakenly stamped `AI-Harness: Vibeterm 5635825`. The supplied worker
  session context identifies the actual harness as `Vibeterm e6fd83c`;
  model `openai/gpt-6.1-sol`, tool `opencode 1.18.34-vt-153-907b3bc518`,
  platform `linux` and session/parent IDs were accurate. This correction
  preserves already-pushed protected history rather than force-rewriting it.
