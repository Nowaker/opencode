# Let a session fork be a child of another session

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/fork-as-child` (cut from `dev-nowaker` `2506760940`)
- First local commit: `db917f0795`
- Current local commit(s): `db917f0795`, merge `da55aead00`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv), step 6 (A5) of the Claude Code tools package in `opencode-tools/docs/research/2026-11-01-claude-code-tools.md`: "`task` with `subagent_type: \"fork\"`: the child starts from a fork of the parent session, at the current message, and runs on the parent's model." Agreed with [`ses_e3b337fcaffe0lfGD5lOorwhN3`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b337fcaffe0lfGD5lOorwhN3): OMO uses the native `session.fork` with `unsettled: "exclude"`.

## Goals

- A plugin can fork a session into a child of another session, under its own title, with permission rules of its own.

## Non-goals

- No change to a fork without the new fields.
- No faster copy: the fork still replays every message through the event pipeline.

## Rationale and constraints

- `session.fork` made a top-level session titled "(fork #N)", which shows as a sibling of its parent, outside the subagent tree.
- `createNext` already takes `parentID` and `permission`; the fork only passes them on. OMO denies its subagents the question tool through `permission`, as `session.create` does.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `db917f0795` | 2026-11-10 | `ForkInput` takes `parentID`, `title`, `permission` | `ForkInput` and `fork` in `packages/opencode/src/session/session.ts` |
| `db917f0795` | 2026-11-10 | The fork route passes them through | `fork` in `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`; SDK `session.fork` |
| `db917f0795` | 2026-11-10 | Test | `test/session/fork.test.ts` "with a parent, a title and permissions ..." |
| `da55aead00` | 2026-11-10 | Fork merge, no conflicts | - |

OMO `e16f44cb88` (`task(subagent_type: "fork")`) is the consumer.

## Verification

- `test/session/fork.test.ts`: 6 pass; the new test fails with `session.ts` at `2506760940`.
- `test/server/httpapi-session.test.ts`: 27 pass.
- `tsgo --noEmit` clean in `opencode`, `sdk/js`, `tui`; the SDK diff is additions only.
- Live with OMO: see the session record.

## Timeline

- 2026-11-10 [`ses_e3b66e073ffeBjngD0B2e6LCl8`](../sessions/2026-11-10-bash-background.md) - initial build. Evidence: `db917f0795`, merge `da55aead00`.
- 2026-11-11 [`ses_e3b66e073ffeBjngD0B2e6LCl8`](../sessions/2026-11-11-fork-context.md) - `history: "context"` copies only what the next turn reads (latest compaction, its kept tail, what follows); every fork zeroes its copies' cost and tokens. Evidence: `d6ec184270`, merge `13f8d45412`.

## Current maintenance notes

- If upstream adds its own way to fork into a child, compare it with `ForkInput` before keeping this.
- Regenerate the SDK with `./packages/sdk/js/script/build.ts` after touching `ForkInput`.

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
