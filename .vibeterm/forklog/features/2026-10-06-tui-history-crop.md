# Show and load the messages a long session hides

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-history-crop` (also the upstream PR head)
- First local commit: `fcf142f4c4`
- Current local commit(s): `fcf142f4c4`
- Upstream base when introduced: `ecc4916b5a` (upstream `dev`, contains `v1.18.34`); landed on `dev-nowaker` above `a04c68d8e2`
- Last checked against upstream: `ecc4916b5a` (upstream `dev`)
- Upstream: issue [#53642](https://github.com/anomalyco/opencode/issues/53642), PR [#53660](https://github.com/anomalyco/opencode/pull/53660)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> whether the chat log should always include initial user prompt if the
> scroll back would be so long that tui decides not to visualize it any
> more; default: on. and tui, regardless of this settings showing it on or
> off, should always show, maybe centered, behind horizontal line where the
> content is hidden. in the same changeset, let's allow opencode tui to fetch
> cropped content - check webapps/portal how it's rendering it - load
> bottom/upper 50, load all, etc. - where horizontal lines get placed, etc.;
> and allow user to do the same here in opencode tui. what is opencode's
> default scrollback buffer? is it defined by size, or number of
> messages/tool calls/etc in between, or what? whatever that is, if not
> configurable, export this as a tui setting. measure on real opencode
> process, how halving that value, and doubling that value, when opening a
> large session from our history (find one) affects RAM usage. and for
> halving/doubling also measure cpu usage.

## Goals

- Answer what the TUI's scrollback limit is: the newest 100 messages per
  session, counted in messages only. Opening a session fetches
  `session.messages({ limit: 100 })`; every new message past 100 `shift()`s
  the oldest from the sync store. All parts of a kept message stay loaded,
  whatever their size. Nothing else limits what the transcript renders.
- `tui.json` `transcript.max_messages` (default `100`) and
  `transcript.keep_first_prompt` (default `true`).
- A centered divider on a horizontal rule wherever messages are hidden,
  whatever `keep_first_prompt` says, with `load 50 above`, `load 50 below`
  and `load all` (portal's "Load top 50 more" / "Load bottom 50 more" /
  "Load all"); `load all N` for a gap of 50 or fewer.
- The same actions as palette commands and keybinds (unbound by default).

## Non-goals

- Dropping already-loaded messages again ("collapse"); portal has none either.
- A byte- or part-based limit.

## Rationale and constraints

- The store tracks each session's gap as `head` (messages before it),
  `count` (hidden) and `limit` (newest kept). A new message past the limit
  hides the oldest message after the head, never the pinned prompt; an update
  to a message inside the gap is ignored rather than reinserted.
- "Above" fills the gap from its older edge (after the pinned prompt, or the
  session's oldest messages via `order=asc`); "below" from its newer edge.
  Loading grows `limit` by what it loaded; "load all" makes it unlimited.
- `GET /session/:id/message` only paged backwards. It gains `after`,
  `order=asc`, message-ID anchors for `before`/`after` and `X-Total-Count`.
  The TUI anchors on message IDs it holds because a cursor goes stale once
  its message is dropped. The experimental `/api/session/:id/message` reads
  `session_message`, which sessions predating the event tables lack.
- The first prompt is requested only when the newest page does not cover the
  session, so a short session makes one request, as before.
- Loading keeps a scrolled-up reader's place by setting (not adjusting) the
  scroll position from the first visible block's new layout, so it composes
  with `keepScrollAnchor` on `dev-nowaker` without moving twice.
- `messages_first` (`home`, `ctrl+home`) reaches the top of what is loaded:
  the pinned first prompt and the divider below it while messages are hidden,
  the real top once everything is loaded. Prompt/block navigation does not
  cross into unloaded messages. `keep_scroll_on_submit` is unaffected.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `fcf142f4c4` | 2026-10-06 | settings, gap store, divider, load commands, paged-route directions | `HiddenMessages` / `hidden` / `session.load` / `session.hidden` in `packages/tui/src/context/sync.tsx`; `HiddenMessagesDivider`, `loadHidden` and `session.hidden.*` commands in `packages/tui/src/routes/session/index.tsx`; `Transcript` in `packages/tui/src/config/index.tsx`; `messages_hidden_*` in `packages/tui/src/config/keybind.ts`; `MessageV2.page` / `MessageV2.total` in `packages/opencode/src/session/message-v2.ts`; `MessagesQuery` and the `messages` handler in `packages/opencode/src/server/routes/instance/httpapi/` |

## Measurements

One real session of 7,152 messages (part JSON for the newest 50 / 100 / 200 messages: 336 KB / 959 KB / 2.47 MB), opened with `-s` in an isolated TUI (scratch `XDG_*`, throwaway tmux socket, 160x50) on Linux, then left idle on the session. RSS is the TUI process (`VmRSS`) 90 s after start and after 10 idle minutes; idle CPU is `utime+stime` per minute averaged over idle minutes 4-10 (minutes 1-3 still settle). One run per row, strictly one at a time, on a busy desktop (load average around 50).

| Build | `transcript.max_messages` | RSS after load | RSS after 10 min idle | Idle CPU |
|---|---|---|---|---|
| upstream `dev` | 100 (fixed) | 648 MB | 614 MB | 2.05% |
| branch | 50 | 658 MB | 572 MB | 1.99% |
| branch | 100 (default) | 686 MB | 610 MB | 1.95% |
| branch | 200 | 737 MB | 658 MB | 1.95% |

Halving the limit saves about 40 MB of settled RSS on this session; doubling it costs about 50 MB. Idle CPU does not depend on the limit: an idle TUI showing the session spends about 2% of a core whatever the limit. At the default the PR settles at the same RSS as upstream `dev` (610 vs 614 MB). Its after-load figure is higher, by the pinned first prompt (here a 300+ line prompt) and run-to-run noise.

## Verification

- `packages/opencode`: `test/session/messages-pagination.test.ts` and
  `test/server/session-messages.test.ts` pass (54 + 6; the endpoint file
  needs `--timeout 60000` on a loaded desktop, on `dev-nowaker` without this
  commit as well). `packages/tui`: `bun typecheck` and `bun test` pass, 290
  pass / 0 fail on `dev-nowaker`, including
  `test/cli/cmd/tui/sync-hidden-messages.test.tsx` and
  `sync-scroll-anchor.test.tsx` (which now mounts `TuiConfigProvider`).
- Manual surface: scratch `XDG_*`, throwaway tmux socket `oc-tui-history`, a
  `VACUUM INTO` copy of the live database, session
  `ses_fafa47d08ffentT1bIhM9Y4Op6` (7,152 messages). Upstream `dev`:
  `ctrl+g` lands mid-session with nothing marking the gap. Branch and the
  installed `1.18.34-vt-135` build: first prompt on top, then
  `7,051 messages hidden` with `load 50 above / load 50 below / load all`;
  clicking `load 50 below` -> 7,001, `load 50 above` inserts the session's
  next messages under the first prompt, palette "Load all hidden messages"
  loads all 7,152 in about a second. On the installed build, scrolled four
  pages below the divider, palette "load 50 below" left 19 captured viewport
  rows byte-identical while the count went to 7,001 (composes with
  `keepScrollAnchor`).

## Timeline

- 2026-10-06
  [`ses_eec5b71ddffe4A47jCysfkQh6l`](../sessions/2026-10-06-tui-history-crop.md)
  - `fcf142f4c4`: introduce; upstream issue #53642 and PR #53660; build and install
    on desktop and m4max.

## Current maintenance notes

- Drop the fork commit once the PR (or an equivalent) is in upstream `dev`.
- No host setting needed: `max_messages` stays at its default and
  `keep_first_prompt` defaults to `true`.

### Upstream integration checklist

- Confirm `message.updated` in `sync.tsx` still hides past `hidden.limit`
  after `hidden.head`, not index 0.
- Run `test/cli/cmd/tui/sync-hidden-messages.test.tsx` in `packages/tui` and
  `test/session/messages-pagination.test.ts` plus
  `test/server/session-messages.test.ts` in `packages/opencode`.
- Regenerate the SDK if `MessagesQuery` moved.
- Build through `.vibeterm/build.sh`; open a session over 100 messages,
  `ctrl+g`, see the first prompt and divider, click `load 50 below`.

## Supersession or removal

- Not applicable; status is active.
