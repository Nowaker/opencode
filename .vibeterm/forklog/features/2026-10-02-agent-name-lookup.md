# Agent lookup by configured name

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `agent-name-lookup`
- First local commit: `d6665aba3d`
- Current local commit(s): `d6665aba3d`
- Upstream base when introduced: `2fa3363c92` (upstream `dev`, contains `v1.18.33`)
- Last checked against upstream: `907b3bc518` (upstream `dev`, contains `v1.18.34`)

## Original request

Relayed by Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo`, condensed:

> on desktop's opencode 1.18.33-vt-55-2fa3363c92, `opencode run --agent plan
> "<prompt>"` fails with `UnknownError err_e1331eaa`, and nothing is logged
> under that ref. The same run without `--agent` works.

## Goals

- An agent whose config entry sets `name` stays usable: `opencode run --agent
  <key>` and every later turn of that session resolve it.

## Non-goals

- No change to how agents are keyed, listed, or named; the registry stays
  keyed by config key and `list()` still exposes the configured name.
- No change to the user's config: `agent.plan.name = "OC-Plan"` stays.

## Rationale and constraints

- `Agent.get` looked agents up by config key only. `createUserMessage` records
  `ag.name` (`OC-Plan`) on the user message, and the prompt loop, processor
  and tools then call `agents.get("OC-Plan")`, miss, and fail the turn with
  `Agent not found: "OC-Plan". Available agents: ... OC-Plan ...`. Stock
  `/usr/bin/opencode` 1.18.33 and fork `vt-53` fail the same way; upstream
  has had `item.name = value.name ?? item.name` since `01eadf3ded`.
- Bisect in isolated XDG dirs: removing only `agent.plan.name`, or the whole
  `agent.plan` entry, fixes the run; removing OMO or the model-policy plugin
  does not.
- Fixing `get` covers all 17 call sites and messages already persisted with
  the name. Recording the key on the message instead would leave those rows
  broken. Key lookup still wins, so a name that equals another agent's key
  cannot shadow it.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `d6665aba3d` | 2026-10-02 | `get` falls back to the agent whose `name` matches | `get` in `packages/opencode/src/agent/agent.ts`; test "renamed agent resolves by its configured name as well as its key" in `test/agent/agent.test.ts` |

## Verification

- `test/agent/agent.test.ts` - 44 pass; the new test fails without the change.
- `bun typecheck` in `packages/opencode` - exit 0.
- `test/session/prompt.test.ts` + `test/tool/task.test.ts` - 80 pass, 1 fail
  ("drops an interrupted trailing assistant ...", 5 s timeout), which fails
  identically without the change.
- Manual surface, desktop `vt-57`, real config and data:
  `opencode run --agent plan --format json "Reply with exactly: PONG"` -> exit
  0, `PONG`; both messages of `ses_f00f12683ffesLGSvwjEJZge60` carry agent
  `OC-Plan`.

## Timeline

- 2026-10-02
  [`ses_f011ccc18ffeZAKpRC9OjZ40a8`](../sessions/2026-10-02-agent-name-lookup.md)
  - `d6665aba3d`: introduce the fallback; build and install on desktop and
    m4max.
- 2026-10-04 [`ses_ef81db9cdffe5vRz7Y2HqCmvNs`](../sessions/2026-10-04-upstream-1.18.34.md) -
  rebased unchanged onto upstream `dev`
  `907b3bc518` (contains `v1.18.34`). Evidence: that session's gates.

## Current maintenance notes

- If upstream changes `Agent.get`, or starts recording the config key on
  messages, re-run the regression test and re-check whether the fallback is
  still needed.
- Upstreamable as-is.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Run `test/agent/agent.test.ts` and `bun typecheck` in `packages/opencode`.
- Build through `.vibeterm/build.sh` and run `opencode run --agent plan` with
  the desktop config.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
