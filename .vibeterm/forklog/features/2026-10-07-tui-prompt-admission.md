# Keep a failed prompt instead of losing it, without sending it twice

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `submit-retain-draft`
- First local commit: `777a8045b8`
- Current local commit(s): `777a8045b8`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `a697115b20` (upstream `dev`, vanilla repro)

## Original request

Assigned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` as item 22, quoting
the parent `ses_eebf2e45cfferJAfg1d5eBsDB6` on m4max:

> make failed prompt submissions recoverable and duplicate-safe. ... Scope:
> retain submitted text/attachments until admission acknowledgment;
> persistent pending feedback; restore/retain on definite rejection without
> overwriting edits typed meanwhile; reconcile ambiguous acceptance using
> stable identity before retry so no duplicates. Isolated TUI
> happy/failure/ambiguous/edit-during-pending QA and regressions required,
> matching docs updated. Existing native catch shows Failed to send prompt
> but composer clears immediately.

Incident: 2026-10-07T01:39:47Z, `err_436ddd0f`, `LockTimeoutError` /
`SQLITE_BUSY` in `Session.updateMessage` under `SessionHttpApi.prompt`; the
text vanished from the composer and was retyped.

## Goals

- A submitted prompt survives a failed admission: text, pasted parts and
  attachments come back.
- Text typed while the send was pending is never overwritten.
- An ambiguous outcome is reconciled by a stable message ID, so a resend
  cannot store the prompt twice.
- Persistent feedback while sending, after a rejection, and while unknown.

## Non-goals

- No whole-prompt blanket retry and no extra database-acquisition wrapper;
  `BEGIN IMMEDIATE` retry (60s budget) already lives in the server.
- No server API change: `messageID` and part `id` were already accepted and
  upserted by ID.
- Shell (`!`) and slash-command submissions keep their existing paths.

## Rationale and constraints

- Upstream v1 clears the composer synchronously and only toasts on failure;
  the draft is unrecoverable.
- `POST /session/:id/message` returns only when the whole turn ends, so its
  response cannot be the admission acknowledgment. The text part's
  `message.part.updated` event (or a lookup by ID) is.
- Only the leading editor-context parts and the text part get client IDs:
  server-assigned IDs for the remaining parts are generated later and keep the
  parts in send order.
- Edit-during-pending policy: a rejected draft goes to the stash instead of
  merging into newer text, because a merge cannot preserve extmark-backed
  parts (pastes, attachments) at their offsets, and the stash already has
  pop/list UI.
- A 502/503/504, a transport error or no response is ambiguous; any other
  status is the server's own answer, so a lookup that misses means rejected.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `777a8045b8` | 2026-10-07 | Client IDs, admission tracking, reconcile by lookup, restore/stash, resend/restore commands, status-line states, sync dedupe of a re-stored message, docs | `packages/tui/src/prompt/admission.tsx` (`createPromptAdmission`, `PromptAdmissionProvider`); `Prompt` `submitInner` else-branch and `giveBack` in `packages/tui/src/component/prompt/index.tsx`; `message.updated` stale-ID removal in `packages/tui/src/context/sync.tsx`; `tui.mdx` "When a prompt fails to send" |

## Verification

- `bun test test/prompt/admission.test.ts` (packages/tui) - 10 pass: accept,
  event acknowledge, definite rejection release, stored-then-error, partial
  store, ambiguous resend reusing the ID, resend finds it stored, resend
  refuses while unreachable, late store picked up by polling, slow + missed
  event.
- `bun test test/cli/cmd/tui/sync-hidden-messages.test.tsx` - the new
  "same ID replaces the first copy" test fails with `src/context/sync.tsx`
  stashed (`Received + 1` extra row) and passes with it; 9 pass.
- `bun typecheck` and `bun run test` in `packages/tui` after rebasing onto
  `691eb77ded` - exit 0; 337 pass, 1 skip, 0 fail.
- Server idempotency: two `session.prompt` calls with the same `messageID`
  and text part `id` (`noReply`) - both 200, one stored message with one part.
- Manual surface (throwaway tmux socket `qa-submit`, scratch XDG/DB/tools/
  plugins dirs, `opencode serve` behind a fault-injecting proxy, fake
  OpenAI-compatible model):
  - Vanilla `github/dev` `a697115b20`: a 500 "database is locked" leaves an
    empty composer and only the toast; a 502 after the server stored the
    prompt shows a false "Failed to send prompt: bad gateway".
  - Patched A (happy): sent with a client `messageID`, one stored message.
  - B (500, not forwarded): "Not sent (database is locked) - restored to the
    prompt" in the status line and toast, text back in the composer; Enter
    sends it once.
  - C1 (stored, 502 back): no error shown, one stored message.
  - C2 (502, not forwarded): "Prompt may not have been received: bad
    gateway"; palette "Resend unconfirmed prompt" re-sent the same
    `messageID`; one stored message.
  - D (500 after 5s, new text typed meanwhile): "Sending prompt" spinner while
    pending; afterwards the new text stays, the original goes to the stash.
  - Prompt history: one entry per prompt; the resent B was deduplicated.

## Timeline

- 2026-10-07 [`ses_ee74c94dfffe71uYsYScadAio7`](../sessions/2026-10-07-tui-prompt-admission.md) -
  initial build on `dev-nowaker` above `691eb77ded`; desktop and m4max
  installs. Evidence: `777a8045b8`, linked session.

## Current maintenance notes

- Upstream `v2` (`c28e9ec311`) already admits optimistically and restores the
  draft (`packages/tui/src/component/prompt/index.tsx:1174-1199`), but drops a
  failed prompt when anything was typed meanwhile (line 1187), treats every
  failure as a rejection, and does not pass a stable `id` from the TUI
  (`packages/client/src/solid/data.ts:1551` creates one per call), so a resend
  after a lost response can duplicate. Re-check before porting.
- The sync dedupe exists because `messageKey` is `time.created + id` and a
  re-stored message gets a new `time.created` from `createUserMessage`.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch afterward.
- Run `test/prompt/admission.test.ts` and `sync-hidden-messages.test.tsx`.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
