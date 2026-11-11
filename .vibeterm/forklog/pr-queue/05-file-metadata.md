# 05 - File tool metadata and stale-file checks

Status: BLOCKED - upstream dependency route awaits the existing user decision [qst_1a57627a7001EnfvHzCtQOQwQ2](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1a57627a7001EnfvHzCtQOQwQ2). Do not file or change the dependency route before that decision is resolved. The head is local; it has not been verified as pushed to GitHub. This entry is not ready to file.

- Repository: `anomalyco/opencode`.
- Intended target line: `v1`.
- Upstream base: `006d837c5022ea5278162307c04c78412cfae9f3`.
- Live target check: `v1` at `acc8c26da40f918e1ce222cb03c3342242c3ed6a`, observed by `git ls-remote` at `2026-11-11T12:12:12Z`. No latest-base compatibility or fresh QA claim is made for this route-blocked head.
- Required dependency: `b6bdc91b38`, `fix(opencode): check external_directory on the resolved symlink target`.
- Existing local branch: `file-metadata-upstream`.
- Existing head: `c22174c762888b65497fda63c9d25d0e4bec8743`.
- Feature-only range: `b6bdc91b38..c22174c762888b65497fda63c9d25d0e4bec8743`.
- Full upstream range includes both the symlink permission fix and file metadata. Filing it directly against `v1` would include both changes.
- Documentation: `packages/web/src/content/docs/tools.mdx` documents read metadata, symlink targets, byte sizes, and stale-file behavior for edit, write and apply_patch.
- Filing gates: resolve the linked dependency decision, verify the selected head and its tests, push the selected head, and provide an existing issue required by the v1 contribution guide. No issue number has been verified for this entry.
- Queue owner: [ses_e35d3b407ffeoWf7J2yaxy1Vzp](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35d3b407ffeoWf7J2yaxy1Vzp).

## Proposed title

`feat(opencode): report file metadata and detect stale edits`

## Proposed upstream body

### Issue for this PR

No linked issue has been verified. Filing is blocked by the v1 issue-first requirement and the dependency route decision above.

### Type of change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor / code improvement
- [x] Documentation

### What does this PR do?

File tools report symbolic-link targets, byte sizes, unusual line endings and byte order marks. A directory listing identifies dangling links, and writing through a dangling link is refused rather than silently creating its target.

The session remembers the modification time and size of files it reads or writes, keyed by real path. A later write or patch refuses to overwrite a changed file. An edit can still apply when its exact text matches, with a note that the file changed. A first write does not require a prior read.

The tools documentation describes the output and stale-file behavior. This change depends on checking external-directory permission against a symlink's resolved target.

### How did you verify your code works?

The branch contains regression coverage in the read, write, edit and apply_patch tool suites, plus external-directory tests. Current queue verification is blocked until the dependency route selects the exact filing candidate; no fresh passing test claim is made here.

### Screenshots / recordings

No screenshots or recordings have been collected for this filing candidate.

### Checklist

- [ ] I have tested my changes locally
- [ ] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.

## Filing command

Withheld while the route is undecided. Choosing a base or head here would decide the user's pending dependency question. After that decision, the queue owner must bind the command and verification to the selected candidate before changing this entry to ready.
