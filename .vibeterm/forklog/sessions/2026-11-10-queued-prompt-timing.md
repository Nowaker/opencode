# Choose when a running turn reads queued prompts

## Identity

- Workday: 2026-11-10
- Session: [`ses_e3b33afadffe7NYeYU6qMrEk6L`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b33afadffe7NYeYU6qMrEk6L)
- Agent/platform: `Sisyphus - ultraworker` (`anthropic/claude-opus-5-5`, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`, plus `~/projekty/nowaker/opencode-tools`
- Integration branch: `dev-nowaker`
- Development branch(es): `mid-turn-delivery` in both repositories
- Upstream base: `006d837c50` (`v1.19.5`, `github/v1`)
- Source result commit(s): `68e4a9e291`, merge `3233e3566e`; opencode-tools `2205df613b2`
- Forklog commit: this file's introducing commit

## User requests

From coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), quoting the user:

> normally the model responds with multiple tool calls, wants data back, but opencode won't inject user prompt in between? ... So basically it submits my queued prompt earlier? This is dope.

> And vtns also. Generally everything that prompts into the session, whether waking or non-waking.

After the finding below, the coordinator narrowed the build to: the off switch (default on, Vibeterm default through opencode-tools), the honest TUI ("read mid-turn" label, QUEUED only while unread), regression tests, docs, build and smoke on both hosts, and a live TUI + vtps + vtns check; no framing wrapper.

## Goals

- Pin, document and make switchable the reading of queued input at the next tool step; show it honestly in the TUI.

## Constraints and non-goals

- No new injector and no new plugin seam: the behaviour already existed, in upstream v1 too.
- Keep the uncommitted retry-header cap in both main checkouts.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `mid-turn-delivery` | `9911a26b09` | `68e4a9e291` | feature commit |
| `opencode` | `dev-nowaker` | `a2a519f4ca` | `3233e3566e` | `--no-ff` merge, pushed to `origin` and `nowaker-github` |
| `opencode-tools` | `master` | `82398eeb4d5` | `2205df613b2` | rebased feature, fast-forward, pushed; m4max pulled |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Choose when a running turn reads queued prompts](../features/2026-11-10-queued-prompt-timing.md) | added | 11 session tests (the `turn_end` hold tests fail on the old code), 6 TUI cases |

## Other delivered work

- Finding, sent to the coordinator first: every sender already stores a real user message at once (TUI admission `session.prompt`; Vibeterm's `deliverToSession` in `opencode-tools/_lib/vibeterm-orchestration/session-delivery.ts` -> control listener -> `prompt` / `promptAsync`, with `noReply` for vtns), and `runLoop` reads it before the next step. This session's own rows `msg_1c4ce201e`, `msg_1c4d795dc` and `msg_1c4e0218a` (two vtps, one OMO notice) each became the parent of the next step of a running `tool-calls` chain. Upstream `github/v1` has the same per-step reload, and its TUI also sends a prompt at once.
- What still holds input: while a permission or question is pending the TUI composer is hidden, so a typed prompt cannot be entered until it is answered (Vibeterm deliveries still arrive, `deliver-past-ask.test.tsx`); the stored prompt is read once the waiting tool ends. OMO's `ParentWakeFlushRunner` (`forks/oh-my-openagent`, `parent-wake-flush-runner.ts`) defers background notices while the parent is active, up to `PENDING_PARENT_WAKE_MAX_ACTIVE_DEFER_MS` (60 s) for reply-required ones; that is OMO-side and handed to [`ses_e3b66e073ffeBjngD0B2e6LCl8`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b66e073ffeBjngD0B2e6LCl8) with the API to use (`promptAsync` / `prompt({ noReply })`, stable `messageID`, always the parent's agent and model).
- opencode-tools `2205df613b2`: the spawn plugin's `config` hook sets `queued_prompts: "next_step"` unless the user set it; vtps's "it runs when that turn ends" and vtns's "you are reading it on your next turn" now say the turn reads it at its next tool step; the `queued without starting a turn` prefix the stuck detector matches is kept.

## Verification

- See the feature record. opencode-tools: `queued-prompts-config.test.ts` 2 pass, `prompt-plan.test.ts` and `shell-config.test.ts` pass; `notify-tool.test.ts` "writes a model-visible message ..." and `tool-ceilings.test.ts` "a dispatch cut off by its ceiling ..." fail with and without the change (load-sensitive).

- Isolated live check, installed vt-426: TUI on throwaway tmux socket `mtd-live`, scratch XDG dirs, `anthropic/claude-sonnet-5-5` through Meridian, project `/tmp/mtd-live-proj`, an 8-step `sleep 8; echo step N` bash chain. After step 3 a prompt typed in the TUI, a `POST /session/:id/prompt_async` (vtps's path) and a `POST /session/:id/message` with `noReply` (vtns's path) were stored; the next step's assistant message is parented to the last of them, answers all three ("2+3 is 5, a banana is a yellow fruit, and a clear daytime sky is blue.") and runs step 4; steps 5-8 follow in the same turn, which ends `CHAIN DONE` / `stop`. The TUI marked all three "read mid-turn".
- Real Vibeterm check, installed vt-426: spawned `ses_e3a8c18a4ffesdKu2DgHeLH0Xc` (OpenCode-Builder, sonnet-5-5, 10-step chain), then a real `vibeterm_prompt_session` and a real `vibeterm_notify_session` mid-chain. The note was read at the step-4 boundary ("Paris.", then step 4) and the prompt at the step-5 boundary ("42.", then step 5); the chain ended `CHAIN DONE` / `stop` in the same turn. The session was archived afterwards. vtps still printed the old "it runs when that turn ends": the calling tab loaded the spawn plugin before `2205df613b2`.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` from each main checkout at `3233e3566e`, with the uncommitted retry-header cap.
- Installed artifact: `1.19.5-vt-426-006d837c50` on desktop (inode 49955615 -> 49972325) and m4max (inode 56284619); v2 guard gate PASSED on both; `.vibeterm/smoke.sh <binary>` SMOKE OK on both; `queued_prompts`, `read mid-turn` and `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` present in both binaries.
- Running services: `opencode-serve-tailscale` and `opencode-serve-lan` were not running on desktop (MainPID 0) and were not touched.

## Commit provenance

- `68e4a9e291` - feature; `3233e3566e` - merge; opencode-tools `2205df613b2`.
- Required trailer: `AI-Session-ID: ses_e3b33afadffe7NYeYU6qMrEk6L`

## Unknowns and blocked verification

- The pre-push hook's monorepo typecheck ran past the tool timeout on a host at load 200+; the abandoned pushes left `turbo`/`tsgo` trees running, which this session killed (only its own, started 05:23-05:29). The detached push then passed 30/30 tasks on both remotes.
