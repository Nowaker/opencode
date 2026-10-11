# Prompt paste and undo: raw paste, paste summary, placeholder deletes, edit dialog, grouped undo

## Identity

- Workday: 2026-10-10 (continued past midnight)
- Session: `ses_ed7634c31ffeH84yR0S99Ty8Nd`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-paste-undo` (worktree off `dev-nowaker`); upstream PR branches `paste-placeholder-delete`, `paste-summary-config`, `paste-raw-key`, `prompt-undo-history`, `paste-edit-dialog` off upstream `v1` `dfb56f76c7`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `0714559fe2`, `1db2260dee`, `549df87541`, `6a50eb5d4f`, `832a7fe5c0`, `460027c707`
- Forklog commit: this file's introducing commit

## User requests

Item 28, relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`; the user's words are quoted in each feature record.

## Goals

- Raw paste key, configurable paste summary, atomic placeholder deletes, click-to-edit dialog, grouped undo/redo on ctrl+z / ctrl+shift+z across submits.

## Constraints and non-goals

- No TUI tab, serve unit or `vibeterm` tmux server restarted.
- Upstream PRs keep upstream's key defaults; ctrl+z defaults and `terminal_suspend: none` are fork-only (`832a7fe5c0`).

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `0c11fdeec8` | `460027c707` + this forklog commit | rebase `prompt-paste-undo`, fast-forward; pushed to `origin` and `nowaker-github` |
| `opentui` fork (`~/projekty/forks/opentui`) | `atomic-virtual-extmarks` | upstream `main` `dfbb61f5` (`v0.6.0`) | `bec96676` | new fork of anomalyco/opentui; PR [#1628](https://github.com/anomalyco/opentui/pull/1628) |
| `opencode-tools` | `master` | `3323391` | `0220818` | drop the default ctrl+z mask in opencode panes, decode `\x1a` in the sidebar; pushed to `origin` |

Upstream note: `anomalyco/opencode` `dev` is now the v2 line (`packages/opencode` removed); v1 maintenance moved to branch `v1` (`v1.19.0`). This session's PRs target `v1`. The fork's `merge-base HEAD github/dev` is still `907b3bc518`.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Delete a paste placeholder whole](../features/2026-10-10-paste-placeholder-delete.md) | introduced | `0714559fe2`; opencode PR [#54457](https://github.com/anomalyco/opencode/pull/54457); opentui PR [#1628](https://github.com/anomalyco/opentui/pull/1628) |
| [Configurable paste summary](../features/2026-10-10-paste-summary-config.md) | introduced | `1db2260dee`; PR [#54458](https://github.com/anomalyco/opencode/pull/54458) |
| [Paste without a placeholder](../features/2026-10-10-paste-raw-key.md) | introduced | `549df87541`; PR [#54459](https://github.com/anomalyco/opencode/pull/54459) |
| [Grouped prompt undo and redo](../features/2026-10-10-prompt-undo-history.md) | introduced | `6a50eb5d4f`, `832a7fe5c0`; PR [#54460](https://github.com/anomalyco/opencode/pull/54460) |
| [Paste placeholder edit dialog](../features/2026-10-10-paste-edit-dialog.md) | introduced | `460027c707`; PR [#54463](https://github.com/anomalyco/opencode/pull/54463) |

## Other delivered work

- opencode-tools `0220818`: `DEFAULT_SHORTCUT_MASKS` is empty (it masked ctrl+z in opencode panes, swallowing undo); the sidebar `KeyDecoder` names `\x1a` `ctrl-z` so the settings editor can still capture it. FEATURES.md, README and tests updated.
- Shared Vibeterm settings (desktop master, pulled by m4max): `shortcutMasks: []`; live bindings regenerated and re-sourced on both `vibeterm` servers, which now bind nothing on `C-z`.
- `~/.config/opencode/tui.json` on desktop and m4max: `terminal_suspend: none`, `input_undo: ctrl+z,ctrl+-,super+z`, `input_redo: ctrl+shift+z,ctrl+.,super+shift+z` (backup `tui.json.bak-before-undo-keys`).

## Verification

- `bun typecheck` and `bun test --timeout 60000` in `packages/tui`: 424 pass, 1 skip (before the final rebase); after rebasing onto `0c11fdeec8`, the prompt, component, keymap and config tests 126 pass. Upstream PR branches: full TUI suites pass on each.
- `packages/opencode` `test/config/tui.test.ts`: 4 plugin-merge failures, identical on unmodified `dev-nowaker`.
- Real-PTY rig: the worktree built to a scratch path (`OPENCODE_INSTALL`, guard gate passed), isolated XDG dirs, a fake OpenAI-compatible provider, a throwaway forked-tmux socket with Vibeterm's `extended-keys` settings; results in each feature record.
- Key bytes into an `@vibeterm_pane=opencode` pane, throwaway socket with Vibeterm's live `C-z` / `C-S-z` / `C-S-Z` bindings:
  - Ghostty 1.3 (Xvfb, Vibeterm instance config): ctrl+z `\x1a` (nothing while masked), ctrl+shift+z `\e[27;6;90~`, ctrl+minus `\e[27;5;45~`, ctrl+period `\e[27;5;46~`.
  - Terminal.app VibeTerm profile on m2pro over ssh: ctrl+z `\x1a` (nothing while masked), ctrl+shift+z sent `\e[122;6u`, tmux delivered `\e[27;6;122~`; ctrl+minus `\x1f`, ctrl+period nothing.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` on desktop and m4max (m4max fast-forwarded to `460027c707` first).
- v1 database guard gate: PASSED on both.
- Installed: desktop `1.18.34-vt-206-907b3bc518` (inode `49952709`), m4max `1.18.34-vt-206-907b3bc518` (inode `27704236`); both contain `expandToVirtualExtmarks`, `input_paste_raw` and the retry-header marker.
- Retry-header cap: the dirty diff matched the canonical patch on both hosts.
- Running services: none restarted; `opencode-serve-tailscale` PID `3001971`, started 2026-10-11 00:11:14 CDT, unchanged.

## Commit provenance

- Feature commits above, each with `AI-Session-ID: ses_ed7634c31ffeH84yR0S99Ty8Nd`; upstream PR branch commits carry no AI trailers.

## Unknowns and blocked verification

- ctrl+minus / ctrl+period do not reach opencode from Terminal.app (the profile has no rows for them); ctrl+z / ctrl+shift+z do.
- m4max's opencode-tools checkout has unpushed local commits from another session and was not fast-forwarded; the explicit `shortcutMasks: []` covers its old default.
