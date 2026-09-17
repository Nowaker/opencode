# Session maintenance protocol-3 distribution

## Identity

- Workday: 2026-09-16
- Session: `ses_f58977fb9ffeipRza8svjN42hp`
- Parent coordinator: `ses_f6c152d3affeSymn4llo768CER`
- Agent/platform: `openai/gpt-6-astra` / Linux
- Integration: `master-nowaker`; development: `session-maintenance`
- Feature: [Session replacement maintenance](../features/session-maintenance.md)

## Request and constraints

> AUTHORIZE phase1 core integrate+push+canonical build/install desktop AND m4, EMERGENCY MARKER REMAINS ACTIVE.

- No production marker removal, replacement operation, or runtime refresh.
- Preserve protected serve processes, tmux servers, and unrelated retry edits.
- Use each host's canonical `opencode-build/build.sh` only.

## Source movement

- Original feature: `ec5d230a6f`, `b2144cb008`, `3a9b9d7313`.
- Emergency mitigation retained: `374b2af037`.
- Indexed repair: `9932a7c8cb`, `580a6fd225`, `7fec927ed5`.
- Desktop fast-forwarded `374b2af037..7fec927ed5` and pushed to origin.
- m4 source fast-forwarded `ec0502fc7f..7fec927ed5`; unrelated edits preserved.

## Verification

- Focused core suite: 22 pass, 0 fail, 100 assertions.
- Core and OpenCode package typechecks pass; push hook: 30 tasks successful.
- Baseline regression: generated conflict predicate reported `SCAN existing`.
- Repaired 100,000-row plans use indexed searches. Actual 500,000-row VM steps:
  empty update/insert 195/134; active fence+generation update/insert 195/134.
- Installed desktop and m4 CLIs, isolated home/config/data/database: version, help,
  successful DB capability query, invalid-SQL failure, protocol 3, and a later
  isolated marker-controlled protocol-0 connection pass.

## Installation evidence

- Desktop command: `OPENCODE_VERSION=1.18.32 /home/nowaker/projekty/webapps/opencode-build/build.sh`
- Desktop artifact: 1.18.32, inode 49961905, SHA-256
  `72ae63f1e641f67fc57d31e1c6def255d40b60a4631e9aac4be268264602f82f`.
- Desktop protected units unchanged: tailscale PID 888349/start monotonic
  87115692698; LAN PID 888331/start monotonic 87115643854.
- Desktop tmux PID 1905220, start Wed Sep 16 15:38:32 2026, unchanged.
- Desktop emergency marker remains mode 0600. No live DB opened by QA.
- m4 marker was absent at preflight; created mode 0600 with no-clobber semantics
  before installation to enforce the authorized phase-1 emergency state.
- Canonical m4 builder: `/Users/nowaker/projects/webapps/opencode-build/build.sh`.
- m4 command: `OPENCODE_VERSION=1.18.32 /Users/nowaker/projects/webapps/opencode-build/build.sh`.
- m4 artifact: 1.18.32, inode 18190955, SHA-256
  `3631dec8b542e2ec073929d5e7641006acd61f508f89a1b62a36b37df66c5b88`.
- m4 tmux PID 8927/start Sun Sep 13 15:53:45 2026 unchanged; observed long-lived
  OpenCode PIDs including 93684 and 22011 retained their original start times.
- Neither host had user runtimes or services restarted by this deployment.
- Desktop PATH resolves the canonical fork executable. m4's `opencode.command`
  resolves `/Users/nowaker/projects/webapps/opencode-build/bin/opencode`; generic
  Homebrew PATH differs and is not the Vibeterm launch target.
- Pre-existing `.gitignore`, `bun.lock`, and retry source/test file hashes were
  identical before and after build on each host.

## Provenance

- Forklog commit: this record's introducing commit.
- Required trailer: `AI-Session-ID: ses_f58977fb9ffeipRza8svjN42hp`.
