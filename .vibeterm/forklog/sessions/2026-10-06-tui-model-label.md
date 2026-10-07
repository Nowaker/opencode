# Provider and model id in message footers

## Identity

- Workday: 2026-10-06
- Session: `ses_eec44cf7effeFCqQefM0NkWLaW`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-model-id` (`8c2d0bde91`, on upstream `dev` `ecc4916b5a`); landing branch `model-id-land`
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `66ce641060` (cherry-pick of `8c2d0bde91`)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (items 14 and 15 of
its "opencode TUI improvements" effort), quoting the user:

> 14: ability to show reasoning; tui knob, default off, here: on
>
> 15: show anthropic/opus-5.5 (whatever the internal name is) instead of nice
> label, so user can actually see the provider used. i have openai/,
> openai-meridian/ and openai2/ for example. default: off, here: on.

## Goals

- Item 15: a `tui.json` setting that shows `providerID/modelID` in message
  footers and the prompt model indicator; off by default, on for both hosts.
- Item 14: see Unknowns.

## Constraints and non-goals

- Host `tui.json` edits touch only `model_label`; `kv.json` not edited.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `tui-model-id` | - | `8c2d0bde91` | new branch on upstream `dev` `ecc4916b5a`; pushed to `nowaker-github` and `origin` |
| `opencode` | `dev-nowaker` | `509ea1eacd` | `66ce641060` + this forklog commit | cherry-pick on `model-id-land` (config schema and config test conflicts with fork keys, kept both), fast-forward; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Show the provider and model id in message footers](../features/2026-10-06-tui-model-label.md) | introduced | `66ce641060`; tests; tmux captures |

## Other delivered work

- Upstream: issue #53638 and PR #53639.
- Host config: `"model_label": "id"` in `~/.config/opencode/tui.json` on
  desktop and m4max, written by an atomic read-modify-write; a key-by-key
  comparison showed no other key changed, and both files parse.
- Pre-push hook: the full-repo `bun typecheck` fails in `packages/opencode`
  (`bus/global.ts` TS2416) on any upstream-`dev` branch on desktop, because
  TypeScript resolves `@types/node` from the ambient `~/node_modules`
  (25.9.2, updated 2026-10-04 21:43), not the repository. Pushes ran the real
  hook inside `bwrap --bind / / --tmpfs ~/node_modules`, where it passes
  30/30; no hook was skipped.

## Verification

- `bun typecheck` and `bun test` in `packages/tui` on `model-id-land`:
  277 pass, 1 skip, 0 fail.
- Manual surface: see the feature record's Verification section.

## Build and install

- Build command: `~/projekty/webapps/opencode-build/build.sh` on desktop;
  `.vibeterm/build.sh` on m4max after fast-forwarding its checkout to
  `66ce641060`.
- Installed artifact: desktop `1.18.34-vt-128-907b3bc518` (inode
  `49963232`), m4max `1.18.34-vt-128-907b3bc518` (inode `21720710`); both
  contain `model_label` and the retry-header marker.
- Retry-header cap: the dirty diff matched the canonical patch on both hosts
  before the build.
- Running services: none restarted; `opencode-serve-tailscale` PID `1507297`
  and `opencode-serve-lan` PID `1509289` unchanged across the build.

## Commit provenance

- `66ce641060` - `model_label`.
- Required trailer: `AI-Session-ID: ses_eec44cf7effeFCqQefM0NkWLaW`

## Unknowns and blocked verification

- Item 14 is not built yet. Vanilla already has `/thinking` (kv
  `thinking_mode`, `show`/`hide`), and `kv.json` on desktop and m4max already
  holds `thinking_mode: "show"`, so a `tui.json` default for it would change
  nothing on either host. The user was asked whether they meant the
  reasoning effort (variant) in message footers instead, which upstream issue
  #40412 asked for and was closed as stale.
- No real-terminal screenshots yet; the PR has a slot for them.
