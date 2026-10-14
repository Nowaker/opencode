# Deliver and settle TUI worker requests without startup races

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `rpc-error-reply` (off upstream `v1` `dfb56f76c7`; also the upstream PR head `2cef65ac7a`)
- First local commit: `c50b7366df` (cherry-pick of `2cef65ac7a`)
- Current local commit(s): `c50b7366df`, `95113b27bc`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: issue [#54934](https://github.com/anomalyco/opencode/issues/54934), PR [#54936](https://github.com/anomalyco/opencode/pull/54936) against `v1`

## Original request

Prompted by a hang report from 19b `ses_eeadda349ffep0Jwwis5g1DJXi`:

> From ses_eeadda349ffep0Jwwis5g1DJXi (19b/19c): an opencode
> instant-session-screen HANG in the fork, live and inspectable right now on
> desktop.

and the coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> Fork regression rule: find the fork commit that introduced the missing reply
> (`git log -p -S '<unique substring>'` on dev-nowaker) and fix it on that
> feature's branch/PR, not as an unrelated new branch. If it traces to upstream
> code we never touched, it's a fresh upstreamable fix: new branch off
> github/v1, issue + PR against v1 (v1 note first, attribution last, no AI
> trailers), then onto dev-nowaker. Data-loss/hang fixes may skip the v1 note.

## Goals

- A request to the TUI's server worker that throws gets an answer: the TUI's
  call rejects with the error's message instead of waiting forever.
- An error with an empty message is reported by its cause's message, as
  `Server.listen`'s `ServeError` for a taken port needs.

## Non-goals

- RPC calls get no timeout: a handler that never settles still leaves its
  caller waiting.
- A worker that remains alive but never finishes module initialization is not
  recovered by receiver readiness.

## Rationale and constraints

- `Rpc.listen` in `packages/opencode/src/util/rpc.ts` replied only when the
  method returned, and the worker's `unhandledRejection` handler is a no-op, so
  a throwing handler left the caller's promise pending forever. The TUI waits
  on the worker before it draws (the `--port` listener, `validateSession` for
  `-s`), so the screen stayed blank or on "Loading session…".
- In the fork, the trigger was session maintenance failing the database layer
  at startup under a locked database; see
  [Session replacement maintenance](./session-maintenance.md) (`22e6326a61`).
  Upstream `v1` hangs the same way on `opencode --port <taken port>`.
- The reply carries the message as a string and the client rejects with
  `new Error(message)`, so the failure reaches the TUI's existing error
  handling, which prints it and exits 1.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `c50b7366df` | 2026-10-12 | `Rpc.listen` answers a failed request with `error` (its message, or the cause's when it has none); `Rpc.client` rejects the pending call with it | `listen` and `client` in `packages/opencode/src/util/rpc.ts`; `test/util/rpc.test.ts` with `test/fixture/rpc-worker.ts` |
| `95113b27bc` | 2026-10-14 | Queue requests until the worker installs its receiver and announces `rpc.ready`; reject outstanding calls on error/closure; clean up workers on all TUI startup exits | `Rpc.listen`/`Rpc.client`; `TuiThreadCommand`; static-import bootstrap regression |

## Verification

- `bun test test/util/rpc.test.ts` in `packages/opencode` on tree
  `dfb56f76c7`: with the original `rpc.ts` 1 pass, 3 fail (no reply within
  2 s); with the change 4 pass.
- `bun typecheck` in `packages/opencode` on the `v1` base and on the landing
  branch: clean. `test/util/rpc.test.ts` with `test/cli/tui/thread.test.ts`:
  14 pass on both.
- `opencode --port 47913` from the `v1` source while another process holds the
  port (`tmp/repro-port.sh` in the session's scratch): original, a blank screen
  20 s after launch; fixed, exit 1 with
  `Failed to start server. Is port 47913 in use?`.
- Installed `1.19.0-vt-248`: with a write lock held longer than session
  maintenance's 60 s retry window, three `opencode -s` exit 1 with
  `Error: Failed to execute statement` instead of staying on
  "Loading session…"; see the session record.

## Timeline

- 2026-10-14 `ses_ec6ba061bffesQBkvfMn0aKona`: reproduced lost requests during
  asynchronous static-import initialization. The early request got no reply
  while a later request to the same worker succeeded; the readiness-gated
  transport preserves FIFO single delivery without a timeout. RPC and TUI
  thread tests: 17 passed; package typecheck and canonical build/guard passed.
  Rebased build `1.19.0-vt-285-dfb56f76c7` loaded a scratch resumed session with
  `session_attached=0`. The live desktop PID 160876 stayed stalled after reveal;
  its four-second strace showed idle parent/server threads and instant-screen
  repainting. That is compatible with request loss, not proof of the exact
  incident's cause. No Vibeterm handoff-timeout change was delivered.
  Canonical builds installed `vt-285` on m4max and desktop. Managed restart of
  `ses_ef8235798ffejGr4sa22eXmVNv` replaced PID 160876; the session loaded and
  completed its normal staged handoff into pane `%19109` with its real `OC |`
  title. The installed build contains no temporary startup instrumentation.

- 2026-10-12 [`ses_eebf9a83fffeIQQwW9gVFo5jaO`](../sessions/2026-10-12-tui-worker-hang.md) -
  introduce; upstream issue #54934 and PR #54936 against `v1`; build and
  install on desktop and m4max (`1.19.0-vt-248-dfb56f76c7`).

## Current maintenance notes

- Drop the fork commit once PR #54936, or an equivalent, is in the upstream
  `v1` the fork is based on.
- A failed SQL statement reaches the user as the `SqlError`'s generic
  `Failed to execute statement`; its cause, such as `database is locked`, is
  not sent.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its
  canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
