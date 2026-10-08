# Turn variant in assistant message footers

## Identity

- Workday: 2026-10-07
- Session: `ses_eec44cf7effeFCqQefM0NkWLaW`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-footer-variant` (local `5e4b1d22f7`); landing branch `footer-variant-land`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `bd9676d499`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user
(item 14, answering this session's question on what "show reasoning"
meant):

> i don't see variants shown here: `▣  Sisyphus - Ultraworker ·
> anthropic/claude-opus-5-5 · 9:16 PM · 45.5s` - are they not known, or not
> configured for tui to show to me here on desktop? whichever it is, fix it

## Goals

- Ship `footer_variant` onto current `dev-nowaker`, documented, and switch it
  on for desktop and m4max.

## Constraints and non-goals

- Upstream: first skipped (v1 maintenance-only), then requested again by
  the user with a v1-maintenance note at the very top of the PR body; a v2
  port is still owed.
- Host `tui.json` edits touch only `footer_variant`.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `tui-footer-variant` | `5e4b1d22f7` (local) | `021d0625ad` | rebase onto upstream `dev` `a697115b20`, amend with tui.mdx and without AI trailers; pushed to `nowaker-github` and `origin` |
| `opencode` | `tui-footer-variant` | `021d0625ad` | `b762567377` | amend: variant in `theme.textMuted` after user feedback; force-push with lease to `nowaker-github` and `origin` |
| `opencode` | `dev-nowaker` | `753d5580d4` | `bd9676d499` + this forklog commit | cherry-pick of `5e4b1d22f7` on `footer-variant-land` (config schema, config test and footer conflicts with fork keys and turn timing, kept both, variant placed before the turn time), rebased twice over concurrent landings, fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Show the turn's variant in assistant message footers](../features/2026-10-06-tui-footer-variant.md) | introduced | `bd9676d499`; tests; tmux captures |

## Other delivered work

- Upstream: issue #53846 and PR #53848 (PR verification on the branch:
  `bun typecheck` exit 0, `bun test` 194 pass; isolated captures
  `▣  Build · QA Model · 250ms` by default and
  `▣  Build · QA Model · high · 253ms` with `footer_variant`).
- Diagnosis: desktop assistant messages in `opencode.db` store
  `variant: "high"`, so the variant was known and only not rendered.
- Host config: `"footer_variant": true` in `~/.config/opencode/tui.json` on
  desktop and m4max, written by an atomic read-modify-write; a key-by-key
  comparison showed no other key changed. Readback on both:
  `{"footer_variant":true,"model_label":"id","turn_timing":{"time":true,"duration":true}}`.

- Dimmed variant: the `dev-nowaker` change is item 24's `efc7b3db27`
  (that session owns the footer list); this session changed only the
  upstream branch and built `efc7b3db27` on both hosts:
  `1.18.34-vt-170-907b3bc518`, desktop inode `49946741`, m4max inode
  `22203240`; retry patch matched on both; no other `build.sh` running;
  serve PIDs `2994070` / `2994178` unchanged. Upstream branch checks:
  `bun typecheck` exit 0, `bun test` 0 fail; ANSI captures in the feature
  timeline.

## Verification

- `bun typecheck` and `bun test --timeout 60000` in `packages/tui`: 341 pass,
  1 skip, 0 fail. See the feature record for the load-related editor test
  timeout at the default budget.
- Manual surface: see the feature record's Verification section.

## Build and install

- Build command: `~/projekty/webapps/opencode-build/build.sh` on desktop;
  `bun install --frozen-lockfile` and `nice -n 10 ./.vibeterm/build.sh` on
  m4max at `bd9676d499`. No other `build.sh` was running on either host.
- Installed artifact: desktop `1.18.34-vt-163-907b3bc518` (inode
  `49946735`), m4max `1.18.34-vt-163-907b3bc518` (inode `22192359`); both
  contain `footer_variant` and the retry-header marker.
- Retry-header cap: the dirty diff matched the canonical patch on both hosts
  before the build.
- Running services: none restarted; `opencode-serve-tailscale` PID `2994070`
  and `opencode-serve-lan` PID `2994178` unchanged across the build.

## Commit provenance

- `bd9676d499` - `footer_variant`.
- Required trailer: `AI-Session-ID: ses_eec44cf7effeFCqQefM0NkWLaW`

## Unknowns and blocked verification

- v2 port pending, by the user's decision.
- Not yet seen in a restarted real tab; running TUIs keep the old binary
  until restarted.
