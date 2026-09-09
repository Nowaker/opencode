# 2026-09-08 - upstream dev integration and read-only OMO refresh

## Identity

- Workday: 2026-09-08
- Session: `ses_fb9a784deffe7zkW0r8oo25Nkg`
- Agent/platform: OpenCode through Vibeterm, `anthropic/claude-opus-5` / macOS
- Repository: `/Volumes/projects/webapps/opencode`
- Related tooling: `/Volumes/projects/nowaker/opencode-tools`
- Integration branch: `master-nowaker`
- Development branch(es): direct integration work
- Prior upstream base: `16747470f` (`v1.18.29`)
- Upstream base: `5cd8e68fd` (upstream `dev`, post-`v1.18.29`)
- Source result commit: `2e900eb2b`
- Forklog commit: resolve this file's introducing commit through its
  `AI-Session-ID` trailer

## User requests

> bump & re-integrate opencode, show pre-omo-bump agent fallbacks here, bump
> omo, show post-omo-bump agent fallbacks here - don't fix.

> does the new version of opencode support gpt 5 astra?

## Goals

- Integrate the newest upstream OpenCode without losing local behavior.
- Reapply and verify the canonical retry-header delay cap.
- Install the native arm64 build used by new Vibeterm tabs.
- Report OMO agent and category assignments before and after an OMO reinstall.
- Answer whether the refreshed build supports "GPT-5 Astra".

## Constraints and non-goals

- Report OMO read-only. No `--override`, no policy migration, and no repair of
  reported findings; the user asked explicitly not to fix.
- Keep the retry-header cap as the canonical uncommitted two-file divergence.
- Do not restart a protected OpenCode serve process.
- Do not restart other Vibeterm tabs or inspect Meridian.
- Use one unsquashed forklog commit for this session and user workday.

## Upstream selection

Upstream published no release tag after `v1.18.29`; the newest GitHub release
remains `v1.18.29` from 2026-09-04. The `dev` branch advanced 29 commits in
the four days since, so this session integrates the `dev` head `5cd8e68fd`
rather than re-integrating a tag already present on `master-nowaker`. That
follows the existing precedent set by `0ac3fad6f` (2026-07-28).

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| OpenCode | `master-nowaker` | `c0f97ee25` | `2e900eb2b` | Merge upstream `dev` head `5cd8e68fd` after reversing the retry patch |
| OpenCode origin | `master-nowaker` | `c0f97ee25` | this record's commit | Publish the verified merge and forklog |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Global memory diagnostics](../features/2026-05-13-global-memory-diagnostics.md) | preserved | `packages/opencode` typecheck exits 0 |
| [Message shape normalization](../features/2026-05-23-message-shape-normalization.md) | preserved | 45 command and message-shape tests pass |
| [Interrupted assistant tail](../features/2026-05-29-interrupted-assistant-tail.md) | preserved | 66 session prompt and system tests pass |
| [Sync hot path](../features/2026-05-29-sync-hot-path.md) | preserved | `packages/opencode` typecheck exits 0 |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | preserved | 688 focused provider, transform, retry, and Codex tests pass |
| [Compaction tracing](../features/2026-06-16-compaction-decision-tracing.md) | preserved | `packages/opencode` typecheck exits 0 |
| [Global bus typing](../features/2026-07-21-global-bus-typing.md) | preserved | `packages/opencode` typecheck exits 0 |
| [Retry-header cap](../features/2026-08-06-retry-header-delay-cap.md) | reapplied | Focused tests, bytewise comparison, and binary marker pass |
| [Native tool commands](../features/2026-08-08-native-tool-commands.md) | preserved | 45 command and message-shape tests plus typecheck pass |
| [TUI stream throttle](../features/2026-08-25-tui-stream-throttle.md) | preserved | Full TUI suite and typecheck pass |
| [Prompt input latency](../features/2026-08-31-prompt-input-latency.md) | preserved | Full TUI suite and typecheck pass |

## Upstream changes of note

- `5cd8e68fd` adds `session/prompt/gpt-astra.txt` and routes it from
  `session/system.ts`. The gate is `model.api.id.includes("gpt-6")`, so the
  Astra prompt selects on GPT-6 identifiers. A `gpt-5*` identifier keeps the
  existing GPT or Codex prompt.
- `ac1758c0e` narrows the Bedrock cross-region prefix list to `deepseek.r1` and
  passes `arn:` model ids through unchanged.
- `ea2d59d7c` preserves explicit OpenAI service tiers; `23ec4f55c` and
  `bec9ee41a` bump the OpenAI and Azure SDKs; `7c2199d84` adds GitLab reasoning
  variants.

## OpenCode verification

- Focused provider, transform, retry, and Codex gate: 688 pass / 0 fail.
- Session system and prompt gate covering the Astra seam: 65 pass / 1 skip /
  0 fail.
- Native command and message-shape gate: 45 pass / 0 fail.
- Full `packages/tui` suite: 196 pass / 1 skip / 0 fail across 46 files.
- `packages/opencode` and `packages/tui` typechecks exit 0.
- The reapplied source diff equals both canonical patch copies byte for byte.
- `bun install` rewrote `bun.lock` as 36 pure deletions under local Bun 1.4.0
  against the repository's pinned `bun@1.3.14`. The lockfile was restored so the
  working tree carries only the canonical two-file divergence.

## Build and install

- Build command: `/Volumes/projects/webapps/opencode-build/build.sh`.
- Artifact: `/Volumes/projects/webapps/opencode-build/bin/opencode`, version
  `1.18.30`, arm64, device/inode `16777235:15340297`, size `148914290`.
- The version string collides with the previous build. `packages/opencode`
  still declares `1.18.29` on `dev`, and HEAD is a merge rather than an exact
  tag, so the wrapper's increment rule produces `1.18.30` for the second time.
  The predecessor is archived at `bin/opencode.prev-1788923823`, also reporting
  `1.18.30`; the builds are distinguishable only by content and inode.
- Content proof: the new binary contains 2 occurrences of the Astra prompt
  string `commentary channel`; the archived predecessor contains 0.
- The installed binary contains one `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` marker.
- Installed CLI QA: `--version` reports `1.18.30`, `--help` renders, and
  `attach` without its required URL exits 1.
- No protected headless `opencode serve` process was present or restarted.

## OMO outcome

- Registry `latest` and the installed package are both `4.19.4`, so
  `npm install -g oh-my-openagent@latest` under `/Users/nowaker/.npm-global`
  changed 229 dependency packages but no OMO version.
- `omo-agents-ls.ts --no-color` was run read-only before and after that install.
  The two reports are byte-identical, including one finding:
  `agent hephaestus: hephaestus uses medium; maximum is max`.
- Both reports show 11 agents and 8 categories, 5 override rows
  (`prometheus`, `artistry`, `quick`, `unspecified-high`, `writing`), and no
  Google or Gemini assignment.
- The finding was left unrepaired at the user's explicit request.

## Commit provenance

- `2e900eb2b` - merge upstream `dev` head `5cd8e68fd` into `master-nowaker`.
- This record's commit carries
  `AI-Session-ID: ses_fb9a784deffe7zkW0r8oo25Nkg`.

## Unknowns and blocked verification

- `packages/core` plugin tests fail 39 of 39 with
  `ReferenceError: Cannot access '<Plugin>' before initialization` at
  `src/plugin/provider.ts`, a circular-import temporal dead zone in the
  `ProviderPlugins` array. The identical failure reproduces on the pre-merge
  tree `c0f97ee25`, so this integration did not cause it. The likely cause is
  the local Bun 1.4.0 against the repository's pinned `bun@1.3.14`; that was
  not investigated further or fixed here.
- Feature timeline entries dated 2026-09-04 describe merging `v1.18.28`, while
  that session's final source merge was `v1.18.29`. Those entries are left
  verbatim as history; only the `Last checked against upstream` field was
  advanced.
- The `1.18.30` version-string reuse means Vibeterm's outdated-tab comparison
  cannot distinguish tabs running the previous `1.18.30` build from the new one.
  No versioning-policy change was made.
