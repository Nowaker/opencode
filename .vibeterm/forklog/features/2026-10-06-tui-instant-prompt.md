# Instant home and session prompt and early input at startup

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `provisional-prompt` (also the upstream PR head: `8b7f258af6` stage 1, `f829a6a3f7` stage 2, each including its part of the startup fix); landing branch `provisional-prompt-land`
- First local commit: `b12845f999` (cherry-pick of `0dae58048c`, the first version of stage 1)
- Current local commit(s): `b12845f999` (home), `5621b2c706` (session, cherry-pick of `620cd1e333`), `12a11e65f1` (startup fix: the diff from `620cd1e333` to `f829a6a3f7`)
- Upstream base when introduced: `ecc4916b5a` (upstream `dev`, `provisional-prompt`); `dev-nowaker` stays on `907b3bc518`
- Last checked against upstream: `ecc4916b5a` (upstream `dev`)
- Upstream: issue [#53696](https://github.com/anomalyco/opencode/issues/53696), PR [#53698](https://github.com/anomalyco/opencode/pull/53698)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 19), quoting the
user:

> additionally, as a tui feature, default on - both for regular tui, and it's
> super minimal alternative version - is to start accepting stdin as early as
> possible; basically even if it's black loading screen, the stdin will be sent
> to the prompt window (except for enter hit, enters should not perform a
> submission and be dropped; shift+enters for line breaks totally fine).
>
> and also separately, a totally new feature - opencode provisional prompt
> screen. basically like a replica of our vibeterm loading screen where we can
> start prompting FAST, without having to wait for opencode to parse all its
> configs, all agents, plugins etc.

> and prompt draft fields, both two screens, must react to mouse clicks for
> caret movement, and the field itself must implement basic terminal things
> like home, end keys, ^w, ^u etc.

The full brief also asks for a 0.2 s budget on desktop, m4max and m2pro, layout
rules shared through a constants-only module, no SQLite on the loading path, a
cache keyed by the database location, the caret kept across the handover, and
white "still loading" / red "changed" notices for Enter during loading.

## Goals

- `opencode` paints the home screen (logo, prompt with the cached agent, model,
  variant and colors, shortcuts, cwd, version, a Loading spinner) within about
  50 ms and is typable by about 70 ms.
- The prompt edits like the real one: every `input_*` keybind with `tui.json`
  overrides, word wrap, click and drag, paste, undo.
- Text, caret and selection hand over exactly to the real home prompt.
- Enter while loading queues the submit. The queued submit goes through once
  the TUI loads, but only when agent/model/variant match the cache; otherwise a
  red notice asks for Enter again.
- `--mini`, and the TUI with `startup.instant_prompt: false`, capture keys
  invisibly (`startup.early_input`), dropping an Enter typed before raw mode.
- `--session ID` and `--continue` paint the session screen the same way: the
  prompt at the bottom with the session's cached selection, a "Loading
  session…" spinner in the transcript, and the sidebar at its real width
  (cached title or the ID, the ID line, a spinner, footer path and version).

## Non-goals

- `--prompt` and `--fork` still start as before.
- With `--continue` the session is unknown until load, so the sidebar title
  appears then.
- Project-level `tui.json` files are not read by the loading screen; they apply
  once the TUI loads.

## Rationale and constraints

- The main thread cannot service stdin while it evaluates the CLI's module
  graph (0.3-1.7 s blocked on desktop), so a worker thread reads and paints
  keys until the renderer takes over.
- The component tree renders nothing until the SDK, sync and theme providers
  load. The renderer phase therefore draws the frame from a box on the
  renderer root, not from a component.
- The cache sits beside the resolved database (`<db>.tui-startup.json`), so
  `OPENCODE_DB`, data directories and channels never share it; the loading path
  never opens SQLite.
- Draft persistence stays in Vibeterm (item 16): the early text is claimed in
  the prompt's `onMount`, before `handoff.ready`, so a restored orphan draft
  never overwrites it.
- Rejected: reading stdin on the main thread between imports. Measured key
  latency was 0.6-1.7 s.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `12a11e65f1` | 2026-10-06 | A damaged startup cache or a small pane no longer breaks startup: `read()` keeps only fields of the expected type, `boot.ts` starts without the instant prompt if starting it throws, and a spinner off the pane's grid is not animated | `read()` and its field readers in `packages/tui/src/instant/cache.ts` (`THEME_KEYS`, `Data.theme: Partial<Theme>`); the `InstantPrompt.start()` guard in `packages/opencode/src/boot.ts`; canvas `spin()` in `instant/frame.ts`; `test/instant/cache.test.ts` and the pane-size sweep in `test/instant/session.test.ts` |
| `5621b2c706` | 2026-10-06 | Session screen for `-s`/`-c`; per-session cache entries; sidebar rule and session/sidebar padding in `layout.ts` | `classify()` `session` mode and `readKv()` in `packages/tui/src/instant/index.ts`; `sessionLayout`/`paintSession` in `instant/frame.ts`; `TuiLayout.Session`, `Sidebar`, `sessionSidebarVisible`, `sessionContentWidth`, `sidebarShowsSessionId` in `layout.ts`, read by `routes/session/index.tsx`, `routes/session/sidebar.tsx` and `feature-plugins/sidebar/footer.tsx`; `sessions` in `instant/cache.ts`; session branch of the startup-notice effect in `component/prompt/index.tsx`; `test/instant/classify.test.ts` |
| `b12845f999` | 2026-10-06 | Instant home prompt, early input, startup cache, `startup.*` settings | `packages/opencode/src/boot.ts` and `script/build.ts` entrypoints (`OPENCODE_INSTANT_WORKER_PATH`); `packages/tui/src/instant/*`; `InstantPrompt.handover()` before `createCliRenderer` in `packages/tui/src/app.tsx` and `src/cli/cmd/run/runtime.lifecycle.ts`; `InstantPrompt.claim()` in `Prompt` `onMount` and `footer.prompt.tsx` `bind`; `component/instant-screen.ts`; `packages/tui/src/layout.ts`; `config/keybind-definitions.ts`; `core/src/global-path.ts`; `core/src/database/location.ts`; `Startup` in `config/index.tsx`; `test/instant/*` |

## Verification

- `bun typecheck` in `packages/core`, `packages/tui`, `packages/opencode` on
  `provisional-prompt-land`; `bun test` in `packages/tui`: 317 pass, 0 fail.
- `test/instant/editor.test.ts` runs every editing action from every caret
  position through the instant editor and opentui's `TextareaRenderable` and
  requires identical text, caret and selection; also wrap and caret placement.
- Manual surface, isolated `XDG_*` and tool/plugin data dirs, throwaway tmux
  socket `iso19`:
  - Instant frame vs loaded TUI: identical rows and colors with a warm cache.
    On a cold cache the frame lacks the model line and the prompt's bottom
    edge, but its rows are aligned.
  - `hello world`, three Left keys, `X`, a click on the second cell and `Y`
    before load show `hYello woXrld`, and the caret carries over; `Z` after
    load gives `hYZello woXrld`.
  - Enter during load: the white notice, then a submit after load. With the
    cache edited to another model: the red notice, then a submit on Enter
    again.
  - Ctrl+C on an empty prompt during load exits with `icanon echo` restored.
  - `--help`, `models`, a missing project directory, `--mini` (caret kept)
    and `startup.instant_prompt: false` all behave as described.
  - The process exits when its tmux server is killed at any time from 0.1 to
    20 s after launch.
- Time to typable (pty harness `tmp/latency.py` in the worktree, plus
  opencode-idle-bench `ttp --pure`):
  - desktop (load ~27): 114 ms median, against 4778 ms for `1.18.34-vt-136`
  - m2pro: 72-74 ms, 139 ms on a fresh data dir
  - m4max: 71-73 ms, 131 ms on a fresh data dir

  Keystroke-to-screen (`capture-pane` polling) is about 10 ms median, worst
  83-138 ms, at the handover.
- Session screen (`5621b2c706`), isolated socket `iso19b`, session from the
  scratch DB:
  - 160x45 (sidebar): rows of the instant frame and the loaded screen agree
    on the prompt, status row, sidebar title, ID line and footer; only the
    transcript and sidebar contents differ (spinners vs loaded). Cursor
    `5,38` in both. With `sidebar.session_id: false` the ID line is absent
    on both sides.
  - 120x40 (no sidebar): only the transcript row differs; cursor `5,33` in
    both.
  - Enter during load with `-s`: the white notice on the right of the status
    row, then the prompt is sent into that session. With the session's cached
    model edited: the red notice in the same place.
  - `bun test` in `packages/tui` on the landing branch: 322 pass, 0 fail.
- Time to typable for an existing session (typing starts once the pane is on
  the alternate screen; `tmp/session-ttp.py`, `--pure`, scratch DB):

  | host | `-s` before | `-s` after | `-c` before | `-c` after |
  |---|---|---|---|---|
  | desktop (idle-bench `ttp`, load ~30) | 5998 ms median | 115 ms median | 5545 ms median | 160 ms median |
  | m2pro | 2665-3466 ms | 68-138 ms | 2163-2542 ms | 71-75 ms |
  | m4max | 2162-3062 ms | 46-52 ms | 1762-2538 ms | 49-53 ms |

  Time until the session's text is visible is unchanged (2.4-3.9 s on the
  Macs, both builds).
- Startup fix (`12a11e65f1`): the same tests with only one behavior disabled,
  on tree `12a11e65f1`, from `packages/tui`:
  - `bun test test/instant/cache.test.ts` with the pre-fix `read()` body:
    exit 1, 2 of 3 fail (wrong-typed fields come back unfiltered); restored:
    3 pass.
  - `bun test test/instant/session.test.ts -t "every terminal size"` (home and
    session screens, idle and with a queued Enter, widths 1-160 by heights
    1-45) without the `spin()` guard: exit 1, `TypeError: undefined is not an
    object (evaluating 'frame.grid[at.y][at.x]')`; restored: pass.
  - Landing branch: `bun typecheck` clean in `packages/core`, `packages/tui`
    and `packages/opencode`; `bun test` in `packages/tui` 326 pass, 0 fail.
- Startup repro (`tmp/repro-startup.sh` in the `provisional-prompt` worktree:
  isolated data dir, provider pointed at a closed port, text and Enter typed
  during load, checked 15 s later): `1.18.34-vt-146` exits on a cached agent
  without `label` (`TypeError: undefined is not an object (evaluating 's of
  d')`) and on a numeric theme color (`t.cache.theme.text.slice is not a
  function`); `1.18.34-vt-148` keeps running in all 12 cases (ten damaged
  caches, an 80x10 home and a 44x20 session pane) on desktop and in the 5
  cases run on m4max.

## Timeline

- 2026-10-06
  [`ses_eebf9a83fffeIQQwW9gVFo5jaO`](../sessions/2026-10-06-tui-instant-prompt.md)
  - `b12845f999`: introduce; upstream issue #53696 and PR #53698; build and
    install on desktop and m4max (`1.18.34-vt-144-907b3bc518`).
  - `5621b2c706`: session screen for `-s`/`-c` (PR #53698 second commit);
    build and install on desktop and m4max (`1.18.34-vt-146-907b3bc518`).
  - `12a11e65f1`: keep a damaged startup cache or a small pane from breaking
    startup (PR #53698 commits rebuilt as `8b7f258af6` and `f829a6a3f7`);
    build and install on desktop and m4max (`1.18.34-vt-148-907b3bc518`).

## Current maintenance notes

- Drop the fork commit once PR #53698 (or an equivalent) is in upstream `dev`.
- An upstream bump must check the following:
  - `createCliRenderer` options in `app.tsx` and `runtime.lifecycle.ts` still
    let `handover()` run first and `prependInputHandler` feed the instant
    editor.
  - opentui's `TextareaRenderable` actions still match: the
    `test/instant/editor.test.ts` parity test fails if they drift.
  - The home layout in `routes/home.tsx`, the session layout in
    `routes/session`, the sidebar and its footer plugin, the `Prompt` box
    structure and the home footer/tips plugins still read `layout.ts`.
  - The fork's `sidebar.session_id`/`pin_title` sidebar keeps reading
    `TuiLayout.sidebarShowsSessionId` (the landing merged both).
- Vibeterm skips its own new-session loader (opencode-tools `0b281fa`) and
  existing-session loader (`9d3bd0e`) when the binary carries these screens
  (item 19b, `ses_eeadda349ffep0Jwwis5g1DJXi`). It finds them by scanning the
  binary for "OpenCode still loading, will submit shortly" and "Loading
  session…" (stored in the bundle as `Loading session\u2026`): rewording the
  first brings both loaders back, rewording the second the existing-session
  one.
- Known limitation: in session mode with the white notice showing, a pane
  narrower than about 50 columns wraps the cwd one character per row and
  pushes the prompt off screen. The loaded TUI's status row breaks the same
  way at that width.

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
