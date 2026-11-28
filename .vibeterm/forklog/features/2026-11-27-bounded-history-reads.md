# History reads without historical diff bodies

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `bound-history-reads`
- First local commit: `b0107b9fa3`
- Current local commit(s): `b0107b9fa3`, `e0ec87f0da`, `58ea851627`, `8c6e8a5eb5`, `285189d07b`, `17847dc906`; merge `fa424e4b8c`
- Upstream base when introduced: `006d837c50` (v1.19.5, from the `vt-644` build stamp)
- Last checked against upstream: `006d837c50`

## Original request

TBD - no surviving user prompt for the engine change. It came from the desktop CPU/memory-hunt coordinator's report (ses_ed61597c3fferEOoy589JvDJjc, 2026-11-27): two opencode TUI tabs grew to the 8 GiB pane limit within an hour of a restart and froze in memory reclaim. Damian's standing direction for the coordinator was "just do what's right to push it forward".

## Goals

- A prompt turn, a summary and a turn's diff view never parse historical `summary.diffs` patch bodies they do not use.
- A session with tens of MB of stored diffs stays responsive under the pane memory cap.
- Undo/revert, the TUI diff view, the legacy web timeline/review, fork and CLI export keep exact diffs.

## Non-goals

- Reducing on-disk bytes SQLite reads for a row; only the decoded JS heap is bounded.
- Repairing or migrating existing stored diffs.

## Rationale and constraints

- `MessageV2.filterCompactedEffect` loaded every page before applying the compaction cut, and `SessionSummary.summarize`/`diff` loaded the whole history to find one turn. Sessions with 82-90 MB of old diffs re-parsed them on every prompt; sessions without any compaction got no relief from an early cut alone.
- List and prompt reads project `patch`/`before`/`after` out of user `summary.diffs` in SQL, keeping per-file metadata. `FileDiff.patch` is already optional on the wire; no empty-string placeholder is sent.
- Any user-message write-back must start from `MessageV2.get` (exact row), otherwise a trimmed copy would overwrite the stored bodies. Audited call sites: compaction re-queue, resume selection, summary write, fork (`includeDiffBodies`), export (`includeDiffBodies`).
- Consumers audited: OMO has no patch reader; opencode-tools touches `summary.diffs` only for storage housekeeping; Portal strips `summary` before caching.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `b0107b9fa3` | 2026-11-27 | Stop the prompt history scan at the compaction cut | `MessageV2.filterCompactedEffect`, `compactionCut` |
| `e0ec87f0da` | 2026-11-27 | summarize/diff read only the requested turn and its step parts | `SessionSummary.summarize`, `readUserDiffs` |
| `58ea851627` | 2026-11-27 | Legacy SDK types accept metadata-only file diffs | `packages/sdk/js/src/gen/types.gen.ts` |
| `8c6e8a5eb5` | 2026-11-27 | History reads omit diff bodies in SQL; exact reads keep them | `projectedMessageColumns`, `includeDiffBodies` |
| `285189d07b` | 2026-11-27 | Web timeline/review fetch a turn's patch on demand | `summary-diffs.ts`, `/session/:id/diff?messageID=` |
| `17847dc906` | 2026-11-27 | Refresh cached turn patches when summaries change | `message-timeline.tsx` |

## Verification

- hania-arch, real full TUI with OMO and Vibeterm plugins, cgroup 2G high / 3G max / 0 swap, 89.6 MB diff seed, 12 turns (reported by ses_de1268e15ffeI12NlZGDM4iaVB): installed vt-644 0/12, 2,158,228 KiB peak anon; source-built base 2/12, 2,132,212 KiB; candidate 12/12, 1,040,928 KiB, idle post-GC TUI/worker 91.3/197.5 MiB.
- Thin-history control: 12/12 both, 966,480 -> 948,444 KiB peak.
- Backend 280 pass / 1 skip; app 735 pass; SDK tests and strict compile; package typechecks; Linux and web production builds; Chromium timeline/review regression (one request per opened turn, none while collapsed).
- Coordinator review (ses_ef8235798ffejGr4sa22eXmVNv): read the engine diff and audited every `updateMessage` call site for trimmed write-backs.

## Timeline

| Workday | Event |
|---|---|
| 2026-11-27 | Heap growth reported; cause found (historical diffs re-materialized per prompt); fixed and merged as `fa424e4b8c` |
