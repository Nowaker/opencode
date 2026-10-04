# llm.test's mock queue survives openai's served-model read

## Identity

- Workday: 2026-10-04
- Session: `ses_f01c05e81ffeH39PdmzetO2pyw`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `openai-gateway-parity` (worktree
  `.vibeterm/worktrees/openai-gateway-parity`, re-pointed at `dev-nowaker`)
- Upstream base: `907b3bc518` (upstream `dev`, contains `v1.18.34`); unchanged
- Source result commit(s): `192f58aec9`
- Forklog commit: this file's introducing commit

## User requests

From TUI coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, condensed:

> `packages/opencode/test/session/llm.test.ts` fails 6-7 of 33 on dev-nowaker,
> and passes 33/33 on pristine github/dev 907b3bc518. git bisect names
> eb573a78de [...] Confirm the cause. Then fix it in the feature code if it
> misbehaves for a plain localhost baseURL, or in the test if the new behavior
> is correct and only the mock queue assumption broke. Do not weaken
> assertions. [...] Do NOT build or install on the hosts.

## Goals

- `llm.test.ts` 33/33 and `bun typecheck` clean on `dev-nowaker`.

## Constraints and non-goals

- No build or install; the last TUI lander rebuilds desktop and m4max.
- No force-push of `dev-nowaker`; land by fast-forward.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `ee0a8c04e5` | `192f58aec9` | fast-forward from `openai-gateway-parity`; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [OpenAI Meridian provider clone](../features/2026-09-27-openai-meridian-provider.md) | preserved; test fixed | `llm.test.ts` 33/33 with the fix, 5 OpenAI failures without it |

## Other delivered work

- None.

## Verification

- Cause: a temporary log in the mock server showed `GET /v1/models queued:
  /responses`. The served-model read for `openai` with a configured baseURL
  took the entry queued for the LLM call. The feature behaves as designed
  for any non-default baseURL, so the test mock changed, not the feature.
- `bun test --timeout 30000 test/session/llm.test.ts` (load average 90-127):
  33/33 twice on the final tree; with the fix stashed, 28/33, the 5 failures
  being the OpenAI `/responses` tests at 1.6-7 s, not timeouts. At the
  default 5 s timeout, unrelated Anthropic and custom-provider tests also
  time out under that load.
- `bun typecheck` (packages/opencode) - exit 0.

## Build and install

- Build command: not run, by instruction.
- Installed artifact: not installed.
- Running services: none restarted.

## Commit provenance

- `192f58aec9` - test(opencode): keep llm.test's mock queue for LLM calls behind openai's model read
- Required trailer: `AI-Session-ID: ses_f01c05e81ffeH39PdmzetO2pyw`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-04-llm-test-models-read.md
```

## Historical evidence carried forward

- Bisect to `eb573a78de`: reintegration session `ses_ef81db9cdffe5vRz7Y2HqCmvNs`
  ([record](./2026-10-04-upstream-1.18.34.md)).

## Unknowns and blocked verification

- None.
