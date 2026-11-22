# Open author PR slots and nudges

The daily PR drain keeps this file current. At most three Nowaker PRs are open on `anomalyco/opencode` at once; a new entry is filed only when one of them closes. Entry files keep their own filing records; this file holds the live slot list and every nudge.

## Open slots (checked 2026-11-22T06:52-06:54Z)

| PR | Head | Opened from | Checks | Last maintainer activity | Next nudge |
|---|---|---|---|---|---|
| [#63062](https://github.com/anomalyco/opencode/pull/63062) snapshot cleanup | `snapshot-gc-repair` `c67b4f3a07` | [ses_e3b6797a6ffe](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b6797a6ffeu9CDAb8e4Q2vMV), 2026-11-10 | 3/3 green | none since 2026-11-10; no reviews | no earlier than 2026-11-24, only if still quiet |
| [#63063](https://github.com/anomalyco/opencode/pull/63063) serverUrl | `serverurl-honest` `c333ffb3cc` | [ses_e3b6797a6ffe](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b6797a6ffeu9CDAb8e4Q2vMV), 2026-11-10 | 3/3 green | none since 2026-11-10; no reviews | no earlier than 2026-11-24, only if still quiet |
| [#63897](https://github.com/anomalyco/opencode/pull/63897) nested unborn repositories | `snapshot-unborn-upstream` `d8087e0352` (base `v1`) | [entry 06](06-snapshot-unborn.md), filed 2026-11-14T06:03:52Z | 3/3 green | none since filing; no comments or reviews before the 2026-11-21 nudge | no earlier than 2026-11-28T06:54:58Z, only if still quiet |

The Nov 22 drain read these with an authenticated search as Nowaker: exactly three open author PRs, all non-draft, 3/3 checks successful, no reviews or inline notes, and one own comment each. The last nudges are unchanged (Nov 17 06:11:42Z and 06:11:43Z on #63062 and #63063, Nov 21 06:54:58Z on #63897), so none was due and nothing upstream was changed. A public API read at 06:55:44Z confirmed the same heads, open and unmerged on `v1` with no review comments. The Nov 21 drain had found the Nov 17 nudge still the last comment on each of #63062 and #63063. The Nov 17 forklog mention of #63897 was this repository's own record, not contact with upstream. The cap is full, so nothing new was filed, and no other PR was pinged, updated or reopened. Next in line: [entry 10, shell late output](10-shell-late-output.md).

Freed slot: [#54578](https://github.com/anomalyco/opencode/pull/54578) closed unmerged before 2026-11-14; [#63897](https://github.com/anomalyco/opencode/pull/63897) took its place.

## Nudge log

- 2026-11-17T06:11:42Z - [#63062 comment](https://github.com/anomalyco/opencode/pull/63062#issuecomment-6940337063), by the [coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv): friendly ping after a quiet week, CI green.
- 2026-11-17T06:11:43Z - [#63063 comment](https://github.com/anomalyco/opencode/pull/63063#issuecomment-6940337305), same coordinator and wording.
- 2026-11-21T06:54:58Z - [#63897 comment](https://github.com/anomalyco/opencode/pull/63897#issuecomment-7058912122), by the same coordinator: first weekly nudge, one week after filing with no maintainer activity, CI green.

Comment times and authors were read back from the public GitHub API.
