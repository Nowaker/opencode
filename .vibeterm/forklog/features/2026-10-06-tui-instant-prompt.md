# Instant home prompt and early input at startup

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `provisional-prompt` (also the upstream PR head, `0dae58048c`); landing branch `provisional-prompt-land`
- First local commit: `b12845f999` (cherry-pick of `0dae58048c`)
- Current local commit(s): `b12845f999`
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

## Non-goals

- Existing sessions (`-c`, `-s`) and `--prompt` still start as before; stage 2
  of item 19 covers the session loading screen.
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

## Timeline

- 2026-10-06
  [`ses_eebf9a83fffeIQQwW9gVFo5jaO`](../sessions/2026-10-06-tui-instant-prompt.md)
  - `b12845f999`: introduce; upstream issue #53696 and PR #53698; build and
    install on desktop and m4max (`1.18.34-vt-144-907b3bc518`).

## Current maintenance notes

- Drop the fork commit once PR #53698 (or an equivalent) is in upstream `dev`.
- An upstream bump must check the following:
  - `createCliRenderer` options in `app.tsx` and `runtime.lifecycle.ts` still
    let `handover()` run first and `prependInputHandler` feed the instant
    editor.
  - opentui's `TextareaRenderable` actions still match: the
    `test/instant/editor.test.ts` parity test fails if they drift.
  - The home layout in `routes/home.tsx`, the `Prompt` box structure and the
    home footer/tips plugins still read `layout.ts`.
- Vibeterm's own provisional loader for new-session tabs is being made aware of
  this screen in item 19b (`ses_eeadda349ffep0Jwwis5g1DJXi`, opencode-tools).

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
