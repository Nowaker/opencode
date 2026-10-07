# Draft recovery restores the caret

## Identity

- Workday: 2026-10-06
- Session: `ses_eec44ad14ffeownfvFKtEeqk4N`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `composer-caret` (worktree)
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `bba3ccfe3b`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 16 of its
"opencode TUI improvements" effort), quoting the user:

> recovery of drafts saved on sessions (is this opencode fork change, or vt
> plugin?) - also remember where the caret/block cursor is when in the prompt
> field, so when i'm typing a prompt and i'm HERE ^ content above, and content
> below me, the 'one off vtss' one - if i get interrupted, my prompt comes back
> to where i was exactly, and not at the end. default: on.

## Goals

- Say which layer saves and restores session drafts.
- A restored draft comes back with its caret, and selection, where it was.
  On by default.

## Constraints and non-goals

- Draft policy stays in `opencode-tools`; the fork only exposes the caret.
- No TUI tab, service or vibeterm tmux server restarted.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `composer-caret` | `509ea1eacd` | `bba3ccfe3b` | commit, rebased onto `dev-nowaker` `26e5c8481c` |
| `opencode` | `dev-nowaker` | `26e5c8481c` | `bba3ccfe3b` + this forklog commit | fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode-tools` | `master` | `30e51ce` | `ab87822` | `bc5d5b4`, `ab87822` from `draft-caret`, fast-forward; pushed |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Read and place the composer caret from a TUI plugin](../features/2026-10-06-tui-composer-caret.md) | introduced | `bba3ccfe3b`; tests; e2e |
| [TUI composer read and part-preserving replace](../features/2026-09-27-tui-composer-read.md) | extended, re-verified | `read()`/`replace()` gained `caret`; e2e drafts with a pasted part still survive `kill -9` and a dead tmux server |

## Other delivered work

- Answer to the user's question: OpenCode upstream keeps the composer only in
  memory (its module-level `stashed` carries text and cursor across a route
  change in one process). The fork adds only the plugin API. Saving and
  restoring are Vibeterm's: `opencode-vibeterm-route-plugin/draft-keeper.ts`
  writes `_lib/vibeterm-native-drafts`, and the session loader
  (`session-boot.ts`) plus the composer bridge hand the draft over on relaunch.
- `opencode-tools` `bc5d5b4`: the composer bridge never reached a staged
  OpenCode (an `env` prefix on the pane script covered only `t0=...`), so every
  loader handoff since `a6ddc25` silently typed. Found by this session's e2e.
- `opencode-tools` `ab87822`: keeper, loader and bridge carry the caret;
  `drafts.restoreCaret` setting.
- Answered item 19 (`ses_eebf9a83fffeIQQwW9gVFo5jaO`) which layer owns drafts
  and how its provisional prompt should hand the caret over.

## Verification

- packages/tui `bun test test/prompt-control.test.ts` - 23 pass; packages/opencode
  `bun test test/cli/tui/plugin-composer.test.ts` - 1 pass; `bun typecheck` in
  packages/tui, packages/plugin, packages/opencode - clean, on `bba3ccfe3b`.
- Before: `native-drafts.e2e.test.ts` with the caret assertion against the
  installed `1.18.34-vt-128-907b3bc518`: the marker typed after `kill -9`
  landed at the end (`...尾巴tailQ`).
- After: the same e2e passes against a build of `bba3ccfe3b` and against the
  installed `1.18.34-vt-139-907b3bc518`: the marker lands between the glyphs
  for a session tab and a sessionless tab, after `kill -9` and after the tmux
  server dies.
- Probe against the installed binary: `replace({ caret: { offset: 12 } })`
  through the composer bridge, then a typed `Q`, renders `尾Q巴tail`.

## Build and install

- Desktop: `.vibeterm/build.sh` at `bba3ccfe3b`; installed
  `1.18.34-vt-139-907b3bc518` (inode `49955668`), retry-header marker present.
- m4max: checkout fast-forwarded to `bba3ccfe3b`, `.vibeterm/build.sh`;
  installed `1.18.34-vt-139-907b3bc518` (inode `21731681`), retry-header marker
  present.
- Running services: none restarted; `opencode-serve-tailscale` PID `1507297`
  and `opencode-serve-lan` PID `1509289` unchanged across the desktop build.
  Running TUIs keep their old binary until restarted.

## Commit provenance

- `bba3ccfe3b` - composer caret API.
- Required trailer: `AI-Session-ID: ses_eec44ad14ffeownfvFKtEeqk4N`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-06-tui-composer-caret.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- The full `prompt-stage-*` / `session-boot-*` suites under load ~50 fail the
  same tests on `opencode-tools` master as on this branch; one extra failure
  (`prompt-stage-loader-interaction`) passed twice in isolation.
