# Send a turn past the composer from a TUI plugin

## Identity

- Workday: 2026-10-16
- Session: `ses_ed24b7cfbffe5YyKo7piBEsLF6`
- Parent: `ses_ef8235798ffejGr4sa22eXmVNv` in opencode-tools
- Agent/platform: Sisyphus / `anthropic/claude-opus-5-5`, high / linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): managed `prompt-deliver`
- Upstream base: `dfb56f76c7` (`github/v1`, `v1.19.0`)
- Source result commit(s): `c1645d7aef`
- Forklog commit: this file's introducing commit

## User requests

Coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> best - without even closing those modals, those actions on the prompt field
> should happen in background, without prompt field focus.

## Goals

- Vibeterm deliveries (`vibeterm_prompt_session`, notify wake, scheduled
  prompts, async-question answers) reach a session while a dialog is open over
  its composer, without closing the dialog, typing into it, or touching the
  draft.

## Constraints and non-goals

- Where the composer itself could not submit (permission or question pending,
  sealed, syncing), the delivery is held, never typed.
- The opencode-tools side (bridge `/deliver`, ID-exact acknowledgement,
  fallback to the typed path for older builds) lives in opencode-tools.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode | `dev-nowaker` | `452d770a36` | `c1645d7aef` + this forklog commit | fast-forward |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Send a turn past the composer from a TUI plugin](../features/2026-10-16-tui-prompt-deliver.md) | introduced | `c1645d7aef` |
| [Keep a failed prompt instead of losing it, without sending it twice](../features/2026-10-07-tui-prompt-admission.md) | extended: `Admission.delivery` entries are dropped, not given back | `test/prompt/admission.test.ts` |

## Verification

- `bun test test/prompt-control.test.ts test/prompt/admission.test.ts test/prompt-seal.test.ts` (packages/tui) - 53 pass, after the rebase onto `452d770a36`.
- `bun typecheck` (whole monorepo, the pre-push hook) - clean.
- opencode-tools `MODAL_DELIVERY_TEST_OPENCODE=<build> bun test _lib/vibeterm-tmux/modal-delivery.e2e.test.ts`:
  - installed vt-321: palette, agent list, model list, paste editor all held
    ("a dialog is open over the target's composer"); tmux popup delivered;
    permission prompt held.
  - build of this branch: all five delivered as one turn each, dialog still
    open with its filter, draft unchanged; permission prompt held, not answered.
- opencode-tools `unsent-paste.e2e.test.ts` against the build of this branch - 3 pass.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh`
- Installed artifact: `1.19.0-vt-332-dfb56f76c7` on desktop (`~/projekty/webapps/opencode-build/bin/opencode`) and m4max (`/Volumes/projects/webapps/opencode-build/bin/opencode`); v2 guard gate passed on both.
- Real surface: opencode-tools `modal-delivery.e2e.test.ts` (2 pass) and `unsent-paste.e2e.test.ts` (3 pass) against the installed desktop binary.

## Commit provenance

- `c1645d7aef` - `api.prompt.deliver`.
- Required trailer: `AI-Session-ID: ses_ed24b7cfbffe5YyKo7piBEsLF6`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-16-tui-prompt-deliver.md
```

## Unknowns and blocked verification

- No upstream PR: the route only matters with the fork's composer bridge (`api.prompt` is fork-only).

## Scheduled profile persistence follow-up

- Session `ses_eac9def85ffeQUlw8vmM8s7aoY`, branch `preserve-hook-profile`: an isolated installed-binary observation found session profile persistence already completed at hook entry, before a delivery ticket rewrote the user row. Control preserved `plan/fixture/chosen/xhigh`; the picker-based fallback produced that same user row but left the session on `build/fixture/fixture/default`.
- The engine saves the final post-hook profile immediately before saving its user message, through the existing session writer. The regression fails on the unmodified source with stored agent `build`, then passes after the move. The full prompt suite passed 88 tests with one existing skip; the affected package typecheck passed.
- An isolated canonical `1.19.0-vt-361-dfb56f76c7` build passed the v2 guard against cached `opencode-ai@1.19.0` and `@opencode/cli@2.0.29`; disk reserve blocked newer fixture downloads. Nine real-TUI schedule scenarios passed 54 assertions for user-row identity, persisted session identity and the responding agent/model. The final cross-repository gate approved with high confidence and no blockers.
- Source fix `3602b31360` was fast-forwarded locally onto `dev-nowaker`; the related opencode-tools fix is `881f7d94`. Attribution correction: the implementation commit used checkout label `Vibeterm c3ca426b` in `AI-Harness`, but this session's declared client is `Vibeterm 881f7d94`. Existing history is retained.
