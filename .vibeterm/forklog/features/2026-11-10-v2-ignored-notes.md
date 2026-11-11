# User-visible ignored synthetic notes on v2

## Identity and request

- Status: active. Source integration: `v2-nowaker`; forklog integration: `dev-nowaker`.
- Upstream base: `v2.2.7` (`fedc6f208a`), fork base `d90d41a907`.
- Source commit: `0c5519ba22`.

> a synthetic message flagged ignored is stored and rendered to the user but excluded from what the model sees

## Behavior and stable seams

- `SessionMessage.Synthetic`, `SessionInbox.SyntheticPayload` and the `session.synthetic` durable event carry optional `ignored: boolean`. The public synthetic endpoint carries the same field.
- `packages/core/src/session/inbox.ts`: ignored synthetic admission publishes the transcript event immediately, with no inbox row. First admission wins on retried IDs; cross-session or cross-type reuse remains a conflict.
- `packages/core/src/session/session.ts`: an ignored note never wakes execution, even when `resume: true` is requested or a retry changes the request's payload.
- `message-updater.ts`, the Session projector and the client's Solid data projection preserve `ignored` on persisted and live messages.
- `runner/to-llm-message.ts` emits no model message for the note. `recent-text.ts` excludes it from retained compaction text; compaction's provider lowering uses the same model conversion.
- TUI rows and notice rendering show ignored notes from both history and live events, using nonempty description text or the note's text. Ordinary descriptionless synthetic context remains hidden.
- Shared Web/Desktop timeline projection recognizes ignored notes without descriptions; the notice renderer uses the same nonempty-description/text fallback. Ordinary model-only synthetic visibility and user notice-placement preferences remain intact.
- `packages/core/src/database/v1-migration.bun.ts`: preserve ignored v1 text as ignored synthetic notes, including mixed messages and compaction-related history, without leaking it into assistant content or recent text.

## Verification

- Backend focused suites: 187 core tests pass, 0 fail, 773 assertions; HTTP admission 1 pass, 0 fail, 12 assertions. Core/server/schema/protocol typechecks and changed-file diagnostics pass.
- Disabling ignored behavior causes 11 core failures and one HTTP failure. Separate wake/retained/import filtering mutations cause five failures; removing the admission lock causes two concurrency failures.
- Two independently acquired admission services sharing one scratch database force both callers past reconciliation before committing. The original deterministic event-ID race fails both overlap cases; the final writer reconciles the now-stored message, retaining unrelated ID collisions as defects.
- TUI row and whole-app render tests: 28 pass, 0 fail. Restoring the old visibility rule fails both new regressions. The live case also verifies the note survives a later row rebuild.
- Shared UI unit suite: 563 pass, 0 fail; 14 browser component tests pass across notices, timeline and notice-projection keepers. The new projection and blank-description rendering regressions fail without their owner changes. Typecheck passes 338 files. Local component execution used installed Chromium headless shell revision 1248 through a temporary config because Playwright requested absent revision 1223; video was disabled because ffmpeg was unavailable. No browser package was installed.
- Installed fake-provider proof: `.vibeterm/tmp/opencode/w4-proof-aJTJ4D/result.json` and `provider-requests.json`. The ignored note is immediately returned in stored history with no inbox row or provider call. Two actual requests, normal and compaction, omit its text; compaction completes while the original note remains in the transcript.

## Upstreamability

- Upstreamable v1 parity, using the existing `ignored` vocabulary and synthetic variant. Related upstream requests: [#48644](https://github.com/anomalyco/opencode/issues/48644) and [#6330](https://github.com/anomalyco/opencode/issues/6330).
- Immediate transcript admission avoids treating user-only notes as fresh execution input. No upstream PR was opened.

## Timeline

- 2026-11-10 [W4 session record](../sessions/2026-11-10-v2-patches.md), [source session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ): restore persisted user-only notes across admission, provider conversion, compaction, migration and clients.
