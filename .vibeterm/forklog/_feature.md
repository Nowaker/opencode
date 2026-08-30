# <Short title>

Use this template for one durable local customization. Copy it to
`features/YYYY-MM-DD-short-title.md`, using the customization's first user
workday. Track the file only on `master-nowaker`.

## Identity

- Status: active | superseded | removed
- Integration branch: `master-nowaker`
- Development branch(es): `<branch>`
- First local commit: `<full or short commit>`
- Current local commit(s): `<full or short commit>`
- Upstream base when introduced: `<commit or tag>`
- Last checked against upstream: `<commit or tag>`

Use `TBD` when the record does not establish a value. Never infer a branch,
prompt, session ID, or verification result.

## Original request

Quote the user's request verbatim when it survives in a transcript. Otherwise
write `TBD - no surviving prompt found` and keep the reconstructed goal below.

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

## Timeline

Use the user's workday, not the calendar date after midnight. Link a row to its
session record when one exists:

- YYYY-MM-DD [`ses_<full-id>`](../sessions/YYYY-MM-DD-short-title.md) -
  <initial build, upstream integration, semantic change, or re-verification>.
  Evidence: <commit, command, or linked session section>.

Preserve historical rows whose full session narrative was not recovered. Do
not create a session file merely to make an old ID linkable. Keep exhaustive
no-match results visible:

- YYYY-MM-DD `TBD` - no matching session found. Searched: <stores, workdirs,
  date range, and discriminating queries>.

## Current maintenance notes

- <canonical patch path, regeneration command, environment override, or other
  instruction needed by the next upstream bump>

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.

## Supersession or removal

Complete this section only when status changes from `active`.

- Date: YYYY-MM-DD
- Upstream or local replacement: `<commit>`
- Evidence that the local customization is no longer required: <fact>
