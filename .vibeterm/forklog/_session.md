# <Session title>

Use this template for one coding-agent session and user workday. Copy it to
`sessions/YYYY-MM-DD-short-title.md`. Create a record even when an upstream
bump carries every customization forward unchanged.

## Identity

- Workday: YYYY-MM-DD
- Session: `ses_<full-id>`
- Agent/platform: `<agent>` / `<platform>`
- Repository: `<absolute or repository-relative identity>`
- Integration branch: `master-nowaker`
- Development branch(es): `<branch or direct integration work>`
- Upstream base: `<commit and tag>`
- Source result commit(s): `<merge, rebase, or feature commits>`
- Forklog commit: this file's introducing commit

## User requests

Quote the requests that define this session's scope verbatim.

> <verbatim prompt>

## Goals

- <observable outcome>

## Constraints and non-goals

- <explicit exclusion or operational constraint>

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `<repo>` | `<branch>` | `<commit>` | `<commit>` | <merge, rebase, or commit> |

## Features touched

Link every feature this session changed or re-verified. The feature links back
to this record from its timeline.

| Feature | Outcome | Evidence |
|---|---|---|
| [<feature>](../features/YYYY-MM-DD-short-title.md) | preserved | <test or diff> |

## Other delivered work

- <tooling, configuration, or package work outside the OpenCode feature list>

## Verification

- `<command>` - <observed result>
- Manual surface: <what a user did and observed>

## Build and install

- Build command: `<command or not run>`
- Installed artifact: `<version, inode, or not installed>`
- Running services: <PID/start-time result, or not applicable>

## Commit provenance

- `<commit>` - <result>
- Required trailer: `AI-Session-ID: ses_<full-id>`

The record cannot contain its own eventual commit hash. Resolve it with:

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/YYYY-MM-DD-short-title.md
```

## Historical evidence carried forward

- <older fact moved from a retired pseudo-feature or index>

## Unknowns and blocked verification

- <TBD, explicit failed search, unavailable check, or `None`>
