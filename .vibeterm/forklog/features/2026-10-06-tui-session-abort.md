# Single-press session abort, /abort and immediate "aborting…" feedback

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `abort-feedback` (feedback, upstream PR head), `abort-keybind-feedback` (stacked on it; keybind and `/abort`, upstream PR head); landing branch `abort-land`
- First local commit: `1d075a48b8`, `1ada8e5eb3` (cherry-picks of `6a20e39624`, `3f028d0283`)
- Current local commit(s): `1d075a48b8`, `1ada8e5eb3`
- Upstream base when introduced: `ecc4916b5a` (upstream `dev`) for the PR branches; `dev-nowaker` stays on `907b3bc518`
- Last checked against upstream: `ecc4916b5a` (upstream `dev`)
- Upstream: issues [#53652](https://github.com/anomalyco/opencode/issues/53652) and [#53653](https://github.com/anomalyco/opencode/issues/53653), PRs [#53655](https://github.com/anomalyco/opencode/pull/53655) and [#53656](https://github.com/anomalyco/opencode/pull/53656) (stacked on #53655)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> make abort a command that can be issued by a standard shortcut, not a combo;
> eg. ^k. i don't think it's currently configurable, e.g. you can rebind the
> stupid escape escape into ^k. but if yes, add it as the second keybind for
> that command. if not possible, e.g. command can only be bound to a single
> shortcut, make it possible that it can be bound to multiple. also, just like
> /timestamps exists as tui only slash command to make some tui changes, no ai
> turn/no prompt, also expose /abort. separately, also make its normal
> escape-escape (and other aborts) actually responsive. under load, i press
> escape-escape and nothing happens. i don't know if i press too slow, or this
> stupid UI won't show anything until oc backend or whatever actually
> acknowledges the abort. this shit should instead say 'aborting...' or
> something so it's clear my job as the aborter is done and i don't have to
> keep pressing the stupid escape button 20 more times.

## Goals

- `session.abort` aborts on one press; `session_abort` keybind (default
  `alt+escape`, multi-key like every keybind); `/abort` and a palette entry.
- Every abort path shows `aborting…` in the prompt footer before the request
  is sent, until the session goes idle; a failed request or a turn still
  running 15s later clears it with a toast.
- A double Escape that reaches the TUI in one read still aborts.

## Non-goals

- `session.interrupt` keeps its two-press counting and its 5s window.
- Vibeterm's `abortSessionTurn` (two separate `send-keys Escape` 300ms apart)
  is unchanged and keeps working.

## Rationale and constraints

- The double press lives inside the `session.interrupt` command
  (`store.interrupt >= 2`), so rebinding `session_interrupt` to ctrl+k would
  still need two ctrl+k presses; keybinds already accept comma-separated
  lists, so a separate single-press command was the missing piece.
- `ctrl+k` is `input_delete_to_line_end` by default, so it is not a default
  for `session_abort`. The `session.abort` binding layer is enabled only while
  the session status is not idle (priority 1), so a shared key keeps editing
  while idle. The hosts set `"alt+escape,ctrl+k"` in `tui.json`.
- Vanilla showed nothing between the second Escape and the status going idle:
  the footer went straight back to `esc interrupt`. Measured (fake streaming
  provider, tmux socket, 10ms pane polling): idle 94-299ms after the second
  Escape, with or without 4 CPU hogs pinned to the TUI's cores.
- The real "nothing happens" failure is a dropped key, not latency: Escape is
  a bare ESC byte, so presses that land in one read (main thread busy, or one
  `tmux send-keys Escape Escape`) parse as `alt+escape` (two) or a nameless
  key (three or more), neither matches `escape`. Vanilla with the TUI
  SIGSTOPped across the presses: 0/6 aborted; coalesced send-keys: 0/2.
  `registerEscapeBursts` maps 3+ ESC bytes to `alt+escape`, the default
  `session_abort` key.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `1d075a48b8` | 2026-10-06 | `aborting…` state set before the abort request; cleared on idle, on error (toast) or after `ABORT_TIMEOUT_MS` (toast) | `abort()`, `store.aborting`, `aborting` memo and the footer `<Show>` in `packages/tui/src/component/prompt/index.tsx` |
| `1ada8e5eb3` | 2026-10-06 | `session.abort` command, `/abort`, `session_abort` keybind, ESC-burst resolver, docs line | `session_abort` in `packages/tui/src/config/keybind.ts` (`Definitions`, `CommandMap`); `session.abort` command and its busy-only `useBindings` layer in `prompt/index.tsx`; `registerEscapeBursts` in `packages/tui/src/keymap.tsx`; `test/keymap.test.tsx`; `packages/web/src/content/docs/keybinds.mdx` |

## Verification

- `bun typecheck` and `bun test` in `packages/tui`: 195 pass on the upstream
  branch, 281 pass on `abort-land` after the rebase onto `9163ac0f36`.
- `test/keymap.test.tsx` feeds one, two and four ESC bytes and ctrl+k in
  single reads and checks which reach `session.abort`.
- Manual surface: isolated `XDG_*`, `OPENCODE_TOOLS_DATA_DIR`,
  `OPENCODE_PLUGINS_DATA_DIR`, `TMPDIR` under `./tmp`, throwaway tmux sockets
  `oc-abort-*`, fake slow provider on 127.0.0.1 logging client disconnects.
  After the change: `aborting…` 42-168ms after the second Escape; stalled
  Esc Esc 3/3 and Esc Esc Esc 3/3 aborted (also under load); ctrl+k
  `aborting…` 27-98ms; `/abort` 102-217ms. Idle: ctrl+k still deleted to end
  of line (`hello world` -> `hello`), `/abort` showed "Session is not running"
  and sent no request to the provider. Repeated on `abort-land`.

## Timeline

- 2026-10-06
  [`ses_eec446a24ffebz6buEl7LB2m3O`](../sessions/2026-10-06-tui-session-abort.md)
  - `1d075a48b8`, `1ada8e5eb3`: introduce; upstream issues #53652/#53653 and
    PRs #53655/#53656; build and install on desktop and m4max;
    `session_abort: "alt+escape,ctrl+k"` in both hosts' `tui.json`.

## Current maintenance notes

- Drop each fork commit once its PR (or an equivalent) is in upstream `dev`.
- Host setting: `keybinds.session_abort: "alt+escape,ctrl+k"` on desktop and
  m4max.

### Upstream integration checklist

- Confirm `session.interrupt` still calls `abort()` on the second press and
  `session.abort` still registers its binding layer only while not idle.
- Confirm `registerEscapeBursts` is still registered in
  `registerOpencodeKeymap`.
- Run `test/keymap.test.tsx` and `bun typecheck` in `packages/tui`.
- Build through `.vibeterm/build.sh`; in a running session press ctrl+k and
  see `aborting…`; while idle ctrl+k deletes to end of line.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
