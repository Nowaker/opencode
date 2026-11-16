# PAUSED and INBOX badges on held deliveries

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `held-delivery-badges` (managed worktree, cut from `dev-nowaker` `861d59c594`)
- First local commit: `f2cd6fe8e3`
- Current local commit(s): `f2cd6fe8e3`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), relaying the user's request of 2026-11-16 ~16:15Z:

> the TUI does not show that messages are held behind /pause. [...] three async-question answers arrived [...]. They render as ordinary messages; only the footer says "paused - /unpause to continue, 1 deferred tool call". He wants the same kind of badge as the TUI's existing QUEUED, but reading PAUSED while the session is paused.

The label contract it set:

> 1. QUEUED - a delivery that will start or continue a turn (user prompt, wake=now, question answer with continuation_dispatch) that the running turn has not read yet. [...] 2. PAUSED - the same kind of delivery while the session is paused [...]. Shown instead of QUEUED. 3. INBOX - a delivery that by itself never starts a turn (`wake: never` / vtns-style notes in the [vibeterm_metadata] block): the next turn reads it. For `wake: later` show "INBOX - wakes HH:MM" (local time of its 30-minute fallback wake) if computable. "INBOX" is Damian's pending choice [...]. Build with it and keep each label in ONE constant so the final word is a one-line swap.

## Goals

- An unread user message carries one badge where QUEUED already was: QUEUED, PAUSED, INBOX, or "INBOX - wakes HH:MM".
- Each label word sits in one constant, `DeliveryLabel` in `packages/tui/src/routes/session/prompt-delivery.ts`.

## Non-goals

- No change to delivery, hold or wake behavior: display only.
- Portal's badges are a separate worker's job.

## Rationale and constraints

- The pause (`2026-11-14-session-pause.md`) holds every automated prompt until unpause, but the transcript showed them like read messages.
- A delivery's wake is read from the `[vibeterm_metadata]` block the text starts with: `wake: later`, `wake: never`, or a `delivery: queued without starting a turn` note (opencode-tools `QUEUED_NOTE_DELIVERY`). Everything else (typed prompts, wake=now, question answers with `continuation_dispatch`) is a turn-starting prompt.
- "wakes HH:MM" is 30 minutes (opencode-tools `LATER_WAKE_DELAY_MS`) after the earliest unread wake=later note, because later notes share one pending wake schedule. No time is shown while paused, since the pause holds that wake too.
- A prompt held by a pause while a turn still runs keeps the "Unqueue" action, which the server allows only during a run.
- Fork-only: upstream has neither the pause nor Vibeterm deliveries, so no upstream PR.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `f2cd6fe8e3` | 2026-11-16 | `promptDeliveries` returns `{ state, wakesAt }` with `paused`/`inbox`; `inboxWake` reads the metadata block; `deliveryBadge` formats it; `UserMessage` renders it | `promptDeliveries`, `inboxWake`, `deliveryBadge`, `DeliveryLabel` in `packages/tui/src/routes/session/prompt-delivery.ts`; `deliveries` memo and `UserMessage` badge in `routes/session/index.tsx` |

## Verification

- `bun test test/routes/session/prompt-delivery.test.ts` (packages/tui) - 13 pass (6 existing, 7 new; the new ones failed first with `Export named 'DeliveryLabel' not found`).
- `bun typecheck` (packages/tui) - clean; full `bun test` (packages/tui) - 898 pass, 1 skip, 0 fail.
- Manual surface, isolated: real TUI on a throwaway tmux socket, scratch homes, scripted loopback model, real `vt-prompt-session` / `vt-pause-turn` / `vt-unpause-turn` against scratch build vt-514. Captured: wake=now while busy QUEUED; after `vt-pause-turn` PAUSED; once stopped, wake=now PAUSED and wake=never/later INBOX without a time; after unpause no badge; idle wake=never INBOX and wake=later "INBOX - wakes 12:00 PM" matching the tool's `wake_due` 18:00:55Z (12:00 America/Chicago).
- Manual surface, live: demo session [`ses_e1a84831fffe3CPwTayDoxGKHu`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e1a84831fffe3CPwTayDoxGKHu) on the installed vt-514: QUEUED, then PAUSED, then PAUSED plus two INBOX; after unpause one turn answered all of them and no badge remained.

## Timeline

- 2026-11-16 [`ses_e1ace8d28ffeR2WGjY311j34E8`](../sessions/2026-11-16-held-delivery-badges.md) - initial build. Evidence: `f2cd6fe8e3`, vt-514 on desktop and m4max.

## Current maintenance notes

- `QUEUED_NOTE_DELIVERY` and `LATER_WAKE_DELAY_MS` are mirrored from opencode-tools; if either changes there, change it here.
- The final word for INBOX is pending with the user; rename it in `DeliveryLabel` only.
- Needs a v2 port together with the pause.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
