# Pause after this step, unpause later (v1)

## Identity

- Workday: 2026-11-14
- Session: [`ses_e26c25ca4ffeYUicqdusaViOJa`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e26c25ca4ffeYUicqdusaViOJa), for coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv)
- Agent/platform: opencode Sisyphus, `anthropic/claude-opus-5-5` / darwin (m4max)
- Repository: `~/projects/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `session-pause` (worktree `.vibeterm/worktrees/session-pause`)
- Upstream base: `006d837c50` (upstream `v1`, `v1.19.5`)
- Source result commit(s): `d634b67a9be`, `e60728ae6eb`, `05d3e55825c` on `dev-nowaker` (rebased onto `0b31166e059` Send now; published with the title fix `f82e3efdce2`)
- Forklog commit: this file's introducing commit

## User requests

Proposal approved as "build all, as recommended": `~/projects/nowaker/opencode-tools/docs/research/2026-11-14-opencode-pause-resume.md`, phases P1 and P2, with the coordinator's decisions overriding the proposal where they differ: `/pause`, `/unpause`, `/discard`; keybind `session_pause` (fork default `alt+p`); a second pause never aborts; deferred calls run before a new user message; automated input is held while paused.

## Contract (draft 2, fixed 2026-11-14)

Consumers: [pause-vt] [`ses_e26c2309cffe1Yhw092QXA2WWI`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e26c2309cffe1Yhw092QXA2WWI), [pause-portal] [`ses_e26c1d3f0ffeBskpNm6KAvzMCq`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e26c1d3f0ffeBskpNm6KAvzMCq).

### Durable state

- Stored in `session.metadata.pause` (opencode.db table `session`, column `metadata`, JSON key `$.pause`). Absent or `null` means not paused. No new column, no migration; session-sync and every `Session.patch` carry it. A fork never inherits it.
- Shape `Pause`:
  - `at`: epoch ms the pause was requested
  - `mode`: `"soft"` (the only mode)
  - `state`: `"pending"` while the current step still drains (a tool or the model response is running), `"paused"` once the loop stopped at the step boundary. A `pending` record with no running loop (opencode died while draining) reads as paused.
  - `source`: `{ kind: "tui" | "tool" | "api", sessionID?, sessionTitle?, machine?, tool?, client? }` - who asked
  - `reason?`: free text from the caller, stored verbatim, shown to a held prompt's sender; descendants paused through a root inherit it, and its `source`, unchanged
  - `stoppedAt?`: epoch ms the loop stopped
  - `root?`: session ID of the ancestor whose pause this one inherited (tree pause); absent on the session that was paused directly
  - `held?`: `HeldPrompt[]`, prompts that arrived while paused and wait for unpause, in arrival order. `HeldPrompt = { messageID, at, delivery? }`: `messageID` is the stored user message ID (the caller's own `messageID` when it passed one, so it doubles as the idempotency key), `at` epoch ms, `delivery` the prompt's first text part `metadata.vibeterm` copied verbatim when present (Vibeterm's delivery provenance, `deliveryMetadata: true`).

### HTTP (instance routes, same `?directory=` and auth as the other session routes)

- Every body below also takes `notice?: string`: when present it is the verbatim text of the user-only notice (Vibeterm sends a `[vibeterm_metadata]` block); when absent opencode writes its own text.
- `POST /session/{sessionID}/pause`, body `{ source?: Source, reason?: string, notice?: string }` (default source `{kind:"api"}`).
  - `200 { sessionID, pause: Pause, changed: boolean }`. Accepted on an idle session (state `paused` at once, automated input held) and on a busy one (state `pending` until the step boundary). Already paused or pending: `changed: false`, nothing else happens; a pause never aborts.
  - Descendant sessions (subagents) get the same pause with `root` set.
  - `404` NotFoundError for an unknown session.
- `POST /session/{sessionID}/unpause`, body `{ source?: Source, expectedPauseAt?: number, expectedPauseSource?: Source }`.
  - `200 { sessionID, changed: boolean, deferred: number }`. `deferred` is how many deferred tool calls it runs (in order, through the normal permission path) before the loop continues with no new user message. Held prompts are answered after them. Not paused: `changed: false`. A `pending` pause is cancelled and the running loop just continues. Unpausing a root also unpauses descendants paused through it.
- `POST /session/{sessionID}/discard`, body `{ source?: Source, expectedPauseAt?: number, expectedPauseSource?: Source }`.
  - `200 { sessionID, discarded: number }`. Each deferred call becomes `status: "error"`, `error: "not run: discarded by /discard"`, so tool_use/tool_result pairs stay valid. The session stays paused.
  - `409` SessionBusyError while the step is still draining.
- Both mutations optionally compare the observed pause identity inside the same SQLite write transaction as their durable changes. Each supplied expectation must match, including every known source field and omitted fields; source object key order is immaterial. A changed or missing pause returns `409 { _tag: "PauseChangedError", sessionID, message: "The pause changed; no action was taken" }` without changing the pause, tool parts or transcript. Omitted expectations preserve unconditional callers; older engines that ignore these fields retain the race. See the [source API documentation](../../../packages/web/src/content/docs/server.mdx#pause).
- `GET /session/status`: every entry may carry `paused?: Pause`. A paused idle session is listed as `{ type: "idle", paused }`; a draining one as `{ type: "busy", paused: { state: "pending", ... } }`. Sessions without a pause keep today's exact shape.
- Prompts (`POST /session/{id}/message`, `/prompt_async`) take an optional body field `unpause?: boolean`. Without it, a prompt to a paused session is stored as usual (visible user message) and starts no turn until unpause (held). With `unpause: true` (the TUI composer submit; Portal's human send) the session is unpaused, its deferred calls run first, then the message. `noReply` notes never start a turn anyway.
- Feature detection: `GET /doc` (OpenAPI) lists `/session/{sessionID}/pause`; older builds answer the route `404`.

### Events

- `session.pause.updated`, payload `{ sessionID, pause: Pause | null }`, published on every change (requested, pending to paused, a prompt held, unpaused). `session.updated` and `session.status` follow as usual.
- `session.pause.released`, payload `{ sessionID, held: HeldPrompt[] }`, published once per unpause that has held prompts, when the loop that answers them actually starts (after the deferred calls ran). Vibeterm uses it to tell each original caller its prompt was delivered.

### Deferred tool parts

- A tool call the model requests while the session is paused is stored with full input and not run: `{ type: "tool", tool, callID, state: { status: "pending", input, raw, metadata: { deferred: { reason: "paused", at } } } }`. `ToolStatePending` gains optional `metadata` (additive).
- Abort cleanup and the interrupted-orphan rule skip deferred parts; they survive an opencode restart.

### Notices

- Every pause, unpause and discard appends a user-only notice (ignored synthetic text part: shown in the transcript, never sent to the model) naming who did it (`source`), on which Vibeterm machine, and when. Its text part carries `metadata.pause = { action: "pause" | "unpause" | "discard", source, at }`.

### Reaching a portless TUI tab

- The routes are part of opencode's HttpApi, so the TUI's in-process server serves them too; a TUI plugin reaches them through its SDK client (`client.session.pause({ sessionID, source })`), or the raw `client._client.post({ url: "/session/{sessionID}/pause", path, query: { directory }, body })` when its generated client predates the routes.
- Every TUI composer submit sends `unpause: true`, including text typed into the composer through tmux. Automated senders must deliver through `api.prompt.deliver` (or HTTP without `unpause`), which is held.

## Goals

- P1: pause at the step boundary and unpause, durable across a restart, with HTTP routes, SDK and TUI.
- P2: tool calls requested while paused deferred with full input, discard, held automated input, subagent tree.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Pause a session after its current step](../features/2026-11-14-session-pause.md) | new | below |
| [Send queued notes now](../features/2026-11-14-send-now.md) | `paused` refusal wired | `pause.test.ts` held-prompt case |

## Other delivered work

- `e60728ae6eb`: `local.tsx` model and pin saves logged an unhandled rejection when the state directory was gone; it failed `deliver-past-ask` and `transcript-filter-dialog` about one run in three.
- `MessageV2` same-millisecond cache staleness fixed with `forgetPart`/`forgetInfo` (inside `d634b67a9be`).
- Pause contract agreed with [pause-vt] and [pause-portal]; draft 2 adds `reason`, `sessionTitle`, `held`, `notice` and `session.pause.released` at the user's request.

## Verification

- `bun run test test/session/pause.test.ts` (packages/opencode) - 9 pass, run 3 times: deferral while streaming with unpause running the calls in order, running tool finishes and a second pause changes nothing, held prompt plus release event and Send now refusal, `unpause: true` message runs the deferred calls first, discard, abort keeps deferred calls, survival of an instance reload, subagent tree pause and the subagent's wait at its step boundary.
- `test/session/prompt.test.ts` 106 pass, 1 skip; processor-effect, message-v2, message-v2-hydration, tools, async-snapshot, run-state, fork, compaction 158 pass, 1 skip; `test/server/httpapi-session.test.ts` with the new pause/unpause/discard route test pass. `httpapi-public-openapi.test.ts` "documents session busy errors" fails as it does on the base (known baseline failure, see Inactive HTTP Directory Instances in the README).
- TUI tests in `test/prompt`, `test/routes`, `test/component`, `config.test.tsx`, `prompt-control.test.ts`, `keymap.test.tsx` pass; the two order-dependent ENOENT failures are fixed by `e60728ae6eb` (5 consecutive clean runs).
- `bun typecheck` clean in opencode, tui, schema, sdk/js and session-ui. SDK regenerated; a second run changed nothing; `packages/client` generation produced no change.
- Real TUI on a throwaway tmux socket, scratch XDG homes from the patch rig, a scripted OpenAI-compatible provider: 13 of 13 checks, first from the worktree source, then against the installed vt-486 binary. `alt+p` during `sleep 5` shows "pausing… waiting for bash", the sleep finishes, no second request, footer "paused - /unpause to continue"; a second `alt+p` does not abort; `/unpause` sends exactly one request. `alt+p` while a response streams leaves three calls shown "waiting for /unpause" and the footer counting 3, no request follows, none ran; after quitting and `opencode -c` they are still deferred and no request is sent; `/unpause` sends one request carrying the three results in order.

## Build and install

- m4max: `.vibeterm/build.sh` run by [`ses_e260d756cffeESP9yeZasZMm2X`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e260d756cffeESP9yeZasZMm2X) on the combined tree `f82e3efdce2`; v2 migration guard gate passed; installed `1.19.5-vt-486-006d837c50`. `.vibeterm/smoke.sh` on it: SMOKE OK.
- desktop: build of the same tree owned by the same session; not verified by this session.
- No serve unit or TUI tab restarted.

## Commit provenance

- Required trailer: `AI-Session-ID: ses_e26c25ca4ffeYUicqdusaViOJa`

## Follow-up: pause came back after unpause (Portal live check)

Reported by [pause-portal] [`ses_e26c1d3f0ffeBskpNm6KAvzMCq`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e26c1d3f0ffeBskpNm6KAvzMCq) on scratch session `ses_e22d0fd7affehMAALu1CuEVtWl`.

- Cause 1: unpause deleted `metadata.pause`; desktop still held the synced pending pause, and session sync adds every key the local row lacks. The event log shows the row clear at seq 34, then the original pending pause back at seq 56. The collector logged "merged session metadata" at 03:32Z, and the pause reappeared again afterwards. Fix `3cdb14afd61`: store `pause: null`.
- Cause 2: the TUI merged each `session.status` into the stored object, so `paused` survived an idle status and the footer kept "paused". Fix: `reconcile`.
- Not a fork bug: vibeterm-api's `/session/status` called the session busy because its detector reads a trailing `vibeterm_notify_session` note (noReply) as `no-dispatch`. Unpause correctly started no turn: notes never start one.
- Tests: `pause.test.ts` "a cleared pause stays cleared when a peer's stale copy is merged in" and TUI `sync-session-status.test.tsx`; each fails without its fix and passes with it. `pause.test.ts` 10/10 in three consecutive runs; one earlier run timed out the discard case at 60 s on a loaded host and did not recur. TUI sync/footer/context 45 pass, `httpapi-session.test.ts` 29 pass, typecheck clean.
- Installed `1.19.5-vt-494-006d837c50` on m4max with `.vibeterm/build.sh`; guard gate passed; smoke OK.

## Follow-up: pause identity guard

- Workday: 2026-11-16. Implementer: [`ses_e1c57d050ffe4t64XczrGAzjqs`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c57d050ffe4t64XczrGAzjqs), for parent [`ses_e1c704309ffe9QEvj69IIxmKNZ`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c704309ffe9QEvj69IIxmKNZ); authorized by coordinator [`ses_e1c745f8affeXxivqgT05XoDf1`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c745f8affeXxivqgT05XoDf1). Development branch: `pause-identity-guard`, cut from `dev-nowaker` at `e0ad94cdbd39ccd5347fe797c6efcfb46f285c8b`. Source: `f2c0ed3b578`, fast-forwarded into `dev-nowaker` without rebasing integration history.
- The caller's source was attribution only. Reading it before invoking unpause could lift a replacement pause; discard had no ownership check either. `SessionPause.mutate` now holds an immediate SQLite transaction across the identity read and every durable clear/discard write. Waiting fibers and transcript notices run after commit. Both optional fields are parsed by the existing v1 route payload schema; no v2 pause contract changed.
- Before the fix, all 14 new engine replacement cases failed because the operation succeeded. With the fix, `bun run test test/session/pause.test.ts test/server/httpapi-session.test.ts` passed 73 tests (30 engine, 43 HTTP), 404 assertions. These cover all six source fields, timestamp mismatch, unchanged deferred parts/transcript on conflict, timestamp-only/source-only/both matches with reordered keys, and existing omitted-field behavior. After sharing the stored timestamp schema, the focused HTTP identity/legacy gate passed 9 tests and 34 assertions.
- `bun typecheck` passed in `packages/opencode` and `packages/sdk/js`. Changed-file LSP checks reported no errors; the final freshness refresh timed out for `pause.ts` and generated `sdk.gen.ts`, with package typechecks providing the full static check. Legacy SDK source was regenerated without its artifact compilation; `packages/client` generation changed nothing. Temporary codegen files were removed.
- No binary build, install or process restart was run. Parent coordinates installation with [`ses_e1c8d67dbffeqlzOK8teK7Agt4`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c8d67dbffeqlzOK8teK7Agt4); this source delivery stops after both mirror pushes.

## Unknowns and blocked verification

- Desktop install of vt-486 or later is reported by [`ses_e260d756cffeESP9yeZasZMm2X`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e260d756cffeESP9yeZasZMm2X), not checked here.
- Running TUI tabs pick up pause only after `vibeterm_restart_tab`. Pausing a tab before [pause-vt]'s status class ships may make the stuck detector treat a paused session as stuck (proposal risk table).
- The full `bun turbo typecheck` was cut off at 25 minutes on a power-throttled m4max (18 of 30 tasks passed, no errors); the pre-push hook of the combined push ran it to completion.
