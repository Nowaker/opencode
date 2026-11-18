# Atomic prompt admission and pause handoff

## Identity

- Workday: 2026-11-18
- Session: [`ses_e0f9e921effeKX9b54BeVccpTI`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e0f9e921effeKX9b54BeVccpTI), coordinated by [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv).
- Integration: `dev-nowaker` fast-forward from `39b7c00ed5` to source `39873bbda9`, with `c06c948a54` for the Core event batch. Development: `atomic-prompt-admission`. Contained upstream base: `006d837c50` (`v1.19.5`).

## Scope and behavior

- [Prompt admission](../features/2026-10-07-tui-prompt-admission.md): a part write failure rolls back the message and all initial parts. `DatabaseTransaction.batch` also delays live notifications and durable stream wakeups until commit. Attachment resolution and plugin hooks run before taking the write lock.
- [Session pause](../features/2026-11-14-session-pause.md): test the current pause and persist any hold in the same transaction as the message. If unpause already cleared the pause, the incoming prompt drives the turn. Otherwise unpause sees the committed hold and owns the wake. The admission acknowledgement comes after that handoff is durable.
- [Upstream queue](../pr-queue/12-atomic-prompt-admission.md): `prompt-admission-v1` (`102d16eae9`) is cut from upstream `v1` at `c618499abc`. It carries atomic persistence and a SQLite rollback/retry regression. The pause handoff is recorded on the [pause feature's queue entry](../pr-queue/09-session-pause.md), because upstream `v1` does not have pause or the admission acknowledgement. No PR was opened.

## Verification

- Fork red on unchanged source: the SQLite trigger aborting the second part returned HTTP 204 (expected 400); unpause while the acknowledged prompt was blocked at its activity update sent no model request. Both tests pass with the fix.
- Core: `bun run test test/database-transaction.test.ts test/event.test.ts`, 63 pass, 159 assertions. The event observer sees neither the rolled-back event nor an intermediate commit and can read the complete durable batch.
- m4max: `bun run test test/session/pause.test.ts test/session/archive.test.ts --timeout 180000` passed 46 tests (307 assertions). `OPENCODE_PROMPT_PROBE_BINARY=/Volumes/projects/webapps/opencode-build/bin/opencode bun run test test/server/prompt-admission.test.ts --timeout 180000` passed all 5 HTTP cases (15 assertions). A combined source run timed out in eight cases under load, including in `/session` fixture startup before prompt admission; the split runs passed.
- `bun typecheck` passed in fork Core and OpenCode, and in candidate OpenCode. Both normal source pushes passed the 30-task workspace typecheck hook.
- The four existing same-message-ID prompt regressions passed (13 assertions), including async acknowledgement of a retry before the first reply completes.
- Upstream candidate: the focused rollback/retry test passed with five assertions. With only the transaction call disabled, it failed because history retained the user message and its first part.

## Installation

- `bash .vibeterm/build.sh`, source `39873bbda9`: m4max installed `1.19.5-vt-545-006d837c50`, inode `137221821`, retry-cap marker count 1; database guard and `.vibeterm/smoke.sh` passed.
- Desktop built the same source after m4max. Preflight: 39,733,412 kB MemAvailable, memory PSI full avg60 1.26. Installed `1.19.5-vt-545-006d837c50`, inode `49946776`, retry-cap marker count 1; database guard and smoke passed. Both protected desktop service statuses were unchanged.
- Build logs: `/Volumes/projects/webapps/opencode/.vibeterm/tmp/build-atomic-prompt-m4max.log` and `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/build-atomic-prompt-desktop.log`.
