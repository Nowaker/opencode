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

## Session records

- [2026-08-29 `ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](./sessions/2026-08-29-upstream-bump-and-forklog.md)
  - Integrate `v1.18.25`, verify every seam, rebuild, and establish linked
    feature/session provenance.

Historical session evidence remains in each feature timeline. A historical
session does not get a fabricated file when its full narrative was not found.

## Upstream integration history

Upstream integration is a session activity, not a durable customization. Full
evidence and no-match searches are preserved in the current
[integration session record](./sessions/2026-08-29-upstream-bump-and-forklog.md).

- `0ac3fad6f` (2026-07-28) - merge `github/dev`.
- `421923926` (2026-08-04) - merge upstream `v1.18.13`.
- `8617f1049` (2026-08-11) - merge upstream `v1.18.16`.
- `9d78ca8c6` (2026-08-15) - merge upstream `v1.18.18`.
- `0a12138e8` (2026-08-29) - merge upstream `v1.18.25`.
- `ca4200381` (2026-08-29) - join patch-equivalent remote ancestry; the tree
  stays unchanged.

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
