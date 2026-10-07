# Show the session ID in the sidebar

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `sidebar-session-id` (also the upstream PR head); landing branch `sidebar-session-id-land`
- First local commit: `2333a1edb1` (rebase of `fe10a35c26`, itself the fork-side reapplication of `18d6718b62` on `sidebar-session-id`)
- Current local commit(s): `2333a1edb1`
- Upstream base when introduced: `ecc4916b5a` (upstream `dev`, `sidebar-session-id`); `dev-nowaker` stays on `907b3bc518`
- Last checked against upstream: `ecc4916b5a` (upstream `dev`)
- Upstream: issue [#53662](https://github.com/anomalyco/opencode/issues/53662), PR [#53663](https://github.com/anomalyco/opencode/pull/53663)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 20), quoting
the user:

> new tui feature, default off: show session id one line below session title,
> not in white, in dimmed color (like completed todos are rendered in).

## Goals

- `sidebar.session_id: true` in `tui.json` shows the session ID on the line
  below the session title in the sidebar, in `theme.textMuted` (the color
  `TodoItem` uses for completed todos).
- The line stays inside the `sidebar_title` slot, so `sidebar.pin_title`
  pins it with the title, and it is ordinary selectable text.
- `/session-id` (`session.sidebar.session_id`, keybind `sidebar_session_id`,
  unbound) toggles it; the kv key `sidebar_session_id` wins over `tui.json`.

## Non-goals

- No label, no truncation, no click-to-copy; the full `ses_...` ID only.
- Host `tui.json` unchanged: the user gave no host value.

## Rationale and constraints

- Upstream already renders this exact line, gated on
  `InstallationChannel !== "latest"`. Fork builds stamp a real semver, so they
  are `latest` and never show it.
- Unset keeps upstream behavior (shown in development builds, hidden in
  release builds) so the upstream PR changes nothing by default. On the fork's
  release-channel builds that means off, as requested.
- The runtime toggle follows `sidebar.pin_title`'s kv-persisted command
  pattern; it costs one command entry and one keybind definition.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `2333a1edb1` | 2026-10-06 | `sidebar.session_id`, `/session-id`, docs | `Sidebar.session_id` in `packages/tui/src/config/index.tsx`; `showSessionID` and the `sidebar_title` slot body in `packages/tui/src/routes/session/sidebar.tsx`; `sidebarSessionID` and the `session.sidebar.session_id` command in `packages/tui/src/routes/session/index.tsx`; `sidebar_session_id` in `packages/tui/src/config/keybind.ts`; `test/config.test.tsx` |

## Verification

- `bun typecheck` and `bun test` in `packages/tui`: upstream branch 194 pass,
  1 skip, 0 fail; `dev-nowaker` (`2333a1edb1`) 290 pass, 1 skip, 0 fail.
- Manual surface: release-channel builds (`OPENCODE_VERSION=1.18.34`),
  isolated `XDG_*` and tool/plugin data dirs, throwaway tmux socket
  `oc-tui-session-id`, one fake OpenAI-compatible provider. Vanilla upstream
  and `session_id` unset: no ID under the title. `"session_id": true`: the
  ID on the line below the title in `#808080`, the same escape as the
  Context values. `/session-id` hid it (kv `sidebar_session_id: false`) and
  showed it again. On `dev-nowaker` with `pin_title` and `session_id`: the ID
  renders in the pinned title block, and an SGR mouse drag across it put
  the full 30-character ID into the tmux buffer through OSC 52.

## Timeline

- 2026-10-06
  [`ses_eebf95604ffekfFQU7LOgARLnt`](../sessions/2026-10-06-sidebar-session-id.md)
  - `2333a1edb1`: introduce; upstream issue #53662 and PR #53663; installed
    on desktop and m4max; no host `tui.json` change.

## Current maintenance notes

- Drop the fork commit once PR #53663 (or an equivalent) is in upstream `dev`.
- No host setting; enable per machine with `/session-id` or
  `"sidebar": { "session_id": true }`.

### Upstream integration checklist

- Confirm the sidebar title block still renders the ID line and that no new
  `InstallationChannel` gate replaced `showSessionID`.
- Run `test/config.test.tsx` and `bun typecheck` in `packages/tui`.
- Build through `.vibeterm/build.sh`; with the setting on, the ID shows below
  the title.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
