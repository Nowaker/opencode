# Drag-to-copy anywhere on the instant startup screens

## Identity

- Workday: 2026-10-14
- Session: `ses_eebf9a83fffeIQQwW9gVFo5jaO`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `instant-drag-copy` (worktree off `dev-nowaker`)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`); unchanged
- Source result commit(s): `8f0ab48c4b`
- Forklog commit: this file's introducing commit

## User requests

The coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, relaying the user:

> "opencode tui session loader screen: allow drag-to-copy anywhere".

> Want: a drag anywhere on that screen (header, transcript preview, footer,
> sidebar if drawn) selects and copies the text as drawn, the same way the
> mounted session view's drag-to-copy works (OSC 52 plus native clipboard via
> the existing clipboard path). No new setting; it is a bug-level gap.

## Goals

- While opencode loads, a drag over any text of its own instant home or
  "Loading session…" screen copies that text, as the loaded TUI does.

## Constraints and non-goals

- No new setting.
- Vibeterm's own loader already copies drags (opencode-tools `59a5052`); this
  covers only opencode's screens in `packages/tui/src/instant`.
- No TUI tab, service or Vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `181722b19d` | `8f0ab48c4b` + this forklog commit | fast-forward from `instant-drag-copy`; pushed to `origin` and `nowaker-github`; m4max fast-forwarded |
| `opencode` | `instant-drag-copy` | - | `8f0ab48c4b` | worktree, retired after landing |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Instant home and session prompt and early input at startup](../features/2026-10-06-tui-instant-prompt.md) | changed: a drag anywhere on the instant screens marks and copies the drawn text | unit tests, PTY runs below |

## Behavior

- A press outside the prompt box starts a mark over the drawn grid; the marked
  cells render inverse; on release the marked text (reading order, trailing
  blanks trimmed, rows joined with newlines) is copied.
- A drag inside the prompt still selects editor text and is copied on release.
- A click without movement keeps its existing behavior (caret placement,
  queued click commands); any key clears the mark.
- The copy writes OSC 52 (tmux/screen-wrapped when needed) and runs the native
  clipboard tools. In the worker phase, OSC 52 goes through the worker's locked
  terminal writer so it cannot interleave with a frame; in the renderer gap it
  goes through `Clipboard.write`.

## Verification

- `bun test` in `packages/tui`: 684 pass, 0 fail (685 tests, 97 files);
  `bun typecheck` clean in `packages/tui` and `packages/opencode`.
- Red/green: the three new tests in `test/instant/session.test.ts` (footer
  drag copies the version and a key clears the mark; a two-row drag forward
  and backward on the session screen; a prompt drag copies its text and a
  click copies nothing) fail 3 of 11 with the source change stashed and pass
  with it.
- Real PTY (`tmp/instant-copy/pty.sh`, throwaway tmux socket `instcopy`,
  `set-clipboard on`, scratch `XDG_*`), a footer drag over the version string
  while `strace` held startup:
  - worker phase: the main thread's open of `$TMPDIR` (the renderer's native
    library extraction) delayed 20 s; main thread in state `t` while dragging.
  - renderer gap: the open of `opencode.db` delayed 20 s.

  | Binary | Phase | Inverse cells | tmux buffer |
  |---|---|---|---|
  | installed `vt-292` | worker | 0 | none |
  | installed `vt-292` | gap | 0 | none |
  | scratch build of `8f0ab48c4b`'s tree | worker | 1 | `1.19.0-vt-dragcopy` |
  | scratch build | gap | 1 | `1.19.0-vt-dragcopy` |
  | scratch build, `-s ses_dragcopyAbCdEfGhIjKlMnOp` | worker | - | the sidebar's session ID |

- Pre-push hooks for both remotes: 30 of 30 typecheck tasks.

## Build and install

- Build command: `.vibeterm/build.sh` with `VIBETERM_V2_GUARD` on both hosts;
  the v1 database guard gate passed on each.
- Installed artifact: `1.19.0-vt-293-dfb56f76c7` on desktop (inode
  `49959281`) and m4max (inode `34233030`), both with the retry-header cap
  marker. The installed desktop binary repeats the PTY results: in the worker
  phase and the renderer gap a footer drag copies `1.19.0-vt-293-dfb56f76c7`
  (1 inverse cell while dragging), and with `-s` a sidebar drag copies the
  session ID.
- Running services: not touched; desktop `opencode-serve-tailscale` (pid
  `914944`) and `opencode-serve-lan` (pid `910216`) unchanged across the
  install.

## Commit provenance

- `8f0ab48c4b` - `fix(tui): copy a drag anywhere on the instant screen`
- Required trailer: `AI-Session-ID: ses_eebf9a83fffeIQQwW9gVFo5jaO`

## Unknowns and blocked verification

- The native clipboard path (`wl-copy`/`xclip`/`pbcopy`) was not observed in
  the PTY runs, whose environment has no display; only OSC 52 was.
