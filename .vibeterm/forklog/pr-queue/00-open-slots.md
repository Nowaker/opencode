# Open author PR slots and nudges

The daily PR drain keeps this file current. At most three Nowaker PRs are open on `anomalyco/opencode` at once; a new entry is filed only when one of them closes. Entry files keep their own filing records; this file holds the live slot list and every nudge.

## Open slots (checked 2026-11-28T09:07:52Z)

| PR | Head | Opened from | Checks | Last maintainer activity | Next nudge |
|---|---|---|---|---|---|
| [#63062](https://github.com/anomalyco/opencode/pull/63062) snapshot cleanup | `snapshot-gc-repair` `c67b4f3a07` | [ses_e3b6797a6ffe](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b6797a6ffeu9CDAb8e4Q2vMV), 2026-11-10 | 3/3 green | none since 2026-11-10; no reviews | no earlier than 2026-12-01T06:54:34Z, only if still quiet and green |
| [#63063](https://github.com/anomalyco/opencode/pull/63063) serverUrl | `serverurl-honest` `c333ffb3cc` | [ses_e3b6797a6ffe](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b6797a6ffeu9CDAb8e4Q2vMV), 2026-11-10 | 3/3 green | none since 2026-11-10; no reviews | no earlier than 2026-12-01T06:54:50Z, only if still quiet and green |
| [#63897](https://github.com/anomalyco/opencode/pull/63897) nested unborn repositories | `snapshot-unborn-upstream` `d8087e0352` (base `v1`) | [entry 06](06-snapshot-unborn.md), filed 2026-11-14T06:03:52Z | 3/3 green | none since filing; no reviews; only the two weekly nudges | no earlier than 2026-12-05T07:08:31Z, only if still quiet and green |

On 2026-11-28 the coordinator found #63897 still quiet (head `d8087e0352`, base `v1` `acc8c26da4`, 3/3 checks green, no reviews) a week after its first nudge and posted its second weekly nudge (logged below); #63062 and #63063 were unchanged and quiet, not yet due. A public API read at 09:07:52Z confirmed the new comment by Nowaker, all three PRs open, non-draft and unmerged on `v1` base `acc8c26da4` with unchanged heads, comment counts of 2 each and no review comments. The coordinator reported the comment time as 07:08:32Z; the API's `created_at` is 07:08:31Z, which this file uses. The cap stays full, so nothing was filed or reopened.

The Nov 24 drain read these at 06:53:28Z as Nowaker, reconciling the complete author search with each PR's readback and timeline: exactly three open author PRs, all non-draft and unmerged on `v1` base `acc8c26da40f918e1ce222cb03c3342242c3ed6a` with unchanged heads, 3/3 checks successful each, no classic status contexts, and no reviews, review comments or maintainer activity; the only references were this repository's own forklog. #63062 and #63063 had a full quiet week after their Nov 17 nudges and their check rollups showed 3/3 passed, so each got one weekly nudge (logged below). #63897 was not due. A public API read at 06:56:33Z confirmed both new comments by Nowaker at the logged times, the same heads and base, and comment counts of 2, 2 and 1. The Nov 22 and Nov 23 drains found all three quiet with none due. The Nov 21 drain had found the Nov 17 nudge still the last comment on each of #63062 and #63063. The Nov 17 forklog mention of #63897 was this repository's own record, not contact with upstream. The cap is full, so nothing new was filed, and no other PR was pinged, updated or reopened. Next in line: [entry 10, shell late output](10-shell-late-output.md).

Freed slot: [#54578](https://github.com/anomalyco/opencode/pull/54578) closed unmerged before 2026-11-14; [#63897](https://github.com/anomalyco/opencode/pull/63897) took its place.

## Nudge log

- 2026-11-17T06:11:42Z - [#63062 comment](https://github.com/anomalyco/opencode/pull/63062#issuecomment-6940337063), by the [coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv): friendly ping after a quiet week, CI green.
- 2026-11-17T06:11:43Z - [#63063 comment](https://github.com/anomalyco/opencode/pull/63063#issuecomment-6940337305), same coordinator and wording.
- 2026-11-21T06:54:58Z - [#63897 comment](https://github.com/anomalyco/opencode/pull/63897#issuecomment-7058912122), by the same coordinator: first weekly nudge, one week after filing with no maintainer activity, CI green.
- 2026-11-24T06:54:34Z - [#63062 comment](https://github.com/anomalyco/opencode/pull/63062#issuecomment-7124414702), by the same coordinator: second weekly nudge after a further quiet week, CI 3/3 green.
- 2026-11-24T06:54:50Z - [#63063 comment](https://github.com/anomalyco/opencode/pull/63063#issuecomment-7124419194), same coordinator and reason.
- 2026-11-28T07:08:31Z - [#63897 comment](https://github.com/anomalyco/opencode/pull/63897#issuecomment-7235742744), by the same coordinator: second weekly nudge after a further quiet week, CI 3/3 green.

Comment times and authors were read back from the public GitHub API.
