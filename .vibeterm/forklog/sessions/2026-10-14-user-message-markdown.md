# Markdown in user messages and [vibeterm_*] blocks as YAML

## Identity

- Workday: 2026-10-14
- Session: `ses_ec57be11affe3kxXJ4WyM3OwOY`
- Agent/platform: Sisyphus (anthropic/claude-opus-5-5, high) / linux
- Repository: `~/projekty/webapps/opencode`; opencode-tools
- Integration branch: `dev-nowaker`
- Development branch(es): `message-syntax`; upstream `message-markdown`,
  `message-blocks`
- Upstream base: `dfb56f76c7` (`v1.19.0`)
- Source result commit(s): `5e5994b93a`, `748601cc2b`
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 37); the
verbatim request is in the
[feature record](../features/2026-10-14-user-message-markdown.md#original-request).
The coordinator added: knob default off as upstream, the user's value only
through Vibeterm settings, prefer extending the TUI plugin API over hardcoding
Vibeterm, a real-terminal check, both-host install, upstream PRs against v1.

## Goals

- Color the markdown in submitted user messages without changing their text or
  wrap.
- Let a plugin or config format a delimited block; draw `[vibeterm_*]` as YAML.

## Constraints and non-goals

- Never red in the transcript; no change to assistant text.
- No restart of `opencode-serve-tailscale`, `opencode-serve-lan` or any tab.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode | `dev-nowaker` | `b0ebca176f` | `748601cc2b` | fast-forward of `message-syntax`, pushed to `origin` and `nowaker-github` |
| opencode | `message-markdown` | - | `9de106cb26` | new, on `tool-output-syntax` (#54968), PR #55441 |
| opencode | `message-blocks` | - | `2c659ccfe6` | new, on `message-markdown`, PR #55442 |
| opencode-tools | `master` | `7e47b93` | `0497c41` | route plugin registers the `[vibeterm_*]` rule |

`ses_ec549ca11ffeaEknagLhxmfpFp` rebased its unpushed forklog commit
`340c1ca1d8` onto `748601cc2b` as `181722b19d` after a queued note from this
session; nothing of theirs was touched here.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Markdown in user messages and message blocks](../features/2026-10-14-user-message-markdown.md) | new | below |
| [Syntax coloring in tool calls](../features/2026-10-11-tool-syntax-coloring.md) | changed | `toolCodeTheme` gains markdown slots; `GenericTool` reads `toolInputColors`; `tool-code-theme.test.ts` covers the new slots |

## Other delivered work

- opencode-tools `0497c41`: `registerMessageBlocks` in
  `opencode-vibeterm-route-plugin`, test, FEATURES.md.
- `opencodeTui.syntax.user_messages` enforced `true` through `writeSetting` on
  desktop and m4max, after opencode-tools `a42e4c6`
  (`ses_ed1e2b932ffe6tTqhsOiGuYXRE`) gave the knob a Focus decision; the first
  attempt wrote tui.json but failed on `opencodeTui.enforced`.

## Verification

- packages/tui on `message-syntax` rebased on `b0ebca176f`: typecheck clean;
  full suite 681 pass, 0 fail. packages/plugin and packages/opencode typecheck
  clean; push hook 30/30 typecheck tasks.
- Upstream `message-blocks`: tui, plugin and opencode typecheck clean; tui
  suite 247 pass, 0 fail.
- Real PTY, scratch build `1.19.0-vt-289`, isolated XDG home, fake provider,
  throwaway `ocrig-*` tmux sockets, 80 and 160 columns, three variants (off;
  `syntax.blocks` in tui.json; the rule from the route plugin): the message's
  screen text is identical in all three; headings, list markers, inline code
  and table headers colored; YAML keys peach, strings green, numbers orange,
  booleans purple, delimiter lines grey; `done`/`---` plain; no red cell.
- A first PTY attempt deadlocked: `Bun.spawnSync` of `opencode run` blocked the
  in-process fake provider. A second seeded the message with `opencode run`'s
  argument quoting (`"[vibeterm_metadata]`, `run.ts:289`), correctly unmatched;
  the final run seeds through stdin.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`
  in each host's primary checkout at `181722b19d`
- Installed artifact: `1.19.0-vt-292-dfb56f76c7`; desktop inode `49964691`,
  m4max inode `34213364`; v2 guard gate PASSED on both; retry marker present on
  both.
- Running services: desktop `opencode-serve-tailscale` PID `914944` (started
  04:38:28 CDT) and `opencode-serve-lan` PID `910216` unchanged; no tab
  restarted, so running tabs pick this up on their next start.

## Commit provenance

- `5e5994b93a`, `748601cc2b` - source.
- Required trailer: `AI-Session-ID: ses_ec57be11affe3kxXJ4WyM3OwOY`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-14-user-message-markdown.md
```

## Unknowns and blocked verification

- No v1/v2 patch-rig scenario added; not in the matrix.
- The instant-editor test timed out once at load average ~80 on both this
  branch and the untouched base; it passed in the later full run.
