# 15 - Textual attachments go to the model as text, never as provider files (v1)

Status: PREPARED, NOT FILED. The three-slot cap is full (see [00-open-slots](00-open-slots.md)). Queue order: after entries 10, 11, 12, 13 and 14. No PR, issue or comment was posted.

- Target: `anomalyco/opencode:v1`. Branch [`Nowaker:textual-attachments-upstream`](https://github.com/Nowaker/opencode/tree/textual-attachments-upstream), [`199a44640e`](https://github.com/Nowaker/opencode/commit/199a44640e813d6c6ca0e00a6e3a161d624236b1), on both fork mirrors, one commit, 5 files +115/-7. Not merged anywhere.
- Base: upstream `v1` `c618499abc` (v1.19.6), checked with `git ls-remote github` 2026-11-25.
- Fork counterpart: [`ffe9161`](https://github.com/Nowaker/opencode/commit/ffe91611e135e70d5ac13de5a0e2f8e75145ee60) on `dev-nowaker`, installed on desktop as `1.19.5-vt-612-006d837c50`. Same source change, adapted to upstream's `media.ts` (no fork HEIF code).
- Incident: 2026-11-25, one `data:text/markdown` attachment in [`ses_2067af02f0018YmbbmIJmy3dKJ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_2067af02f0018YmbbmIJmy3dKJ) (message `msg_21507eb26001VSIm8s7wB0zau7`) made every later Anthropic turn fail with `'media type: text/markdown' functionality not supported.` The mime came from the Portal draft upload through vibeterm-api, which passes the client's `Content-Type` through.
- Owner: [coordinator `ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv).

## Related upstream items (read 2026-11-25)

- [#54798](https://github.com/anomalyco/opencode/issues/54798) (closed completed 2026-10-21): the same failure class for TOOL results; fixed by tool-attachment PRs such as [#56478](https://github.com/anomalyco/opencode/pull/56478) and [#57640](https://github.com/anomalyco/opencode/pull/57640). User file parts were not covered.
- [#59644](https://github.com/anomalyco/opencode/issues/59644) (open): an `application/octet-stream` tool result still breaks the session. Tool path, not this one.
- [#59249](https://github.com/anomalyco/opencode/pull/59249) (open, base `dev`, `packages/core/src/session/model-request.ts`): v2 core equivalent for media parts without a modality. Does not touch v1.
- [#38794](https://github.com/anomalyco/opencode/issues/38794) (closed not planned): an @file mention sent as `application/octet-stream` hit the same Anthropic error from the user-part path. Reference it in the body.

## Title

`fix(opencode): send textual attachments as text, never as provider files`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

Related: #38794 (same error from a user attachment, closed not planned) and #54798 (the tool-result side, already fixed).

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

A `data:` attachment is decoded into text only when its mime is exactly `text/plain`. Any other textual type (`text/markdown`, `application/json`, ...) goes to the model as a file part, and providers accept only a few file types: `@ai-sdk/anthropic` throws `UnsupportedFunctionalityError` for anything but `image/*`, `application/pdf` and `text/plain`. The part replays from history, so one Markdown upload makes every later turn of the session fail.

- `util/media.ts` gains `isTextAttachment`: `text/*`, `application/json|xml|yaml|x-yaml` and `+json`/`+xml` types.
- At admission (`session/prompt.ts`) every textual `data:` attachment is decoded into the Read-call and content text parts the way `text/plain` already is; the original file part and its mime are kept.
- At replay (`session/message-v2.ts`) a textual file part is sent as its decoded text unless the message already carries that text, and a file part that is neither textual nor image, PDF, audio or video becomes the existing `[Attached <mime>: <filename>]` placeholder. Sessions written before this fix replay too.

### How did you verify your code works?

- New test in `test/session/prompt.test.ts`: a `text/markdown` data attachment reaches the model as text, with no file part in the request. Fails without the source change.
- New test in `test/session/message-v2.test.ts`: an older history holding a textual or unsupported attachment replays as text or the placeholder. Fails without the source change.
- `bun run test test/session/message-v2.test.ts test/session/prompt.test.ts`: 106 pass, 1 skip, 0 fail. `bun typecheck` in `packages/opencode` passes.
- The same change runs on our fork; the session that hit the error works again after repair.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Before filing

Re-check upstream `v1`; if it moved, rebase and rerun the two test files and the typecheck there. Re-check #59644 and #59249 in case upstream fixed the user-part path in the meantime. Decide whether the upstream commit keeps its AI trailers (see entry 14). Check that a slot is free.
