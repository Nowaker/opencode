# 02 - Opt-in atomic session metadata merge on v2

Status: REVIEWED ARTIFACT AND PUSHED HEAD; FILING BLOCKED. Filing requires explicit authorization, a free slot and upstream feature-design acceptance. No upstream acceptance of atomic metadata merging has been verified.

- Repository and base: `anomalyco/opencode`, `dev` at `7bac5bad02f68b95fc5c2c022252c0635ea61abe`.
- Head: `Nowaker:v2-metadata-merge`, `421b573fcdb34d225e0ad6b57c73e132e60cd852`.
- Mirror evidence: ordinary pushes succeeded; `git ls-remote` at `2026-11-11T12:26:07Z` independently returned this exact head for both `origin` and `nowaker-github`. No PR command was executed.
- Current upstream preflight: `dev` advanced to `611cee9d4b667b459f19ca0cbf6e76d8647535fb` during preparation. Its two commits touch provider startup tests/code and a release verification script, with no overlap with this port. `git merge-tree --write-tree` succeeds (combined tree `ab321f32c1132a76a86b95b66984413f93120a1c`). Tests below bind the original cut plus this head, not a separately executed merge with the newer tip.
- Live-ref check: `2026-11-11T12:12:12Z`, using `git ls-remote`; path-set intersection between upstream changes since the cut and this head is empty (0 paths). The unchanged head follows the main coordinator's approved no-overlap procedure.
- Source: `v2-nowaker` commit `8c859a94ca013bb2c26782e0f41dc0acaa17b89a`. The upstream port independently regenerates clients and excludes the fork README and replay/storage changes. No dependency on entry 01 or either Phase 7 candidate.
- Related context: [#40384](https://github.com/anomalyco/opencode/issues/40384) requests session metadata support. It has not been verified as a request or design approval for atomic merge; it is not presented as an issue this change closes.
- Documentation: `services/site/src/docs/content/build/client/index.mdx`, experimental field description, generated client contracts and Protocol OpenAPI. The docs build produced 664 pages.
- Source worker and evidence: [ses_e35cb79ebffeIWU7xYBkioi4Lf](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35cb79ebffeIWU7xYBkioi4Lf), worktree `v2-metadata-merge`, `tmp/delivery-evidence.json` and `tmp/delivery-state.log`.
- Queue owner: [ses_e35d3b407ffeoWf7J2yaxy1Vzp](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35d3b407ffeoWf7J2yaxy1Vzp).
- Review: [ses_e35949debffepIhx8xTzkrHtmb](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35949debffepIhx8xTzkrHtmb) approved the exact `421b573fcdb34d225e0ad6b57c73e132e60cd852` candidate and final evidence ledger, with no remaining correctness or fork-dependency findings.
- Verification limits: full monorepo checks and Windows execution were not run. A selected client import-boundary test timed out under concurrent load and passed alone at the unchanged head. An optional external audit could not load its TypeScript API; repository-native checks passed.

## Provenance correction - original commits preserved

Each commit below incorrectly records `AI-Harness: Vibeterm 4e3d571e8e8`; the actual worker harness was `Vibeterm ec13632a5db`:

- `803aef1f4de2e4ea0ed74bd9cd506f0577d49b3f` - prepared durable events.
- `e4a8e761747094ae6784f6e03bafe7356c9ac6c0` - atomic metadata merge.
- `421b573fcdb34d225e0ad6b57c73e132e60cd852` - experimental HTTP contract and docs.

Source of the correction: the worker identified its mandatory session context in its handoff, recorded both values in `tmp/delivery-evidence.json` under `provenance`, and confirmed the unchanged full commit IDs in its final report linked above. The queue owner inspected the commit trailers and evidence manifest. The main coordinator explicitly directed a canonical correction without rewriting history on November 11, 2026. The original trailers are not claimed accurate; no amend, rebase or force-push was performed.

## Title

`feat(core): support experimental atomic session metadata merge`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

Related to #40384. That issue concerns session metadata generally; upstream design acceptance of this atomic merge option has not yet been established. Filing remains held for that acceptance.

### Type of change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor / code improvement
- [x] Documentation

### What does this PR do?

Add `experimental.metadataMode: "merge"` to session updates. It applies RFC 7396 JSON Merge Patch: objects merge recursively, null deletes members, and arrays or scalar members replace their prior values. Metadata still replaces the whole record by default, including literal null members. Omitting metadata leaves it unchanged.

The Bus prepares the full resulting metadata inside its immediate write transaction, so concurrent writers cannot both merge against a stale read. The existing metadata event still contains the complete resulting record; projection and replay semantics stay unchanged.

The selector lives under `experimental` because the HTTP API generator cannot represent the alternative payload schemas needed for a Content-Type switch. `server.info` advertises support through `capabilities.sessionMetadataMergePatch`; the client docs show capability detection and both merge and replacement. The option is explicit and experimental, with no new default behavior or global flag.

### How did you verify your code works?

- Core: `bun run script/test.ts test/bus-prepared.test.ts test/session-metadata.test.ts test/session-create.test.ts test/bus.test.ts` - 129 pass, including rollback, typed failures, notification order, replacement compatibility and full-result replay.
- Server: `bun test test/session-metadata-merge.test.ts test/session-metadata-concurrent.test.ts` - 9 pass. Two independent loopback server processes share SQLite and preserve 96 PATCH requests across 32 concurrent rounds.
- Protocol suite - 14 pass. Selected client cases - 56 passing cases across the final runs; the import-boundary timeout passed when rerun alone.
- Core, Protocol, Server, Client and Site typechecks passed; the docs build produced 664 pages. Regeneration reproduced all nine committed artifacts.

Moving preparation outside the transaction makes five Core checks and the real HTTP race fail. The source was restored byte for byte afterward. No live database or service was used.

### Screenshots / recordings

Not a UI change.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Filing command - prepared, do not execute while blocked

Requires Bash and `gh` on the filing host. The existing private env file supplies the classic token; no credential value is stored here. This extracts the complete body from this canonical file.

```bash
(
  source /home/nowaker/projekty/nowaker/env
  GH_TOKEN="${GITHUB_TOKEN_CLASSIC_PUBLIC_REPO:?Classic public-repo token is required}" gh pr create \
    --repo anomalyco/opencode --base dev --head Nowaker:v2-metadata-merge \
    --title 'feat(core): support experimental atomic session metadata merge' \
    --body-file <(awk '/^<!-- BEGIN PR BODY -->$/{body=1;next}/^<!-- END PR BODY -->$/{exit}body' /home/nowaker/projekty/webapps/opencode/.vibeterm/forklog/pr-queue/02-metadata-merge.md)
)
```
