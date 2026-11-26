# Textual attachments sent as text

## Identity

- Workday: 2026-11-25
- Session: [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv)
- Agent/platform: opencode coordinator (anthropic/claude-opus-5-5) / linux desktop
- Repository: `Nowaker/opencode`
- Integration branch: `dev-nowaker`
- Development branches: `textual-attachments` (fork), `textual-attachments-upstream` (upstream candidate)
- Upstream base: `github/v1` `c618499abc` (v1.19.6)
- Source result commits: [`ffe9161`](https://github.com/Nowaker/opencode/commit/ffe91611e135e70d5ac13de5a0e2f8e75145ee60) (fork), [`199a44640e`](https://github.com/Nowaker/opencode/commit/199a44640e813d6c6ca0e00a6e3a161d624236b1) (upstream candidate)
- Forklog commit: this file's introducing commit

## User requests

Reported through the Meridian coordinator [`ses_fe8a27c6effe6KEx3TRNvOLgUo`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_fe8a27c6effe6KEx3TRNvOLgUo): every turn of [`ses_2067af02f0018YmbbmIJmy3dKJ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_2067af02f0018YmbbmIJmy3dKJ) failed with `'media type: text/markdown' functionality not supported.` after one Markdown upload (message `msg_21507eb26001VSIm8s7wB0zau7`).

## Goals

- A textual attachment of any common type reaches the model as text.
- A history already holding such a file part replays without a provider error.

## Constraints and non-goals

- The victim session was hand-repaired by the Meridian coordinator; its undo record lives under `recoveryDir()/markdown-attachment-repair/` and is not touched here.
- Tool-result attachments are out of scope (upstream fixed those for #54798).

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `Nowaker/opencode` | `dev-nowaker` | parent of `ffe9161` | `ffe9161` | commit, landed on both mirrors |
| `Nowaker/opencode` | `textual-attachments-upstream` | `c618499abc` | `199a44640e` | commit, pushed to both mirrors |

## Features touched

No existing feature record covers attachment conversion; none was changed.

## Other delivered work

- Upstream candidate queued as [pr-queue entry 15](../pr-queue/15-textual-attachments.md).

## Verification

- `isTextAttachment` (`src/util/media.ts`) covers `text/*`, `application/json|xml|yaml|x-yaml`, `+json`/`+xml`.
- Fork: the new prompt test and replay test both fail on the old code; three suites 158 pass / 1 skip / 0 fail; typecheck clean.
- Upstream candidate: both new tests fail with `src` stashed; `test/session/message-v2.test.ts` + `test/session/prompt.test.ts` 106 pass / 1 skip / 0 fail; `bun typecheck` exit 0.

## Build and install

- Build command: `systemd-run --user ... bash .vibeterm/build.sh` from the primary checkout; v2 guard gate PASSED.
- Installed artifact: desktop `1.19.5-vt-612-006d837c50` (previous binary archived as `opencode.prev-1795655895`). m4max not installed (travel freeze).
- Running services: tabs pick up vt-612 as they restart.

## Commit provenance

- `ffe9161` - fork fix
- `199a44640e` - upstream candidate
- Required trailer: `AI-Session-ID: ses_ef8235798ffejGr4sa22eXmVNv`

## Unknowns and blocked verification

- m4max install waits for the travel freeze to lift.
- The Portal client that set `text/markdown` was inferred from vibeterm-api passing the request `Content-Type` through (`vibeterm-api/drafts.ts`); not reproduced in Portal.
