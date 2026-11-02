# Deliver past a pending permission or question prompt

## Identity

- Workday: 2026-11-02
- Session: `ses_e62e4b66dffeHaCeeYFr3mvsZ8` (spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`)
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (`high`) / `linux`
- Repository: `~/projekty/webapps/opencode`; m4max `/Volumes/projects/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `deliver-past-permission` (managed worktree, cut from `dev-nowaker` `4aedf6e886`); opencode-tools `deliver-past-ask`
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `99c057215c`
- Forklog commit: this file's introducing commit

## User requests

> i noticed that when opencode native permission question is pending in tui, vtps/questions are prevented from being submitted. is it possible to make it work? if yes, make it happen

## Goals

- A Vibeterm delivery (`vibeterm_prompt_session`, scheduled prompt, wake, held job, async-question answer) reaches a session while opencode's native permission or question prompt is pending, without answering, dismissing or reordering it; the prompt stays on screen with its selection.

## Constraints and non-goals

- Do not auto-answer or dismiss native permissions or questions. Do not change what a person sees or can type: the native prompt still hides the composer.
- Keep every other `deliver()` refusal, and `unmounted` for a tab with no session prompt (a subagent, or still opening).
- No restarts of tabs, the Vibeterm tmux server or Meridian. Fork-only: upstream has no deliver API.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `deliver-past-permission` | `4aedf6e886` | `99c057215c` | commit |
| `opencode` | `dev-nowaker` | `4aedf6e886` | `99c057215c` | fast-forward; pushed to `origin` and `nowaker-github` |
| `opencode` (m4max) | `dev-nowaker` | `4aedf6e886` | `99c057215c` | fast-forward from `origin`; dirty retry cap still applies in reverse against the canonical patch |
| `opencode-tools` | `master` | `f12d899152d` | `2cd519acea5` | `deliver-past-ask` rebased and fast-forwarded; pushed; m4max pulled |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Send a turn past the composer from a TUI plugin](../features/2026-10-16-tui-prompt-deliver.md) | changed: delivers behind a permission or question prompt | tests below |

## Server semantics proven first

- `SessionPrompt.prompt` while the turn waits on `Permission.ask` or `Question.ask`: `admit` stores the user message and resolves admission at once, then joins the running loop through `SessionRunState.ensureRunning`. Nothing in `admit`, `Permission` or `Question` rejects or replies to a pending request on a new message. After the person answers, the same drain's next provider request carries the stored prompt and the turn answers it (assistant `parentID` = the delivered message).
- `packages/opencode/test/session/prompt.test.ts`: `a prompt sent while a permission is pending is stored, leaves the permission pending, and is answered after it` (bash `ask` rule) and the question-tool twin (`enableQuestionTool`).

## Verification

- `bun run test test/session/prompt.test.ts -t "while a (permission|question) is pending"` (packages/opencode) - 2 pass; whole file 93 pass, 1 skip, 0 fail.
- `bun run test test/prompt-control.test.ts test/routes/session/deliver-past-ask.test.tsx` (packages/tui) - 34 pass. With `held` unwired in `adapters.tsx`, both app tests fail with `reason: "unmounted"`.
- Whole TUI suite: 866 pass, 1 skip, 0 fail on the second run; the first run reported 1 fail whose name was not captured.
- `bun typecheck` in `packages/tui`, `packages/opencode`, `packages/plugin` - clean; the push hook's workspace typecheck passed on both pushes.
- Manual surface, real PTY: opencode-tools `modal-delivery.e2e.test.ts` permission scenario (isolated homes, throwaway tmux socket, loopback provider), driving `deliverPromptToSessionPane` (the `vt-prompt-session` path) at a tab whose bash permission prompt is showing. Scratch `1.19.5-vt-399-006d837c50-scratch`: `delivered; prompt-still-shown=true; turn-requests=1`, then Allow once and the turn's next model request carried the delivery. Installed `vt-397`: `held (the target shows no prompt ...)`.
- The dialog scenario in the same file fails on both `vt-397` and `vt-399` because a producer adds `profile_override:` to the delivered metadata block; all five dialog deliveries themselves succeeded. Pre-existing, left as an opencode-tools follow-up.

## Build and install

- Command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard bash .vibeterm/build.sh` from each primary checkout at `99c057215c` with the dirty retry cap (applies in reverse against `docs/opencode-patches/retry-header-delay-cap.patch` on both hosts). v1 database guard gate passed on both hosts (desktop 8 ok against `opencode-ai@1.19.5` and `@opencode/cli@2.2.5`).
- Desktop: `1.19.5-vt-399-006d837c50`, inode `49970241` (was `49970041`), SHA-256 `46e9e77e59e7d0fd3bec3a196a36b64471bbef7aee32f492aac46c6ba59729cf`, retry marker present.
- m4max: `1.19.5-vt-399-006d837c50`, inode `53817024` (was `53747724`), SHA-256 `786d6fd256a1d18df95ad0b244bfa8dd02ddf7ced7713bfbdf56dd0333094f79`, retry marker present. Its gate passed 8 ok against cached `opencode-ai@1.19.0` and `@opencode/cli@2.0.29`, as on earlier m4max builds.
- Desktop serve units before and after: tailscale MainPID `0`, start `Fri 2026-10-16 03:05:06 CDT`; LAN MainPID `0`. Nothing was restarted; running tabs keep their old binary until they restart.

## Commit provenance

- `99c057215c` - feature commit with full AI trailers.
- Required trailer: `AI-Session-ID: ses_e62e4b66dffeHaCeeYFr3mvsZ8`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-02-deliver-past-permission.md
```

## Unknowns and blocked verification

- The ssh alias `m4max` exits 255 without output from this desktop session; `m4max.ts.nowaker.net` works and was used.
