# <Short title>

Use this template for one durable local customization. Name the copied file
`YYYY-MM-DD-short-title.md`, using the customization's first workday. Track the
file only on `master-nowaker`; feature branches must not carry forklog edits.

## Identity

- Status: active | superseded | removed
- Integration branch: `master-nowaker`
- Development branch(es): `<branch>`
- First local commit: `<full or short commit>`
- Current local commit(s): `<full or short commit>`
- Upstream base when introduced: `<commit or tag>`
- Last checked against upstream: `<commit or tag>`

Use `TBD` when the historical record does not establish a value. Never infer a
branch, prompt, session ID, or verification result.

## Original request

Quote the user's request verbatim when it survives in a transcript. If it does
not, write `TBD - no surviving prompt found` and keep the reconstructed goal in
the next section.

> <verbatim prompt>

## Goals

- <observable outcome>

## Non-goals

- <explicitly excluded behavior, or `None recorded`>

## Rationale and constraints

- <why upstream behavior was insufficient>
- <security, compatibility, or operational constraint>
- <rejected approach and why, when the record contains one>

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `<sha>` | YYYY-MM-DD | <behavior> | `<symbol or path>` |

The stable seam is what an upstream bump must inspect. Prefer a symbol, route,
schema field, generated artifact, or test over a line number.

## Verification

- `<command>` - <observed result>
- Manual surface: <what a user did and observed>

Record only verification that actually ran. Historical verification copied
from a session must say which session reported it.

## Session ledger

Use the user's workday, not the calendar date after midnight. Work continuing
from an evening into the following early morning stays on the evening's date.
Use full session IDs and keep one row per session per workday.

- YYYY-MM-DD `ses_<full-id>` - <initial build, upstream rebase, semantic change,
  or other brief goal>. Evidence: <safe transcript phrase, commit, or command>.

If exhaustive local-session searches found no match, keep that fact visible:

- YYYY-MM-DD `TBD` - no matching session found. Searched: <stores, workdirs,
  date range, and discriminating queries>.

## Current maintenance notes

- <canonical patch path, regeneration command, environment override, or other
  instruction needed by the next upstream bump>

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch after the merge.
- Regenerate derived clients or schemas instead of hand-editing generated files.
- Run the customization's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed
  artifact, not only the source tree.
- Confirm protected running services kept the same PID and start timestamp.
- Append the new session-ledger row and update `Last checked against upstream`.
- Commit the forklog change separately for that session and workday. Do not
  squash it; keep forklog commits rebased above the current source head.

## Supersession or removal

Complete this section only when status changes from `active`.

- Date: YYYY-MM-DD
- Upstream or local replacement: `<commit>`
- Evidence that the local customization is no longer required: <fact>
