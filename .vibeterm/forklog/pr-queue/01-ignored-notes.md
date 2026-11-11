# 01 - Ignored synthetic session notes on v2

Status: READY ARTIFACT AND PUSHED HEAD; FILING HELD. The issue link, source, docs, verification and review are prepared. Filing requires explicit authorization and an available slot; the three-slot cap is currently full.

- Repository and base: `anomalyco/opencode`, `dev` at `7bac5bad02f68b95fc5c2c022252c0635ea61abe`.
- Head: `Nowaker:v2-ignored-notes`, `92688cd11664dc80ea76d0fb6ed285a540a04932` (seven commits above the cut point).
- Mirror evidence: ordinary pushes succeeded; `git ls-remote` at `2026-11-11T12:26:07Z` independently returned this exact head for both `origin` and `nowaker-github`. No PR command was executed.
- Current upstream preflight: `dev` advanced to `611cee9d4b667b459f19ca0cbf6e76d8647535fb` during preparation. Its two commits touch provider startup tests/code and a release verification script, with no overlap with this port. `git merge-tree --write-tree` succeeds (combined tree `ddefa8ad8a3b0fc060d529b704950539b9a72751`). Tests below bind the original cut plus this head, not a separately executed merge with the newer tip.
- Live-ref check: `2026-11-11T12:12:12Z`, using `git ls-remote`; path-set intersection between upstream changes since the cut and this head is empty (0 paths). The unchanged head follows the main coordinator's approved no-overlap procedure.
- Source: `v2-nowaker` commit `0c5519ba2298f1eb486064f27a198b829ef5ff4a`. The upstream port excludes the fork README, storage namespace, event-persistence default and replay endpoint patches; neither entry 02 nor the Phase 7 candidates is a prerequisite.
- Existing issue: [#48644](https://github.com/anomalyco/opencode/issues/48644), verified open through the public REST API on November 11, 2026. It specifically requests human-visible notices that neither start execution nor enter model or compaction context.
- Documentation: `packages/client/README.md`, synthetic-note API contract descriptions, generated Promise/Effect clients and `packages/protocol/openapi.json`.
- Source worker and retained evidence: [ses_e35cbcb2bffeoDDGvLN89nQ7Uz](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35cbcb2bffeoDDGvLN89nQ7Uz), worktree `v2-ignored-notes`, `tmp/evidence.json`.
- Queue owner: [ses_e35d3b407ffeoWf7J2yaxy1Vzp](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35d3b407ffeoWf7J2yaxy1Vzp).
- Review: [ses_e35949debffepIhx8xTzkrHtmb](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35949debffepIhx8xTzkrHtmb) closed both findings at `92688cd11664dc80ea76d0fb6ed285a540a04932`, with no remaining correctness findings. The separate Protocol OpenAPI artifact is regenerated and both new SDK examples use the singular `session` namespace. Runtime and tests are unchanged from the reviewed source.
- Baseline limitation: the full v1 migration suite has 38 passing cases and one project-recency attribution failure (expected three rows, received two). The same failure reproduced with the exact base migration source; the 19 migration transformation cases pass with this port. No suppressed or weakened test.
- PR illustration: [ses_e358496a2ffe9cwz0l26noBaVQ](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e358496a2ffe9cwz0l26noBaVQ) rendered and inspected the 240x72 SVG in light, dark and mid-animation states. XML and size checks passed; the reduced-motion still remains meaningful. The desktop sanitizer allowlist was checked manually, not executed. This illustration is not an application screenshot.

## Title

`fix(core): restore ignored synthetic session notes`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

Closes #48644

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [x] Documentation

### What does this PR do?

Restore UI-only session notices through `session.synthetic({ ignored: true })`. The note is stored and published immediately, rendered in the web and terminal timelines, and excluded from model input and compaction context. It does not enter the inbox or wake execution, even when `resume` is true. A supplied description is shown; otherwise the note text is shown.

Normal synthetic input keeps its existing behavior. A retried synthetic ID retains its first saved payload, so a retry cannot turn an ignored notice into model input. V1 migration also preserves ignored text as visible notes without sending it to the model.

The client documentation explains the option, retry behavior and data visibility. This restores an explicit per-message behavior; it introduces no new default or global flag.

### How did you verify your code works?

Tests use isolated homes and data, real local HTTP handlers, and production timeline components:

- Core: `bun run script/test.ts test/session-owned.test.ts test/session-runner-message.test.ts test/session-compaction.test.ts` - 95 pass; migration transformation cases - 19 pass.
- Server: `bun test test/session-admit-location.test.ts` - 1 pass. The new HTTP assertion fails on the base because `ignored` is dropped.
- Session UI: projection tests - 63 pass; browser notice component tests - 2 pass. TUI fetched-history and live-event tests - 5 pass.
- Client suite - 259 pass; client build and seven affected package typechecks passed. Client and Protocol regeneration checks reproduce the committed artifacts.

Removing the provider or retained-compaction exclusion independently makes its regression fail. The full migration suite retains one unrelated project-recency failure, also reproduced with the base migration source (38 pass, 1 fail).

### Visual

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="72" viewBox="0 0 240 72" fill="none" stroke="currentColor" font-family="system-ui, sans-serif" text-anchor="middle">
  <title>A notice is shown to you but kept out of what the model sees</title>
  <rect x="8" y="14" width="76" height="28" rx="14" fill="currentColor" fill-opacity="0.08" stroke-width="1.5"/>
  <text x="46" y="32" font-size="12" font-weight="600" fill="currentColor" stroke="none">Notice</text>
  <text x="46" y="60" font-size="10" fill="currentColor" fill-opacity="0.6" stroke="none">shown</text>
  <line x1="90" y1="28" x2="136" y2="28" stroke-width="1.5" stroke-dasharray="3 4" stroke-opacity="0.45"/>
  <line x1="144" y1="16" x2="144" y2="40" stroke-width="2" stroke-linecap="round">
    <animate attributeName="stroke-opacity" values="1;1;0.4;1;1" keyTimes="0;0.5;0.6;0.75;1" dur="2.4s" repeatCount="indefinite"/>
  </line>
  <circle cx="92" cy="28" r="3" fill="currentColor" stroke="none" opacity="0">
    <animateTransform attributeName="transform" type="translate" values="0 0;44 0;44 0" keyTimes="0;0.55;1" dur="2.4s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.1;0.5;0.62;1" dur="2.4s" repeatCount="indefinite"/>
  </circle>
  <rect x="156" y="14" width="76" height="28" rx="6" stroke-width="1.5" stroke-opacity="0.6"/>
  <text x="194" y="32" font-size="12" font-weight="600" fill="currentColor" fill-opacity="0.6" stroke="none">Model</text>
  <text x="194" y="60" font-size="10" fill="currentColor" fill-opacity="0.6" stroke="none">not sent</text>
</svg>
```

### Screenshots / recordings

Browser component assertions and real TUI renderer tests cover notice visibility. No application screenshot or recording is attached.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Filing command - prepared, authorization and free slot required

Requires Bash and `gh` on the filing host. The existing private env file supplies the classic token; no credential value is stored here. This extracts the complete body from this canonical file.

```bash
(
  source /home/nowaker/projekty/nowaker/env
  GH_TOKEN="${GITHUB_TOKEN_CLASSIC_PUBLIC_REPO:?Classic public-repo token is required}" gh pr create \
    --repo anomalyco/opencode --base dev --head Nowaker:v2-ignored-notes \
    --title 'fix(core): restore ignored synthetic session notes' \
    --body-file <(awk '/^<!-- BEGIN PR BODY -->$/{body=1;next}/^<!-- END PR BODY -->$/{exit}body' /home/nowaker/projekty/webapps/opencode/.vibeterm/forklog/pr-queue/01-ignored-notes.md)
)
```
