# busy_indicator: scanner or one-cell spinner for a running turn

## Identity

- Workday: 2026-10-18 (worked 2026-10-19 03:46-05:40 local, before dawn, so the evening workday)
- Session: `ses_eaca65b1bffeZBbc3UZRmHnrMn`
- Agent/platform: `Sisyphus - ultraworker` (anthropic/claude-opus-5-5, high) / linux
- Repository: `~/projekty/webapps/opencode` (fork), plus `~/projekty/nowaker/opencode-tools`
- Integration branch: `dev-nowaker`
- Development branch(es): `busy-indicator`; opencode-tools `tui-busy-indicator-default`
- Upstream base: `dfb56f76c7` (`v1.19.0`)
- Source result commit(s): `5b6ed238d3`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, the user verbatim:

> new tui featre: in progress animation, replacable. current one is like Knight Industries Two Thousand hehe, sliding left/right. the issue with it is that on very lagged servers, you don't get to see if it's doing anything now because many 'frames' of this are noop. option to replace with the single character block animation, like we have for submitting prompt. default for vibeterm: that new one.

## Goals

- A tui.json option choosing the running-turn animation, with upstream's scanner unchanged as the default, and Vibeterm's default the one-cell spinner.

## Constraints and non-goals

- Fork-only, no upstream PR. Do not restart tabs.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| fork | `dev-nowaker` | `0a6d075e52` | `5b6ed238d3` | ff of `busy-indicator`, pushed to origin and nowaker-github |
| fork | `dev-nowaker` | `5b6ed238d3` | `0308d63ea7` | `ses_eac9def85ffeQUlw8vmM8s7aoY` rebased its profile fix `b977d20fbe` on top and pushed |
| opencode-tools | `master` | `7840f77c3e8` | `d4b5a6beb13` | ff of `tui-busy-indicator-default`, pushed |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Choose the running-turn animation](../features/2026-10-18-busy-indicator.md) | new | `5b6ed238d3`; tests below |

## Other delivered work

- opencode-tools `d4b5a6beb13`: `busy_indicator: "spinner"` in `VIBETERM_TUI_DEFAULTS`, catalog regenerated from the fork at `5b6ed238d3`, Focus decision, released-choice note, FEATURES.md.

## Verification

- `bun test test/ui/busy-indicator.test.ts test/config.test.tsx test/component/prompt-footer.test.tsx` (packages/tui, `--timeout 30000`) - 35 pass. At bun's default 5 s timeout the existing first footer test times out on a cold boot, as it also does on `0a6d075e52`.
- `bun test test/cli/run/runtime.boot.test.ts test/cli/run/footer.view.test.tsx` (packages/opencode) - 29 pass.
- `bun typecheck` in packages/tui and packages/opencode - clean.
- opencode-tools `bun test _lib/opencode-tui-knobs vibeterm-opencode-client/settings-tui-knobs.test.ts` - 42 pass. `settings-explanations.test.ts` has 4 failures that also fail on master `c3ca426b209`.
- Manual surface: worktree source in a throwaway tmux socket with scratch `XDG_*`, a loopback model that never answers, a prompt submitted. Footer row captured every 130 ms:
  - `busy_indicator: "spinner"`: `⠇ ⠋ ⠹ ⠸ ⠴ ⠧  esc interrupt`, a new glyph each capture.
  - `"scanner"` and unset: `⬝⬝⬝⬝⬝⬝⬝⬝`, `■■■⬝⬝⬝⬝⬝`, `⬝■■■■■■⬝`, `⬝⬝■■■■■■`, `⬝⬝⬝⬝⬝■■■`, the unchanged 8-cell scanner.

## Build and install

- Build command: `VIBETERM_V2_GUARD=.../vibeterm-v2-guard .vibeterm/build.sh` from the primary checkout.
- Installed artifact: desktop `1.19.0-vt-362-dfb56f76c7` (this session, gate passed), superseded by `1.19.0-vt-364-dfb56f76c7` built by `ses_eac9def85ffeQUlw8vmM8s7aoY` from `0308d63ea7`; m4max `1.19.0-vt-364-dfb56f76c7` (this session, from `0308d63ea7`, gate passed 2026-10-19T10:00:28Z).
- Running services: no tabs restarted. `vibeterm-collector` restarted on both hosts to load the new default; both healthy and both `~/.config/opencode/tui.json` now hold `"busy_indicator": "spinner"`.

## Commit provenance

- `5b6ed238d3` - feature
- opencode-tools `d4b5a6beb13` - Vibeterm default
- Required trailer: `AI-Session-ID: ses_eaca65b1bffeZBbc3UZRmHnrMn`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-18-busy-indicator.md
```

## Unknowns and blocked verification

- None.
