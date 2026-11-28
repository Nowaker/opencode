# Timestamps in the viewer's timezone

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `viewer-timezone`
- First local commit: `31aa8d56a5`
- Current local commit(s): `31aa8d56a5`, `7a8274056b`, `c8e5af238e`; merge `b99651797b`
- Upstream base when introduced: `006d837c50` (v1.19.5)
- Last checked against upstream: `006d837c50`

## Original request

TBD - requested through the coordinator (ses_ef8235798ffejGr4sa22eXmVNv); the TUI on a server in one timezone showed times in that server's zone instead of the zone of the device viewing it.

## Goals

- A TUI started by Vibeterm formats times, dates and "today" in the active viewer's zone and advances "today" at the viewer's midnight.
- Without a Vibeterm socket, or after 20 s without a fresh frame, it uses the process zone.

## Non-goals

- Choosing the viewer: Vibeterm (opencode-tools `viewer-timezone`, resident viewer-time-zone server) elects the active physical viewer and serves the zone.

## Rationale and constraints

- Input is a private local socket named by `VIBETERM_VIEWER_TIME_ZONE_SOCKET`, scoped to the pane from `TMUX`/`TMUX_PANE`; frames are one JSON key, at most 512 bytes, validated IANA names only (no UTC offsets).
- v2 tabs do not receive the socket.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `31aa8d56a5` | 2026-11-27 | Format timestamps in the viewer zone | `util/locale.ts`, `util/viewer-time-zone.ts` |
| `7a8274056b` | 2026-11-27 | Advance today at the viewer midnight | `util/day.ts` |
| `c8e5af238e` | 2026-11-27 | Receive the viewer zone from Vibeterm | `util/viewer-time-zone-receiver.ts`, `app.tsx` |

## Verification

- Reported by ses_de4d5cba6ffeSGbQk4mIOkkVdo: TUI suite 1007 pass / 1 skip; m2pro native Vibeterm.app 20 direct + 20 canonical; real m2pro -> hania-arch SSH attach with automatic listener startup and strict reuse (hn1127fix), zero unexpected fallback frames.
- Coordinator review of the receiver, zone and locale source.

## Timeline

| Workday | Event |
|---|---|
| 2026-11-27 | Accepted and merged as `b99651797b` |
