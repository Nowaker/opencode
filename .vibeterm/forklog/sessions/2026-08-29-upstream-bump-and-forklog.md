# 2026-08-29 - OpenCode upstream bump and forklog redesign

## Identity

- Workday: 2026-08-29
- Session: `ses_166c2c2b5ffe5Fr8aJwwuDgWT3`
- Agent/platform: OpenCode through Vibeterm / Linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Related tooling: `/home/nowaker/projekty/nowaker/opencode-tools`
- Integration branch: `master-nowaker`
- Development branch(es): direct integration on `master-nowaker`;
  `docs/forklog-v2` for the related tooling rules
- Prior upstream base: `4643e65ad6` (`v1.18.18`)
- Upstream base: `10765ff2a` (`v1.18.25`)
- Source result commit(s): `0a12138e8`, `ca4200381`
- Initial forklog commit: `1cd177501`
- Forklog commit: resolve this file's introducing commit through its
  `AI-Session-ID` trailer

## User requests

> our usual drill:
> - bump upstream opencode and re-integrate like previously.
>   master-nowaker can be pushed.
> - bump omo & compare omo defaults with our overrides. report back on changes
>   in model fallbacks especially in your final message.
> - don't touch meridian, we're running our branch as the main meridian

> let's create a file ./.vibeterm/forklog/YYYY-MM-DD-short-title.md on
> main-nowaker [in opencode repo] (only there, not individual branches) that
> tracks all our our changes to opencode. branch name, short title, explanation
> of goals, then list of:
> - YYYY-MM-DD ses_1234 super brief goal of session that touched it (examples:
> initial build, and subsequent would be: rebase after bump, and most
> sophisticated ones: changed logic due to RETRY_MAX_RETRIES, etc)
>
> this file gets written directly to main nowaker. one commit per session's
> changes per day (past midnight is still the same day, i often work 10p-4am).
> commits for this file not squashed, but always rebased on top of opencode
> master head commit.
>
> put opencode fork specific rules in opencodedforkirectory/AGENTS.local.md,
> uncommitted.
>
> search git history and opencode sqlite history for sessions that did
> modifications on opencode source. most were performed out of this project
> (nowaker/opencode-tools), some may have been on forks/opencode or
> forks/opencode-build but probably few. and a few from webapps/portal. your
> goal is to recreate the forklog.
>
> one of my projects, don't remember which one, had laid out a very super
> structure for AI_TODO.md or AI_TODO directory of man md files, something like
> that, which had user's initial prompt, goals, etc. let's incorporate that
> format into our thing + improve. create, in opencode repo,
> ./.vibeterm/forklog/_template.md that outlines everything.

> hm... i had this idea to always have a fresh forklog per session even if it's
> not needed - the goal is:
>
> - what did we do to which branch. so a rebase against the latest opencode
>   goes into that "rebased against 4234234a - upstream v1.18.24"
> - multiple sessions may touch the same feature, so we may see 2-3 or more
>   entries in a single file (probable)
> - multiple sessions may touch multiple features, so each may have 2-3 or more
>   entries in these multiple files (rare)
>
> or maybe you have a better idea? think hard

## Goals

- Integrate upstream `v1.18.25` without dropping any local behavior.
- Rebuild and install the source fork through the canonical host script.
- Upgrade OMO and report every effective fallback change.
- Reconstruct the fork history and then split it into linked feature and
  session views.
- Make a commit's originating coding-agent session durable in Git trailers.

## Constraints and non-goals

- Meridian was neither inspected nor changed.
- Protected OpenCode services were not restarted.
- The retry-header cap remained a deliberate uncommitted two-file source diff.
- Google stayed disabled; no Gemini assignment was accepted.
- Upstream integration is branch history, not a durable feature.
- Historical confidence labels and failed searches remain explicit. No
  retroactive session files were invented.
- One unsquashed forklog commit represents this session and workday.
- The stale public mirror `nowaker-github/master-nowaker` was not pushed.
- A conflict-free merge does not prove that every stable local seam still
  behaves correctly, so the bump required a semantic custom-diff audit.
- Generated SDK output was regenerated from merged schemas rather than
  conflict-resolved by hand.
- The retry-header patch was reversed before the merge and reapplied afterward.
- The forklog remains the custom-seam inventory before every upstream merge.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| OpenCode | `master-nowaker` | `4a2673957` | `0a12138e8` | Merge `10765ff2a` (`v1.18.25`) |
| OpenCode | `master-nowaker` | `0a12138e8` | `ca4200381` | Join patch-equivalent remote ancestry |
| OpenCode | `master-nowaker` | `ca4200381` | `1cd177501` | Add the initial reconstructed forklog |
| opencode-tools | `master` | `d8f157649` | `7ce5f22bf` | Publish bump rules, patch refresh, and session provenance |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Global memory diagnostics](../features/2026-05-13-global-memory-diagnostics.md) | preserved | Global HTTP API gate passes |
| [Message shape normalization](../features/2026-05-23-message-shape-normalization.md) | preserved | Message, pagination, and compaction tests pass |
| [Interrupted assistant tail](../features/2026-05-29-interrupted-assistant-tail.md) | preserved | `prompt.test.ts` passes |
| [Sync hot path](../features/2026-05-29-sync-hot-path.md) | preserved | Sync and compression tests pass |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | preserved | Provider tests pass |
| [Compaction tracing](../features/2026-06-16-compaction-decision-tracing.md) | preserved | Prompt and compaction tests pass |
| [Global bus typing](../features/2026-07-21-global-bus-typing.md) | preserved | `packages/opencode` typecheck passes |
| [Retry-header cap](../features/2026-08-06-retry-header-delay-cap.md) | rebased | Tests and bytewise patch comparison pass |
| [Native tool commands](../features/2026-08-08-native-tool-commands.md) | preserved | Command tests, SDK generation, and typecheck pass |
| [TUI stream throttle](../features/2026-08-25-tui-stream-throttle.md) | preserved | 5 targeted tests and TUI typecheck pass |

## Other delivered work

- OMO was upgraded to `4.19.4` through the PATH-level npm installation.
- Effective OMO fallbacks changed to:
  - Sisyphus: Opus 5, `max`.
  - Hephaestus: GPT-5.6 Sol, `max`.
  - Oracle: GPT-5.6 Sol, `xhigh`.
  - Librarian and Explore: GPT-5.6 Luna Fast, `low`.
  - Multimodal Looker: GPT-5.6 Sol, `low`.
  - Prometheus: Fable 5, `high`.
  - Metis: Opus 5, `high`.
  - Atlas and Sisyphus Junior: Sonnet 5.
  - Visual Engineering: Opus 5, `max`.
  - Deep: GPT-5.6 Sol, `medium`.
  - Artistry: Fable 5, `high`.
- Local category overrides retained Haiku 4.5 for `quick` and Opus 5 for
  `unspecified-high` and `writing`.
- `disabled_providers: ["google"]` remained effective, with no Gemini model.
- opencode-tools published `cdc0373`, `029ae27`, `1f16a2b`, `ed5713b`, and
  `7ce5f22` for the recurring drill, corrected retry semantics, canonical patch,
  and session-provenance convention.

## Verification

- Semantic OpenCode gate: 388 pass / 3 skip / 0 fail.
- `packages/opencode` and `packages/tui` typechecks exit 0.
- JavaScript SDK and client generators leave no second-run diff.
- The dirty retry diff matches the canonical patch byte for byte and the patch
  reverse-applies cleanly.
- Installed binary contains one `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` marker.
- PTY QA observed `--version`, `--help`, and a bad flag exiting 1.
- `omo-agents-ls.ts --override --no-refresh --no-color` reports zero findings
  and no Google or Gemini assignment.

## Build and install

- Build command: `~/projekty/webapps/opencode-build/build.sh`.
- Installed artifact:
  `~/projekty/webapps/opencode-build/bin/opencode`, version `1.18.26`, inode
  `49950833`.
- Protected service PIDs remained `294094` and `293902`, both with unchanged
  start timestamps.

## Commit provenance

- `0a12138e8` - merge upstream `v1.18.25`.
- `ca4200381` - reconcile patch-equivalent remote fork history.
- `1cd177501` - reconstruct local customization history.
- `1f16a2b66` - refresh the canonical retry patch for `v1.18.25`.
- `ed5713bb7` - require coding-session trailers in opencode-tools.
- `7ce5f22bf` - record the accepted feature/session provenance design.
- This record's commit carries
  `AI-Session-ID: ses_166c2c2b5ffe5Fr8aJwwuDgWT3`.

## Historical evidence carried forward

| Commit | Workday | Change | Session evidence |
|---|---|---|---|
| `0ac3fad6f` | 2026-07-28 | Merge `github/dev` | No verified session found |
| `421923926` | 2026-08-04 | Merge upstream `v1.18.13` | No verified session found |
| `8617f1049` | 2026-08-11 | Merge upstream `v1.18.16` | No verified session found |
| `9d78ca8c6` | 2026-08-15 | Merge upstream `v1.18.18` | No verified session found |
| `0a12138e8` | 2026-08-29 | Merge upstream `v1.18.25` | This session |
| `ca4200381` | 2026-08-29 | Join equivalent remote history | This session |

- The 2026-07-28 search covered the exact hash, subject, date window, likely
  workdir, and subagents across every indexed local agent platform.
- The 2026-08-04 search repeated that broad search and found no transcript.
- The 2026-08-11 and 2026-08-15 searches added exact version and merge terms;
  neither found a direct transcript.
- The 2026-08-29 session mapping has high confidence from current-session
  continuity, merge `0a12138e8`, and the original bump request.
- Remote `master-nowaker` can contain patch-equivalent local commits under
  different hashes. Future reconciliation must prove stable patch-ID
  equivalence before any lease-protected history update.

## Unknowns and blocked verification

- The four earlier upstream merges have no verified local coding-agent session.
- Provider-dependent checks remain blocked until exposed provider credentials
  are rotated or their risk is explicitly accepted; none was needed here.
- Markdown LSP was unavailable because the local LSP daemon socket did not
  become reachable. Link, structure, whitespace, and Git checks replace it for
  this documentation-only change.
