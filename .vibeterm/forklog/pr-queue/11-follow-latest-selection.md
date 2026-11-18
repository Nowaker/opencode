# 11 - The TUI's pick follows a prompt from another client

Status: PREPARED, NOT FILED - no upstream branch has been cut or pushed and no PR, issue or comment was posted. Filing waits for a free author PR slot (see [00-open-slots](00-open-slots.md)).

- Upstream target line: `v1`. Fork base: `006d837c50` (`v1.19.5`).
- Fork source: `3f66b2094a`, `031bf5bc24` on `dev-nowaker`. Upstream `v1` has the same effect (`packages/tui/src/component/prompt/index.tsx`, "Initialize agent/model/variant from last user message when session changes") and the same `setAgentModel` call in `createUserMessage`, checked on `upstream/v1` 2026-11-18.
- Upstream issue: TBD, none searched yet.
- Scope: the prompt's follow effect and its test. The fork test sits on the fork's `apply-revert` fixture (`choices` option); an upstream port needs an equivalent wire-level fixture.
- Changes an upstream port must make: drop the Vibeterm wording (ticket, model bump) from the comment; keep the dialog hold and the primary-agent check.
- Evidence: [feature record](../features/2026-11-18-follow-latest-selection.md), [session record](../sessions/2026-11-18-follow-latest-selection.md).
- Owner: [`ses_e125a808bffe4hXOhbX6YgWjvL`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e125a808bffe4hXOhbX6YgWjvL).
- Next step, once cleared: cut a branch from the live upstream `v1`, port, run the prompt tests there, and write the filing command here.

## Title

`fix(tui): follow the agent and model of a prompt sent from another client`

## Body

The prompt takes the session's agent, model and variant from its newest user message only when the shown session changes. A prompt sent to the same server from another client (the web app, `opencode run --attach`, an SDK call) leaves the TUI's pick where it was, so the next prompt typed in the TUI runs on the old model, and `createUserMessage` then writes that old model back onto the session.

The pick now follows the session row's `agent`/`model`, which `setAgentModel` keeps current on every submission, and the newest user message's identity; whichever changes moves it. While a dialog is open the move waits, and a pick the person changed in the meantime wins. Only primary agents are taken, a command-line `--agent` is kept, an unknown model is skipped, and a signal that already matches the pick changes nothing.
