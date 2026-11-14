# 08 - Send queued notes now

Status: PREPARED, NOT FILED - recorded at the coordinator's instruction ("a pr-queue entry (don't file)"). No upstream branch has been cut or pushed and no PR or issue was opened. Filing requires the user's authorization and a free author PR slot.

- Upstream target line: `v1`. Fork base: `006d837c50` (`v1.19.5`).
- Fork source: `0b31166e059` on `dev-nowaker` (both mirrors).
- Scope: `SessionPrompt.sendNow`, `MessageV2.unread`, `POST /session/:sessionID/send-now` (`session.sendNow`) with 409 `SendNowRefusedError` (`busy`, `empty`, `paused`), regenerated SDK, TUI "Send now" message action, docs in `server.mdx`, `sdk.mdx` and `tui.mdx`.
- Dependencies an upstream port must resolve: the `runs` map from unqueue (upstream PR [#54437](https://github.com/anomalyco/opencode/pull/54437), stacked on #54436), fork-only `OwnerQuiescence`, and the `paused` reason, which upstream has no pause feature for (drop it or keep it reserved).
- Evidence: [session record](../sessions/2026-11-14-send-now.md), [feature record](../features/2026-11-14-send-now.md).
- Owner: [`ses_e26c1f916ffeAFy8f2KwrZeJMN`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e26c1f916ffeAFy8f2KwrZeJMN).
- Next step, once cleared: cut a branch from the live upstream `v1` (after #54437 lands, or stacked on it), port without `OwnerQuiescence` and `paused`, rerun the focused tests there, find or request an issue, and write the PR body and filing command here.

## Title

`feat(opencode): send queued notes now without rewriting them`
