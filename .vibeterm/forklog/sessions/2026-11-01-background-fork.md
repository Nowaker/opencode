# Background fork commands

## Identity

- Workday: 2026-11-01
- Session: `ses_e66b728b8ffeIxgqjkEHgEQEui` (spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`)
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` / `linux`
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `fork-background` (managed worktree `.vibeterm/worktrees/fork-background`)
- Upstream base: `dfb56f76c7` (`v1.19.0`)
- Source result commit(s): `892325cec5`
- Forklog commit: this file's introducing commit

## User requests

> /fork-in-background - same as /fork, but after it's confirmed, a small popup shows up that says now forking this session into newses_id, wait for confirmation when done, then another pop-up + an a message that is seen in the chat log for the user but not for the AI that fork is finished and this is the sesid.

The full request, with the three variants, is quoted in the [feature record](../features/2026-11-01-background-fork.md#original-request).

## Goals

- Three background-fork commands that work during an active turn, shaped on v2's fork concepts.

## Constraints and non-goals

- Build only through `.vibeterm/build.sh` with `VIBETERM_V2_GUARD`; preserve the uncommitted retry patch on both hosts.
- Push `dev-nowaker` to `origin` only. `nowaker-github` stays diverged pending `qst_165dd818d001UFatCmA3wlhlks`; it was not pushed.
- Do not restart other sessions or services.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `74a093fadf` | `892325cec5` | fast-forward from `fork-background` |
| `opencode` (m4max) | `dev-nowaker` | `cb5b97652f` | `892325cec5` | fast-forward from `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Fork a session in the background](../features/2026-11-01-background-fork.md) | introduced | tests and real run below |

## Verification

- `packages/opencode` `bun run test test/session/fork.test.ts test/session/fork-lineage.test.ts` - 9 pass. Settle, exclude, before-the-last-prompt, raw default and given-ID cases; lineage unchanged.
- `packages/opencode` `bun run test test/session/prompt.test.ts -t "background|reader-only notice"` - 2 pass. A fork during a live turn with a real running bash tool: the settled copy is idle with the interrupted tool, the excluded copy has only the prompt, and the source stays busy with its tool running. A notice after a finished turn makes no LLM call; with the `MessageV2.latest` change removed the same test fails (2 calls).
- `packages/tui` `bun run test test/prompt/draft-stash.test.ts` - 2 pass. Concurrent takes restore once; drafts are per session.
- `packages/opencode` `bun run test test/session/ test/server/` - 922 pass, 10 fail. The same 8 tests in instruction, compression, OpenAPI, experimental, init-git, SDK and reference also fail with this change stashed. Global-lifecycle and PTY pass on an isolated rerun.
- `packages/tui` `bun run test test/routes test/prompt test/component` - 293 pass, 0 fail.
- `bun typecheck` in `packages/opencode` and `packages/tui`, and repo-wide in the worktree - clean (30/30 tasks).
- SDK regen run twice; the second run is a no-op.
- Real run: the built binary in scratch XDG dirs, a throwaway tmux socket `forkbg` and a loopback mock OpenAI-compatible server whose first reply runs `sleep 600`. With that tool running, all three commands showed the confirmation, the toasts and the notices, and the turn kept running. The `Forking…` toast is visible for about one frame before the success toast replaces it. The database showed the settled copy (tool `error`, interrupted, "the command executed, its result is unknown"), the excluded copy and the empty before-prompt copy. The draft file appeared, a second TUI process opened that session with the prompt in its box, and the file was consumed. The settled fork opened idle. Ending the sleep let the source turn finish with the mock's tool-result answer, so the notices never reached the model.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard ./.vibeterm/build.sh` from the primary checkout on each host, guard gate 8/8 `ok` on both.
- Desktop: `1.19.0-vt-384-dfb56f76c7`, inode `49938569`, retry marker and `fork-in-background-from-` present. A first install from the worktree lacked the uncommitted retry patch and was rebuilt from the primary checkout two minutes later.
- m4max: `1.19.0-vt-384-dfb56f76c7`, inode `53255286`, both markers present.
- Running services: desktop `opencode-serve-tailscale` and `opencode-serve-lan` were inactive (MainPID 0) before and after; nothing was restarted.

## Commit provenance

- `892325cec5` - feature, tests, docs, SDK regen
- Required trailer: `AI-Session-ID: ses_e66b728b8ffeIxgqjkEHgEQEui`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-01-background-fork.md
```

## Unknowns and blocked verification

- The primary checkout's `bun typecheck` pre-push hook crashed (SIGSEGV, then turbo SIGBUS) on stale dependencies. `bun install --frozen-lockfile` reported no changes and created the missing package links. The feature push ran from the worktree, where the same hook passed.
- GitLab reports the project moved to `vibeterm/opencode`; the `origin` URL was left unchanged.
