# Record who requested a cancel on the aborted row

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `abort-requester`
- First local commit: `ad8da6065b`, `c459e6157b`
- Current local commit(s): `ad8da6065b`, `c459e6157b`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: none. Fork-only, stacked on the fork-only [per-run abort provenance](../README.md#per-run-abort-provenance) server part.

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (TUI part of the abort-cause feature requested by stuck detector `ses_ebc7292d6ffe0m5W6cH7M4vIPv`):

> Abort route: POST /session/{id}/abort (server/routes/instance/httpapi/handlers/session.ts ~257) accepts an optional requester (body field or query param; choose whichever fits the existing route style, keep it backward compatible). An absent value means "api". Reject unknown values cleanly; never write "killed" from here.

> TUI call sites pass their own value: "tui" for the prompt interrupt [...]; "tui-revert" for the undo/revert path [...]. Every other caller (OpenPortal through vibeterm-api, plugins, other HTTP clients) defaults to "api" with no change.

## Goals

- A cancelled assistant row says which caller stopped it: `$.error.data.requester` in the stored `message.data` (`$.info.error.data.requester` from `GET /session/{id}/message/{messageID}`), next to `cause: "cancel"`.
- `tui`: the TUI prompt's abort, reached by esc twice (`session_interrupt`), `/abort`, the `session_abort` keybind (default `alt+escape`) and a click on the interrupt hint.
- `tui-revert`: the TUI's undo (`<leader>u`, `/undo`, `/undo-messages`, `/undo-files`) while a turn runs.
- `api`: every HTTP abort that names no requester, so existing clients are attributed without changing.

## Non-goals

- `killed` is never written by OpenCode; it stays reserved for Vibeterm's external SIGKILL writer and the route rejects it.
- Disposal rows (`cause: "dispose"`) carry no requester.
- No backfill of rows written before this field existed; a missing `requester` means unknown.

## Rationale and constraints

- The abort route has no body and every session route takes routing in the query (`WorkspaceRoutingQuery`), so `requester` is an optional query parameter; old clients keep working.
- The value is the canonical `SessionV1.AbortRequester` literal schema, so the route validates it and a bad value gets `400` before any cancel runs.
- The default lives in the HTTP handler, not in `SessionPrompt.cancel`: in-process callers that pass no options keep writing no requester, while every HTTP client is named `api`.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `ad8da6065b` | 2026-10-16 | Optional `requester` query on the abort route, default `api`, unknown values `400`; SDK v2, `openapi.json`, server docs | `AbortQuery` in `server/routes/instance/httpapi/groups/session.ts`; `SessionHttpApi.abort` in `handlers/session.ts`; `SessionAbortData.query.requester` in `packages/sdk/js/src/v2/gen/types.gen.ts` |
| `c459e6157b` | 2026-10-16 | TUI sends `tui` from the prompt's `abort()` and `tui-revert` from the session route's `undo()` | `abort()` in `packages/tui/src/component/prompt/index.tsx`; `undo` in `packages/tui/src/routes/session/index.tsx` |

## Verification

Reported by `ses_eb83d5fd6ffe2F4YAv9F3pW2IU`:

- `env -u TMPDIR bun test --timeout 120000 test/server/session-abort.test.ts` in `packages/opencode` - 1 pass. Isolated source `serve` with a synthetic provider; one session runs bare abort, `tui`, instance dispose, `tui-revert`, global dispose, config dispose, bare abort. Cancels carry `api`/`tui`/`tui-revert`, disposals carry only `dispose`, nothing stale carries over; `requester=killed` and `requester=bogus` return `400`. With only the route change reverted the same test fails (bare abort lacks `requester: "api"`).
- Real TUI on a throwaway tmux socket against an isolated `serve` (scratch HOME/XDG/tool/plugin stores, loopback, port 0): esc esc mid-turn stored `cause: cancel, requester: tui`; `ctrl+x u` mid-turn stored `requester: tui-revert`; a bare `POST /session/{id}/abort` stored `requester: api` and returned it as `$.info.error`; `?requester=killed` returned `400`. Ran against source, the installed desktop binary and the installed m4max binary with the same result.

## Timeline

- 2026-10-16 [`ses_eb83d5fd6ffe2F4YAv9F3pW2IU`](../sessions/2026-10-16-abort-requester.md) - route input, `api` default, TUI callers, tests, docs; installed `1.19.0-vt-343-dfb56f76c7` on both hosts. Evidence: linked session.

## Current maintenance notes

- After changing `AbortQuery`, regenerate with `./packages/sdk/js/script/build.ts` and `bun dev generate > ../sdk/openapi.json` from `packages/opencode`; `packages/client` generation produces no change.
- Query parameter descriptions do not reach `openapi.json` (the existing `before`/`after` descriptions do not either); the enum does.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Reverse any deliberate uncommitted patch before merging, then reapply its canonical patch afterward.
- Regenerate derived clients or schemas instead of editing generated files.
- Run the feature's focused tests and affected package typechecks.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
