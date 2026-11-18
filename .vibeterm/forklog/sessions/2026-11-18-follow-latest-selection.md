# The TUI's pick follows the session's latest agent, model and variant

## Identity

- Workday: 2026-11-18
- Session: `ses_e125a808bffe4hXOhbX6YgWjvL`
- Agent/platform: `opencode (Sisyphus, anthropic/claude-opus-5-5)` / `darwin` (m4max)
- Repository: `Nowaker/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `adopt-latest-model`, `follow-model-bump`
- Upstream base: `006d837c50`
- Source result commit(s): `3f66b2094a`, `69ef861397`, `329b87dfc7`, `031bf5bc24`, `ce2f63eb5f`
- Forklog commit: this file's introducing commit

## User requests

> DAMIAN'S RULE: the last submission wins, from any client.
>
> YOUR PART (fork TUI): when a user message for the current session arrives from another client (bus event message.updated / the sync store, or the equivalent), the TUI adopts its model, variant and agent as the session's current selection, so its next submit and any prompt it injects inherit them. Don't steal the selection while the user is mid-change in the model/agent dialog; a message with no explicit model leaves the selection alone. Session switches still show that session's latest user-message choice.

(Coordinator `ses_ef8235798ffejGr4sa22eXmVNv`.) Added during the session by `ses_e121d0821ffePgkVtkTFCzTEv6` (model-bump system question): also follow a change to the session row's `model` published as `session.updated`.

## Goals

- See [the feature](../features/2026-11-18-follow-latest-selection.md).

## Constraints and non-goals

- Fast-forward/merge only on `dev-nowaker`; push to both remotes; build only through `.vibeterm/build.sh`, one build per host, desktop only behind its memory gate.
- Mechanism agreed with `ses_e12755c8fffesT23uRF27xt4zb` (delivery side, opencode-tools master `26f8e7d`) and `ses_e121d0821ffePgkVtkTFCzTEv6` (model bump writes the session row's `model` column, then re-sends metadata through the owning engine). No `/deliver` model fields, no metadata selection record, no polling.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `Nowaker/opencode` | `dev-nowaker` | `5dbd239fdf` | `ce2f63eb5f` | fast-forward (two landings) |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [The TUI's pick follows the session's latest agent, model and variant](../features/2026-11-18-follow-latest-selection.md) | new | 9 focused tests, two isolated-TUI checks with controls |

## Other delivered work

- Load flakes in the TUI suite: `69ef861397` and `ce2f63eb5f` (keep-scroll waits for the jump and gets a 30 s default; prompt-archive waits for its dialog), `329b87dfc7` (the instant editor's exhaustive parity test gets 60 s; it failed on unmodified `dev-nowaker`).
- [pr-queue entry 11](../pr-queue/11-follow-latest-selection.md), prepared, not filed.

## Verification

- `bun test test/routes/session/adopt-latest-selection.test.tsx` (packages/tui) - 9 pass, 0 fail.
- `bun typecheck` (packages/tui) - clean.
- Full `packages/tui` suite at load average 222 - 906 pass, 1 skip, 1 fail (`prompt-undo`, load-only; 2/2 pass in isolation with and without the change).
- Isolated v1 TUI checks (fake provider, scratch home, throwaway tmux socket): `prompt_async` with another agent/model/variant, and a session-row model bump via `PATCH /session/{id}`. Both pass on the change and fail on the `dev-nowaker` control. Details in the feature record.

## Build and install

- Build command: `bash .vibeterm/build.sh` on m4max, then on desktop, each from its own main checkout at `ce2f63eb5f`, v2 guard gate passing.
- Installed artifact: `1.19.5-vt-535-006d837c50` on m4max and desktop; `grep -c -a OPENCODE_RETRY_MAX_HEADER_DELAY_MS` = 1 on both.
- Running services: none restarted; running TUIs pick it up on their next restart.

## Commit provenance

- `3f66b2094a`, `031bf5bc24` - feature; `69ef861397`, `329b87dfc7`, `ce2f63eb5f` - test fixes.
- Required trailer: `AI-Session-ID: ses_e125a808bffe4hXOhbX6YgWjvL`

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- Desktop was unreachable from m4max for some minutes mid-session (ssh "No route to host"); its build ran once it answered again and passed its memory gate (MemAvailable 41.8 GB, PSI full avg60 1.39).
- Live proofs Portal->TUI, TUI->Portal and vtps `model=` persistence are run with `ses_e12755c8fffesT23uRF27xt4zb` after install.
