# SQLite admission recovery and safe diagnosis

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branches: `sqlite-begin-retry`, `sqlite-error-diagnosis`,
  `fork-audit-ready`, `prompt-sql-contention`, `processor-diagnostic`
- First integrated commits: `651f31f376`, `c5764cbdbf`, `e49541777f`,
  `28aa286c86`, `115310f98c`
- Source workers: `ses_eecf4b409ffeFKx2qAXipWliKo`,
  `ses_eecf11b3affevOqpKUU3vncF7S`, `ses_eebf2e45cfferJAfg1d5eBsDB6`,
  `ses_ee6f529f0ffezc6ATEiYn7JAip`
- Upstream base: `907b3bc518`; compared upstream: `4ac0d9c3d1`
- Upstream PR: [#53886](https://github.com/anomalyco/opencode/pull/53886), closed unmerged under stated critical-v1-only policy

## Request and rationale

The parent coordinator approved the reliability plan on the user's request
to fix identified defects. Sanitized historical evidence found 277 recorded
SQL turn deaths plus 91 silent persistence failures; 808/833 logged causes
were locked. The rare long writer was not identified.

An IMMEDIATE transaction whose BEGIN fails has executed no projector or
commit callback. Retrying only that admission can survive transient writer
contention without replaying tools, model calls, or non-idempotent callbacks.

## Changes and stable seams

| Seam | Behavior |
|---|---|
| `core/database/sqlite-error.ts`, `SqliteFailure.parse` | Bounded reason/code vocabulary, contradictory/unknown codes fail closed |
| `core/database/transaction.ts`, `DatabaseTransaction.immediate` | Retry only typed BUSY/RECOVERY/TIMEOUT before callback entry, outside nested transactions |
| `core/event.ts`, durable commit/remove/claim | IMMEDIATE admission recovery; durable wake remains protected and post-commit |
| `opencode/session/sql-error.ts`, `SqlErrorMessage.message` | Known SQL/Drizzle cause becomes fixed safe diagnosis, never query/params/native free text |
| `MessageV2.fromError` | Preserve `UnknownError` wire shape and provider classification |
| `core/database/transaction-diagnostic.ts`, HTTP error middleware | Preserve original SQL error identity; add fixed-vocabulary transaction phase, attempts, elapsed time and PID to the existing failure log |
| `SessionProcessor.halt` | Read the same original diagnostic before error conversion and conditionally include the identical bounded `sqlite` field in the existing processor failure log; no wire or execution change |

## Verification

- Separate child writer regression fails the pre-fix tree and passes the
  patched tree, including an unchanged 5000ms SQLite timeout.
- Safety/clock tests prove callback construction/body, COMMIT, rollback,
  notification, nested and unsafe-code failures do not replay work.
- Privacy regressions fail the old serializer and pass direct/wrapped known
  SQL errors, unknown metadata, ordinary errors, and provider controls.
- Coordinator directly exercised actual DB/helper/serializer under child
  contention: one callback, one notification, one persisted row, no private
  parameter/path reflection.
- Compiled installed before/after on both hosts: a 7s writer makes vt-101
  return HTTP 500/no reply; vt-116 returns 200/mock reply in about 7.2s with
  zero session errors and healthy serve.
- B's serialized error was not observed in the compiled contention scenario
  because A recovered it; diagnosis evidence remains source tests and actual
  adapter/serializer drivers.

## Limits and maintenance

- 60 seconds is elapsed admission budget, not a hard request timeout.
- Retry sleep is asynchronous, 50ms doubling to 1s; `busy_timeout=5000` stays.
- Cancellation is checked before attempts/backoff, not promptly during an
  already-running native BEGIN/reservation.
- LOCKED, BUSY_SNAPSHOT, unknown/conflicting codes and failures after callback
  entry never retry. Exhaustion returns the original SQL failure.
- This does not remove startup registration/checkpoint/migration contention,
  guarantee every writer releases, or guarantee external notification once
  across a crash after COMMIT. Maintenance startup is a separate fork feature.
- Exact tests, rollout coverage and live-gate status are in Vibeterm's
  canonical `docs/opencode-patches/README.md` inventory.
- Transaction diagnostics survive error-to-defect conversion via a private
  weak map, not cause annotations. Metadata identifies the failing process,
  not the competing writer; elapsed time includes cleanup, not only lock wait.
- `finalize` distinguishes successful versus failed body completion, without
  claiming that every finalization error is a failed COMMIT. Inner transaction
  failures retain their first origin. Reusing the same SQL error object for
  unrelated operations would retain that first diagnostic; production errors
  are propagated by identity rather than repurposed.

## Timeline

- 2026-10-06 [`ses_eeda1d251ffel81U5Y42j4kb33`](../sessions/fork-audit.md) -
  plan, prove, integrate and deliver A/B first; retain safe acquisition-only
  boundary, bounded diagnostics, both-remotes/hosts provenance and live gate.
- 2026-10-07 same coordinator - measured the full window
  2026-10-07T00:24:02Z..2026-10-08T00:24:02Z at 00:28:05Z after its end:
  **failed**, 28 recorded `LockTimeoutError` / `SQLITE_BUSY` execute deaths
  over 5,055 assistant messages (5.539 per 1,000), zero additional silent SQL
  deaths observed; all 28 also in desktop logs. Logs reach end with five
  uncovered minute buckets; pre-fix process-sample share 16.88%, no per-PID
  attribution. The records lack transaction-phase evidence, so neither retry
  exhaustion nor a competing writer is established. No upstream PR opened.
  Separate incident owner `ses_eebf2e45cfferJAfg1d5eBsDB6` carries phase
  diagnostics `46d697e6ff` / `691eb77ded`; this entry does not claim their
  deployment or diagnose historical TUI failures from the new source. Full
  report, coverage and constraints remain in the canonical Vibeterm inventory.
- 2026-10-07 same coordinator - parent-requested split retains the failed
  initial cohort: 01Z..03Z has 28 deaths/1,275 assistant rows (21.961/1,000);
  steady 03Z..01:11Z on October 8 has zero recorded/additional silent deaths
  over 3,665 rows. Actual processor failures occur 01:33:15.571Z..02:28:01.397Z,
  after the primary vt-126 restart wave, so no long writer or causal startup
  herd is established. The full steady 03Z..03Z interval remains incomplete.
  Diagnostic-only changes need not reset unchanged A+B observation; readiness
  still requires final clean counts, qualified coverage, preserved failed
  cohorts and a narrow reviewed upstream diff. Canonical inventory carries
  the chronology, INFO-line classification and Oracle's acceptance limits.
- 2026-10-07 [`ses_eebf2e45cfferJAfg1d5eBsDB6`](../sessions/fork-audit.md#prompt-failure-follow-up-2026-10-07) -
  a desktop failure in vt-126 already had acquisition recovery. Its retained
  log lacked code, phase and attempts, so attribution remained unknown.
  Add diagnostic transport and HTTP logging without speculative retry changes.
- 2026-10-07 [`ses_ee6f529f0ffezc6ATEiYn7JAip`](../sessions/fork-audit.md#processor-diagnostic-propagation-2026-10-07) -
  parent-delegated processor propagation `36445e0198`; six real halt-path
  regression cases and isolated installed native failure QA on both hosts.
  Older running executable coverage remains; no clean-window declaration.
- 2026-10-07 same audit coordinator - parent-requested steady slice
  2026-10-07T03:00:00Z..2026-10-08T03:00:00Z completed: 4,659 assistant rows,
  zero recorded and additional silent SQL deaths, 1,436/1,440 log minutes,
  logs beyond end. Qualified for narrow A+B upstream preparation, not universal
  lock elimination. Pre-fix/unclassified sample share 16.33% includes one
  unknown active-main sample; no per-PID coverage claim. Original failed and
  rollout cohorts remain unchanged. Fresh `sqlite-admission-upstream` targets
  refreshed upstream `dev` `a697115b2033`; C/cache/TUI/phase instrumentation
  excluded. Actual upstream checks and PR state remain to be recorded.
- 2026-10-08 same audit coordinator - upstream preparation and review complete:
  base `663fbd757370`, five ordinary-hook/no-AI-trailer commits, head
  `f3b6954437f6`, 13 blobs/five patch IDs equal original A+B. Core 89/opencode
  126, package types, main isolated runtime QA and workspace/pre-push 30/30
  pass; single gate review APPROVE. Branch `sqlite-admission-reviewed` pushed
  and independently verified on both fork mirrors. Original local hook-bypass
  history remains preserved and unpublished; review checkout retired safely.
  GitHub denied `createPullRequest` with the current token and head search
  found no PR. Unblock `qst_11a0e0b80001VXwrHUzNCUA8p2` in the audit session;
  no PR number/open state claimed. Prepared body partially addresses #47566,
  not broader startup/growth problems; full evidence and actual future PR state
  remain in Vibeterm's canonical inventory.
- 2026-10-08 same audit coordinator - regular PR #53886 submitted as Nowaker
  at 07:13:11Z via the authorized unfocused browser fallback after API denial;
  head `f3b6954437f6`, base `dev`, body/footer independently API-verified.
  Upstream bot closed it unmerged at 07:13:55Z, classifying temporary contention
  with resend workaround as outside critical-v1 acceptance. A separate issue
  standards warning requires Fixes/Closes linkage; the partial #47566 reference
  was not sufficient. No false broad-issue closure, automatic reopening or
  v2 rewrite. Local fix and qualified evidence remain; next direction is gated
  by `qst_11a67d235001lXLmtYXc8PoQdF`. Canonical inventory retains actual state.
