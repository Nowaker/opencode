# A 10-minute time limit for the built-in file tools

## Identity

- Workday: 2026-10-15 (started 04:24 on 2026-10-16, so the evening's workday)
- Session: `ses_ebbf8304effeyn1vwapV0HP1Bm`
- Agent/platform: `Sisyphus - ultraworker` (`anthropic/claude-opus-5-5`, high) / `linux`
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `fast-tool-limit` (fork), `tool-call-limit` (upstream PR #54503)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Source result commit(s): `fd28603b98` (fork), `49691d403e` (upstream PR branch)
- Forklog commit: this file's introducing commit

## User requests

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 40) from `ses_ebdb1dedaffes9LVs0tJW9I1a3`:

> make 10m timeout for these: read, write, edit, grep, glob. I don't see a reason why read or write be that long. Ever.

The coordinator's brief added: end a timed-out call as a tool error naming the tool and the limit, abort the underlying work where possible, make it configurable in opencode.json and document it, test it with a hung read, upstream it if possible, install on desktop and m4max, prove it on the installed binary, and tell the stuck-detector session `ses_ebbfae733ffeLG8kLtP6Xtv2IR` the end state.

## Goals

- `read`, `write`, `edit`, `grep` and `glob` calls end after 10 minutes as an `error` part, and the turn continues.
- The limit is configurable through the existing `tool_timeout` record.

## Constraints and non-goals

- No new setting: `tool_timeout.<tool>` already overrides any tool. Adding a second knob would duplicate it.
- A blocked `open(2)` on a FIFO cannot be cancelled. The call ends on time, and the worker thread stays blocked until a writer appears.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| fork | `dev-nowaker` | `92c1e70c34` | `fd28603b98` | ff-merge of `fast-tool-limit` |
| fork | `tool-call-limit` | `916886e976` | `49691d403e` | cherry-pick, AI trailers removed, pushed to `nowaker-github` and `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [End every tool call that runs past a time limit](../features/2026-10-11-tool-call-time-limit.md) | extended | 10-minute built-in default for the five file tools; tests and installed-binary proof below |

## Other delivered work

- PR #54503 body updated to describe the file-tool level and its test.
- Stuck detector session `ses_ebbfae733ffeLG8kLtP6Xtv2IR` told the end state and error text, so its `TOOL_BOUNDS` match.

## Verification

- `bun test test/tool/timeout.test.ts test/session/tools.test.ts test/tool/registry.test.ts test/tool/read.test.ts test/tool/write.test.ts test/tool/edit.test.ts test/tool/glob.test.ts test/tool/grep.test.ts` - 124 pass, 2 fail. The 2 failures (`tool.grep > finds matches in tmp instance`, `supports exact file paths`) fail the same way with the change stashed.
- `bun test test/session/prompt.test.ts -t "FIFO|limit|tool_timeout"` - 4 pass, including the new FIFO test.
- `bun typecheck` in `packages/opencode` and `packages/core` - clean, on `dev-nowaker` and on `tool-call-limit`.
- On `tool-call-limit`: `timeout`, `tools` and `registry` tests 35 pass; the prompt filter 4 pass.
- Installed binary on desktop and m4max, isolated `XDG_*`, `HOME`, `OPENCODE_TOOLS_DATA_DIR`, `OPENCODE_PLUGINS_DATA_DIR`, with a scripted OpenAI-compatible endpoint whose model calls `read` on a FIFO nothing writes to (`tmp/ai-40-proof/`, not committed):
  - desktop, `tool_timeout: {"read": 3000}`: `error` after 2996ms, `tool call exceeded its 3s limit (config: tool_timeout.read)`, the next model request carries it, final text arrives, exit 0.
  - desktop, `tool_timeout: {"default": 3000}`: `error` after 3009ms, `(config: tool_timeout.default)`, turn finished, exit 0.
  - m4max, `tool_timeout: {"default": 3000}`: `error` after 3004ms, same message, turn finished, exit 0.
  - desktop, no `tool_timeout`: `error` after 600004ms, `tool call exceeded its 10m limit (built-in default for read, set tool_timeout.read to change it)`, the next model request carries it, final text arrives, exit 0, wall 612.6s.

## Build and install

- Build command: `VIBETERM_V2_GUARD=~/projekty/nowaker/opencode-tools/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` from the primary checkout on both hosts. m4max's checkout was fast-forwarded to `fd28603b98` and built there.
- Installed artifact: `1.19.0-vt-310-dfb56f76c7` on both hosts, v2 migration guard gate PASSED on both. Desktop inode 49954724, m4max inode 41536424.
- Running services: not restarted.

## Commit provenance

- `fd28603b98` - the feature on `dev-nowaker`
- `49691d403e` - the same change on `tool-call-limit` (PR #54503), without AI trailers
- Required trailer: `AI-Session-ID: ses_ebbf8304effeyn1vwapV0HP1Bm`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-15-file-tool-limit.md
```

## Historical evidence carried forward

- The case that prompted it: in `ses_ef5d69470ffe`, a `write` call started 2026-10-10 07:31Z never ended, and the turn never completed. Before this change, only the 30-minute general limit would have ended it.

## Unknowns and blocked verification

- None
