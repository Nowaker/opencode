# A defer permission reply that fails only one ask

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `permission-defer` (cut from `dev-nowaker`)
- First local commit: `8940e84418`
- Current local commit(s): `8940e84418`, merge `365d0a3b4d`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), user approval [`qst_1b1f5ccc8001S9eg6MnBxGvxuj`](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1b1f5ccc8001S9eg6MnBxGvxuj) ("Build it"):

> Fork: a new reply kind `defer` (pick the final name for consistency with once/always/reject) carrying a message. It fails ONLY that request, with an error the session processor treats as non-blocking (like CorrectedError in SessionProcessor.failToolCall), whose text is our message verbatim with no "user rejected" prefix, and it touches no other pending request.

## Goals

- `POST /permission/:requestID/reply` (and the legacy session permissions route) accepts `reply: "defer"` with an optional `message`.
- A `defer` fails only the request it answers, with `PermissionV1.DeferredError`, whose `message` is the reply's message verbatim (without one, a fixed text says the request was deferred, not refused).
- The session's other pending requests stay pending, and the turn continues: `failToolCall` blocks only on `RejectedError`.
- A `doom_loop` ask answered with `defer` fails only the repeated call with the feedback instead of ending the turn.

## Non-goals

- No UI button: the TUI still offers once/always/reject.
- The `doom_loop` permission default (`ask`) is unchanged.
- `reject` keeps its cascade and its "user rejected" prefix.
- The original v1 increment leaves the v2 protocol and owner unchanged; the separately delivered v2 port is recorded below.

## Rationale and constraints

- Vibeterm's permission broker deferred an unanswered ask after 2 minutes with `reject` plus a message. `CorrectedError` prefixes that with "The user rejected permission to use this specific tool call with the following feedback:", which is false for a deferral, and every `reject` also fails the session's other pending requests with a plain `RejectedError`, which ends the turn.
- The `doom_loop` ask runs inside the stream handler (`case "tool-call"` in `SessionProcessor`), where any failure escapes and ends the turn. Only `DeferredError` is caught there, so `reject` and `deny` keep their old effect.
- Feature detection for clients: a `defer` reply to an unknown request id is 400 on an opencode that cannot decode the kind (vt-413) and 404 on one that can (vt-416), and changes nothing. Vibeterm's spawn plugin probes this way.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `8940e84418` | 2026-11-10 | `defer` reply kind with descriptions | `PermissionV1.Reply`, `PermissionV1.ReplyMessage` (`packages/schema/src/v1/permission.ts`) |
| `8940e84418` | 2026-11-10 | `DeferredError`, message = feedback | `PermissionV1.DeferredError` (`packages/core/src/v1/permission.ts`) |
| `8940e84418` | 2026-11-10 | Fail only the answered request, no cascade | `Permission.reply` `input.reply === "defer"` branch (`packages/opencode/src/permission/index.ts`) |
| `8940e84418` | 2026-11-10 | A deferred doom_loop ask fails only the repeated call | `case "tool-call"` doom-loop `permission.ask(...).pipe(Effect.catchIf(DeferredError, failToolCall))` (`session/processor.ts`) |
| `8940e84418` | 2026-11-10 | Reply payload message description | `ReplyPayload` (`server/routes/instance/httpapi/groups/permission.ts`) |
| `8940e84418` | 2026-11-10 | Regenerated JS SDK | `packages/sdk/js/src/v2/gen/{sdk,types}.gen.ts` |
| `8940e84418` | 2026-11-10 | Docs | `packages/web/src/content/docs/permissions.mdx` ("What Ask Does") |
| `8940e84418` | 2026-11-10 | Tests | `test/permission/next.test.ts` ("reply - defer fails only that request ...", "reply - defer without a message ..."); `test/session/processor-effect.test.ts` ("fail only the repeated call when doom_loop is deferred") |
| `365d0a3b4d` | 2026-11-10 | Fork merge, no conflicts | - |

## Verification

- `bun run test test/permission/next.test.ts test/session/processor-effect.test.ts` in the worktree: 101 pass.
- `bun typecheck` in `packages/schema`, `core`, `opencode`, `sdk/js`, `tui`: clean. The push hook ran the repo typecheck on `365d0a3b4d`: passed.
- `./packages/sdk/js/script/build.ts` run twice: the second run changed nothing.
- Installed `1.19.5-vt-416-006d837c50` on desktop and m4max; v2 guard gate passed and `.vibeterm/smoke.sh` SMOKE OK on both. Probe: `defer` to an unknown id answers 404 on vt-416 and 400 on vt-413.
- End to end with opencode-tools `03c41af7d16` `opencode-vibeterm-spawn-plugin/tests/permission-defer.e2e.test.ts` (real TUI, throwaway tmux socket, isolated homes): both tests pass on vt-416 and fail on vt-413.

## Timeline

- 2026-11-13 [W1 v2 port](../sessions/2026-11-13-v2-plugin-controls.md#form-permission-and-job-result-controls), [session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ), publishes `889195efbcefdd8d826727560e56309f240a5636` on `v2-nowaker`. Native v2 `decision: "defer"` preserves exact/default/empty feedback without sibling cascade, and reject gains opt-in `scope: "request"`. Both runtimes advertise `permissionDefer` and `permissionRejectIsolation`; omitted reject scope retains v2's existing cascade. Canonical `ReplySelection`, `Permission.DeferredError`, runner error conversion, MCP and CodeMode propagation own the port; the v1 processor and doom-loop implementation are not copied into v2. Desktop and m4max install vt-22 through separate 12/12 gates and each passes the installed four-scenario permission proof.
- 2026-11-10 [`ses_e3b76f3eaffe6Ydg2S8MTeZa64`](../sessions/2026-11-10-permission-defer-reply.md) - initial build. Evidence: `8940e84418`, merge `365d0a3b4d`, vt-416 on both hosts.

## Current maintenance notes

- Fork-only, no upstream PR. If upstream changes `Permission.reply` or the doom-loop block in `SessionProcessor`, re-apply the `defer` branch and the `DeferredError` catch, then rerun the two focused test files.
- After touching `PermissionV1.Reply`, regenerate the JS SDK (`./packages/sdk/js/script/build.ts`).
- Consumer: opencode-tools `_lib/permission-timeout/broker.ts` (deferral) and `opencode-vibeterm-spawn-plugin/src/permission-defer.ts` (probe, doom_loop answer).
