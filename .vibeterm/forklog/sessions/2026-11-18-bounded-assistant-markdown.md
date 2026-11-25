# Bound assistant Markdown during session resume

- Source workday: 2026-11-18 (America/Chicago); record added for the November 25 audit.
- Source session: [`ses_e0f0339a3ffeIJRU1VTvRDRUhT`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e0f0339a3ffeIJRU1VTvRDRUhT). The source commit and merge lack `AI-Session-ID`; the audit recovered attribution from the session's commit and push receipts. Neither commit was rewritten.
- Source: [`f90a951117ff46922a3a88d94ad691da740dd372`](https://github.com/Nowaker/opencode/commit/f90a951117ff46922a3a88d94ad691da740dd372) on `fix/session-resume-composer`; integrated into `dev-nowaker` as [`446da17ae17aed4eb8fc68821a031b94add4b2ba`](https://github.com/Nowaker/opencode/commit/446da17ae17aed4eb8fc68821a031b94add4b2ba) above `aa9ee7d8b0` (upstream v1.19.5 base `006d837c50`). The merge was published to both fork mirrors.

## Why and what changed

Resuming the affected session briefly mounted the composer. Session reads returned HTTP 200, but OpenTUI then failed to allocate frame and text buffers while drawing the transcript, and the route returned to Home with the composer unmounted. The default 100-message window included seven assistant text parts over a million characters; the bisect-sensitive compaction summaries were at ranks 52 and 86 from newest. The failure reproduced without the OmO TUI plugin.

`TextPart` in `packages/tui/src/routes/session/index.tsx` now uses one plain-text renderable when `text.trim().length` exceeds `TRANSCRIPT_MARKDOWN_LIMIT` (100,000 UTF-16 code units). Shorter parts keep rich Markdown. This bounds Markdown rendering work without truncating the displayed body beyond the existing trim, changing stored messages, or reducing the [100-message window](../features/2026-10-06-tui-history-crop.md).

## Original verification

- The real-renderer regression in `packages/tui/test/routes/session/transcript-filter-dialog.test.tsx` used 4,100 Markdown blockquotes. The old renderer failed the literal-text assertion; the fix passed it with the composer mounted. The transcript filter, hidden-message sync, and live hydration tests passed together (24 pass, 0 fail, 77 assertions), and `bun run typecheck` passed in `packages/tui`.
- The gated desktop build installed `1.19.5-vt-548-006d837c50`; the v1 database migration guard passed and the retry-cap marker was present. On the independent 2,573-message scratch copy, with `transcript.max_messages=100` and only the composer plugin, the loading frame cleared, the composer stayed ready for 20.429 seconds, and an unsent draft round-tripped. A separate isolated run passed with OmO enabled. The [setup coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_f018f02fdffeRMgHyFr1qOP8YU) later confirmed the live desktop tab opened without the temporary override and accepted another turn.
- TBD: m4max installation and verification, and upstream v1/v2 equivalence. No upstream PR was opened as part of the delivery. The audit follow-up did not rerun tests, build, install, or restart anything.
