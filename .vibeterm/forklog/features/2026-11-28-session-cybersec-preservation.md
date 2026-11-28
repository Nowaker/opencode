# Per-session Claude quota preference (cybersec preservation)

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `session-quota-routing`
- First local commit: `78aca81723`
- Current local commit(s): `78aca81723`, `41fa9fd498`, `95695a8e4b`, `28d122d55a`, `82a49540bc`, `940e6f8310`, `039ee127bf`, `d7791f0cd8`, `7ae4ed6c14`, `92bd7e687a`, `a11512ad30`; merge `7942bb135b`
- Upstream base when introduced: `006d837c50` (v1.19.5)
- Last checked against upstream: `006d837c50`

## Original request

TBD - requested through the Meridian coordinator (ses_fe8a27c6effe6KEx3TRNvOLgUo) and the OpenCode coordinator (ses_ef8235798ffejGr4sa22eXmVNv): let each session choose whether plain Claude requests keep or spend the CVP accounts' cybersec allowance, instead of one machine-wide switch. Built by ses_de035e532ffeOhT5WiU3NqlcTb.

## Goals

- A session stores `inherit`, `on` or `off` with a revision in `metadata.vibeterm.cybersecPreservation`; child sessions inherit a non-inherit value.
- Plain `anthropic` requests through Meridian (`@ai-sdk/anthropic`, Meridian base, non-OAuth) carry `x-meridian-cybersec-preservation` when the session is `on` or `off`, including availability probes for auto-switch.
- TUI: model dialog action (ctrl+o) and `/cybersec` picker or `/cybersec on|off|inherit`; no new row in the session view. `/cybersec-preservation` stays the machine default.
- API: GET/PUT `/session/{sessionID}/cybersec-preservation` (`{preference}` -> `{preference, revision}`; 400 bad input, 404 missing, 503 outside the bound owner), `/global/health` `cybersecPreservation: 1`, event `vibeterm.session.cybersec_preservation.updated` `{version, sessionID, revision}` on `/event` and `/global/event` only.

## Non-goals

- Removing any safeguard: requests already carrying `x-meridian-profile` or `x-meridian-require` (anthropic-cybersec, anthropic-restricted) are untouched.
- Forks (`forkedFrom`) start at `inherit`, like a pause.
- Attach and plain serve never claim session ownership; the legacy explicit `--session <child>` ownership path is unchanged on purpose.

## Rationale and constraints

- Quota routing between the owner's own Claude accounts; `on` keeps CVP accounts idle for plain `anthropic/*` work.
- A TUI binds only the root session it created or resumed locally, over the worker RPC `bindSessionOwner`, so the control works in fresh tabs.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `78aca81723` | 2026-11-27 | Baseline generated SDK sync (tree `3bcc83c7b68`, shared with protected-message-history) | `packages/sdk/js/src/v2/gen` |
| `41fa9fd498` | 2026-11-27 | Persist and inherit the preference | `session/session.ts`, `session/cybersec-preservation.ts` |
| `95695a8e4b` | 2026-11-27 | Probe availability with the preference | `provider/meridian-routing.ts` |
| `28d122d55a` | 2026-11-27 | Manifest tests check membership, not counts | `schema/test/event-manifest.test.ts` |
| `82a49540bc` | 2026-11-27 | Owner HTTP routes and event | `httpapi/groups/session.ts`, `handlers/session.ts` |
| `940e6f8310` | 2026-11-27 | Docs | `web/src/content/docs/tui.mdx`, `models.mdx`, `keybinds.mdx` |
| `039ee127bf` | 2026-11-27 | Apply to Claude inference, native runtime included | `provider/meridian-attribution.ts`, `session/llm.ts` |
| `d7791f0cd8` | 2026-11-27 | TUI controls | `tui/src/component/dialog-model.tsx`, `dialog-cybersec.tsx` |
| `7ae4ed6c14` | 2026-11-28 | Bind native startup sessions to the local worker | `cli/tui/worker.ts`, `tui/src/app.tsx` |
| `92bd7e687a` | 2026-11-28 | Keep model search through the picker | `tui/src/ui/dialog-select.tsx` |
| `a11512ad30` | 2026-11-28 | Keep the active model marker | `tui/src/component/dialog-model.tsx` |

## Verification

- hania-arch, MemoryMax 6G, one suite at a time: engine 142/142, real PTY ownership 9/9, TUI 18/18, schema manifest 5/5; typecheck clean for opencode, tui, schema, client and sdk; docs build passed. Reviewed by ses_ef8235798ffejGr4sa22eXmVNv.
- Live header check on desktop after install: TBD (ses_de035e532ffeOhT5WiU3NqlcTb).
