# 04 - Skip doom-loop permission for provider-executed tools

Status: HEAD VERIFIED AND PUSHED; FILING BLOCKED - no linked upstream issue has been verified. All three upstream PR slots are occupied. Opening a PR or issue requires separate authorization.

- Repository and base: `anomalyco/opencode`, `v1` at `006d837c5022ea5278162307c04c78412cfae9f3`.
- Head: `Nowaker:doom-loop-upstream`, `a9e993aeee1dcfb25fae344419ae4b1e308549a1`.
- Cut point and merge base: `006d837c5022ea5278162307c04c78412cfae9f3`; one upstream-scoped commit.
- Current upstream preflight: `v1` advanced to `acc8c26da40f918e1ce222cb03c3342242c3ed6a` during preparation. The two intervening commits change CI and image-history/provider-error handling, not this port's processor or tests. `git merge-tree --write-tree` succeeds (combined tree `3db64c80d2518aff46bd0f0a04087a01ec49c9c9`). The focused QA below binds the original cut and exact head, not a separately tested latest-base merge.
- Live-ref check: `2026-11-11T12:12:12Z`, using `git ls-remote`; path-set intersection between upstream changes since the cut and this head is empty (0 paths). The unchanged head follows the main coordinator's approved no-overlap procedure.
- Remote evidence: `git ls-remote` verified this exact head on both `origin` and `nowaker-github` on November 11, 2026. The GitHub head already existed; this session pushed the matching branch to `origin` with normal hooks (30/30 typecheck tasks passed).
- Scope: `packages/opencode/src/session/processor.ts` and its processor-effect tests. No forklog, configuration or unrelated fork customizations in the upstream range.
- Documentation: no new public setting or command; the PR body describes the provider/client distinction. The branch has no user-doc file changes.
- Queue owner: [ses_e35d3b407ffeoWf7J2yaxy1Vzp](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35d3b407ffeoWf7J2yaxy1Vzp).
- QA harness correction: an initial isolated run disabled the test's project config and failed with the fixture model missing. The successful 19-test run restored fixture config while keeping HOME, XDG, temporary and tool-data paths isolated. No source change was required.
- Issue search evidence: a public API search for `repo:anomalyco/opencode is:issue doom_loop tool_search` returned zero results. A `doom providerExecuted` query returned an unrelated tool-call repair issue. No matching issue is inferred from either query.

## Title

`fix(opencode): skip the doom_loop ask for provider-executed tool calls`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

No existing issue has been verified for this bug. Filing is blocked until an issue is selected or its creation is authorized; no issue number is implied here.

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

The doom-loop guard asks permission after three identical tool calls. A provider-executed tool has already run before opencode receives the call, so asking permission cannot prevent it; it only stalls the turn.

Skip that guard when the persisted tool part is marked `providerExecuted`. Client-executed tools keep the existing guard. This covers hosted tools such as `tool_search` and `web_search` without special-casing tool names.

### How did you verify your code works?

`bun run test test/session/processor-effect.test.ts` from `packages/opencode` on this exact head: 19 pass, 0 fail. The processor consumes an LLM event stream and records permission asks: three provider-executed calls produce no doom-loop ask, while three identical client calls still produce exactly one.

`bun typecheck` in `packages/opencode` passed. The test run used isolated HOME, XDG, temporary and tool-data roots with the test's own project config.

### Screenshots / recordings

Not a UI change.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Filing command - prepared, do not execute while blocked

Requires Bash and `gh` on the filing host. The credential comes from the existing private env file and is never written into this artifact. Extracting the body uses this same canonical file; it requires no new prose.

```bash
(
  source /home/nowaker/projekty/nowaker/env
  GH_TOKEN="${GITHUB_TOKEN_CLASSIC_PUBLIC_REPO:?Classic public-repo token is required}" gh pr create \
    --repo anomalyco/opencode --base v1 --head Nowaker:doom-loop-upstream \
    --title 'fix(opencode): skip the doom_loop ask for provider-executed tool calls' \
    --body-file <(awk '/^<!-- BEGIN PR BODY -->$/{body=1;next}/^<!-- END PR BODY -->$/{exit}body' /home/nowaker/projekty/webapps/opencode/.vibeterm/forklog/pr-queue/04-doom-loop.md)
)
```

The main coordinator must resolve the issue gate, approve filing and confirm a free slot before this command is used. The current known open PRs are [#54578](https://github.com/anomalyco/opencode/pull/54578), [#63062](https://github.com/anomalyco/opencode/pull/63062), and [#63063](https://github.com/anomalyco/opencode/pull/63063).
