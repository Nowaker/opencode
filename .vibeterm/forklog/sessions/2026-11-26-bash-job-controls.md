# W1 Bash job controls and cancellation receipts

## Identity

- Workday: 2026-11-26
- Session: [`ses_e08cea3acffelsBCKWqvjaq1Sm`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e08cea3acffelsBCKWqvjaq1Sm), OpenCode on desktop Linux.
- Repository and branches: OpenCode `bash-job-controls` targets `dev-nowaker`; the stack started at `cd420c160612`. Historical upstream base: `006d837c50` (`v1.19.5`, `github/v1`). Delivery-prep target: `2ce156782b555de6e25af6d33636817d5dbe0c1d`.
- OpenCode pre-rebase source commits: `a63327a7e6`, `c2d962c8d4`, `3c82ddfb06`, `9a08d09b2f`, `67e2d54c0f`, `a0e5c74cdf`. Rebased candidate: `044fe3df49`, `54388ae5e2`, `b0c13cf332`, `09b51e4ac9`, `684dfc381a`, and `564dd3cc30` (rebased `4207af349c` plus the authorized fixture-only fixup).
- Companion source: Vibeterm `feat/bash-job-notices` pre-rebase `16667eb9d7214edf44b3e8bb3f49db6fd82116d9`, then `826014d6a54` on `068eea3fce3`, then patch-identical `bdc8a874492b386c6921a9a5a3e467ff33178f40` on `2efb3a1165d`; OMO `bash-cancel-receipt`, owned by [`ses_e08ced6c7ffeV9zjW0cYE5Oqyh`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e08ced6c7ffeV9zjW0cYE5Oqyh).

## Requests, goals and constraints

> Build background Bash readiness and throttled line notices, and a human-operated Send to background control on the actual pending Bash block in the native OpenCode TUI.

> A user click when the action can actually be honored must detach the SAME already running foreground process and existing output/log/deadline into the background, return its background job ID and release the tool result so the model can proceed.

> Treat a genuinely winning running Bash cancellation under exact owner as authority before closing scope; preserve old endpoint callers/older-engine stop behavior, and ensure a natural exit racing marker does not lose completion.

Delivery prep was local and limited to W1. No integration, push, build wrapper, install, live tabs, restarts, or changes to Portal or the R3-owned OMO branch were authorized.

## Feature touched

- [Background Bash](../features/2026-11-10-bash-background.md): `ready` supports a bounded RE2 line match or a loopback TCP readiness check; `notify` batches matching lines on the existing output reader. The legacy TUI's click and keyboard palette action use its private worker and promote the same foreground job, preserving the PID, output path and deadline. No action is exposed through attach or Portal.
- An advertised `cancelToolReceipt: 1` enables an ordinary OMO stop to pass `toolResultForSessionID` on the existing POST. A winning running Bash stop for the exact session may publish `reportedBy: "background_cancel"`; the plugin deduplicates only that cancelled exit. Queued and final line matches still deliver. Natural outcomes and untagged stops still produce ordinary exit notices.

## Verification

- Earlier source PTY proof (before the cancellation follow-up): mouse and keyboard let the model continue while the same child PID and start token remained alive. Four width/theme cases passed under `.vibeterm/tmp/bash-job-qa/` in the OpenCode checkout. The shell and registry source tests had 52 passes on that earlier tree; that count does not cover the later cancellation fixtures.
- Compiled paired test accepted by the coordinator on 2026-11-26: old compiled `67e2d54c0f` with the candidate plugins sent one untagged request and admitted the first matching-line and regular exit notices. The winning candidate sent one tagged request, marked the exit, admitted first and final matching-line notices, and admitted no duplicate exit notice. Duplicate stop returned false; a foreign OMO actor sent no request; a wrong-owner endpoint request returned false and preserved the PID; natural exit 0 got its normal notice. No foreign session got a notice. Scope was inbox admission, not watcher replay or TUI. Receipt: `/home/nowaker/projekty/nowaker/opencode-tools/.vibeterm/tmp/w1-receipt.20261126.txt`.
- The three pre-edit cached digests matched the compiled receipt. Rebase conflicts were resolved as authorized: retain both Auto-switch and Bash worker RPC additions, and retain the integration todo entries before the Bash entry. Post-rebase: Core background jobs 4 pass; TUI Bash/output/Auto-switch 45 pass; Vibeterm Bash notice/commands/load 19 pass; OpenCode and TUI typechecks exit 0.
- Initial post-rebase OpenCode aggregate: 32 pass, 3 fail (positive `cancelViaRoute` cases). The exact pre-rebase archive and the rebased tree each independently gave 19 pass, 3 fail, 92 assertions for standalone shell-background. The test put jobs under isolated `testEffect` but called the default app with the shared layer memo map. The authorized two-line switch to `testEffectShared` fixes that topology without changing production or assertions. Standalone shell-background then passed 22/22, the aggregate passed 35/35, the separate native worker RPC test passed 2/2, and the OpenCode and TUI typechecks exited 0. The fixup was autosquashed into the cancellation commit. The non-test binary diff SHA-256 remained `1ec6999abbdaaa183b937d09601c15ab74be91224801ee52945f624c05445148`.
- Vibeterm's first root typecheck reported 4172 diagnostics with five missing dependency trees. After `bun install --frozen-lockfile` in all 17 tracked-lockfile directories within its worktree, `bun run typecheck` exited 0: `typecheck: 0 errors across 4 projects`. No lockfile changed. Cancellation-specific generated SDK bindings were not refreshed in this prep.

## Build, install and provenance

- Landed 2026-11-26 by the coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv) after review: OpenCode `dev-nowaker` `2ce156782b` -> `564dd3cc30` on both `origin` and `nowaker-github` (pre-push `bun turbo typecheck` 30/30); Vibeterm `master` `91ec054` (the three W1 commits rebased cleanly onto `c20f696`); OMO `dev-nowaker` `968c83dd38`, staged diff SHA-256 `8dcd2755662174f4242ec39d1f8edae024220c1b55b2b31cd9fdc911899c1b12`.
- Desktop build through `.vibeterm/build.sh` from the primary checkout: v2 migration guard gate PASSED, installed `1.19.5-vt-625-006d837c50`, previous binary archived as `opencode.prev-1795723153`. The desktop OMO checkout was rebuilt at `968c83dd38` and its regenerated tracked files restored. Tabs pick both up as they restart.
- Not installed on m4max in this record.
- Forklog commit: this file's introducing commit, with the required `AI-Session-ID` trailer.
