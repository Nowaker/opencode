# OpenCode forklog

This directory is the tracked source of truth for local OpenCode behavior on
`master-nowaker`. It answers two different questions through linked views:

- [`features/`](./features/) explains why each durable customization exists,
  where its stable seams live, and how its behavior changed over time.
- [`sessions/`](./sessions/) records what one coding-agent session did to which
  branch and upstream base, including verification, build, and install facts.

Track forklog changes only on `master-nowaker`. Each coding-agent session gets
one unsquashed forklog commit per user workday, even when an upstream bump
carries every feature forward unchanged. That commit includes the full
`AI-Session-ID` trailer.

## Templates

- [`_feature.md`](./_feature.md) - one durable customization.
- [`_session.md`](./_session.md) - one coding-agent session and user workday.

## Active features

- [Global memory diagnostics](./features/2026-05-13-global-memory-diagnostics.md)
- [Message shape normalization](./features/2026-05-23-message-shape-normalization.md)
- [Interrupted assistant tail filtering](./features/2026-05-29-interrupted-assistant-tail.md)
- [Sync hot-path tuning](./features/2026-05-29-sync-hot-path.md)
- [Alternate provider clones](./features/2026-05-30-alt-provider-clones.md)
- [Compaction decision tracing](./features/2026-06-16-compaction-decision-tracing.md)
- [Strict global bus typing](./features/2026-07-21-global-bus-typing.md)
- [Retry-header delay cap](./features/2026-08-06-retry-header-delay-cap.md)
- [Native tool commands](./features/2026-08-08-native-tool-commands.md)
- [TUI streaming render throttle](./features/2026-08-25-tui-stream-throttle.md)
- [Prompt input latency](./features/2026-08-31-prompt-input-latency.md)

## Session records

- [2026-08-29 `ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](./sessions/2026-08-29-upstream-bump-and-forklog.md)
  - Integrate `v1.18.25`, verify every seam, rebuild, and establish linked
    feature/session provenance.
- [2026-09-02 `ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](./sessions/2026-09-02-opencode-omo-refresh.md)
  - Reconcile Linux and macOS feature work, integrate `v1.18.27`, rebuild both
    hosts, and refresh OMO assignments.
- [2026-09-04 `ses_fb9a784deffe7zkW0r8oo25Nkg`](./sessions/2026-09-04-opencode-omo-refresh.md)
  - Integrate `v1.18.29`, rebuild the macOS fork, and migrate OMO overrides to
    canonical reasoning without changing effective assignments.
- [2026-09-08 `ses_fb9a784deffe7zkW0r8oo25Nkg`](./sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - Integrate upstream `dev` past `v1.18.29` for the Astra prompt, rebuild the
    macOS fork, and report OMO assignments read-only around an OMO reinstall.

Historical session evidence remains in each feature timeline. A historical
session does not get a fabricated file when its full narrative was not found.

## Upstream integration history

Upstream integration is a session activity, not a durable customization. Full
evidence and no-match searches are preserved in the applicable linked session
records.

- `0ac3fad6f` (2026-07-28) - merge `github/dev`.
- `421923926` (2026-08-04) - merge upstream `v1.18.13`.
- `8617f1049` (2026-08-11) - merge upstream `v1.18.16`.
- `9d78ca8c6` (2026-08-15) - merge upstream `v1.18.18`.
- `0a12138e8` (2026-08-29) - merge upstream `v1.18.25`.
- `ca4200381` (2026-08-29) - join patch-equivalent remote ancestry; the tree
  stays unchanged.
- `5b80c26d6` (2026-09-02) - merge upstream `v1.18.27` after reconciling the
  Linux prompt-latency and macOS native-command work.
- `a438486ba` (2026-09-04) - merge upstream `v1.18.28` after reversing and
  reapplying the canonical retry-header delay cap.
- `9f8f2b0b5` (2026-09-04) - merge exact upstream tag `v1.18.29` while
  preserving the canonical retry-header delay cap.
- `2e900eb2b` (2026-09-08) - merge upstream `dev` head `5cd8e68fd`. Upstream
  published no release tag after `v1.18.29`, so this integrates 29 untagged
  commits, including the Astra system prompt.

## Update workflow

1. Merge or rebase source work before editing the forklog.
2. Create one session record for the current session and user workday.
3. Update every applicable feature and link its timeline entry to that session.
4. Link the session back to every feature it changed or re-verified.
5. Preserve `TBD`, confidence labels, and explicit failed searches verbatim.
6. Commit all forklog edits together, unsquashed and above the source head.
7. Include `AI-Session-ID: <full-session-id>` with the standard AI trailers.

Work continuing after midnight belongs to the evening's workday. A feature
starts on its first user workday; a session record uses that session's workday.
