# 16 - Preserve a rename during automatic title generation (v1)

Status: PREPARED, NOT FILED. The three-slot cap is full (see [00-open-slots](00-open-slots.md)). This entry follows 15.

- Target: `anomalyco/opencode:v1`, upstream base `c618499abc` (`v1.19.6`). Head: `Nowaker:guard-generated-title`, [`76c1f2055f`](https://github.com/Nowaker/opencode/commit/76c1f2055f).
- Fork counterpart: [`52dc7bbc5e2`](https://gitlab.com/vibeterm/opencode/-/commit/52dc7bbc5e2), which uses the fork's existing immediate patch transaction. The Vibeterm startup title transport is not part of the upstream change.
- Evidence: [fork session record](../sessions/2026-11-26-predefined-spawn-titles.md).

## Title

`fix(session): preserve a rename during automatic title generation`

## Upstream body

<!-- BEGIN PR BODY -->
### What does this change?

If someone renames a session while its automatic first-turn title is still generating, the generated title can overwrite that rename when it finishes. The generated-title path now rechecks the stored title and uses the event's write transaction to discard stale projections. Ordinary manual renames and automatic naming of unnamed sessions keep their behavior.

### How was it verified?

- An HTTP fixture holds the generated title until after a manual rename. On unmodified `v1`, the overwrite appears on the live event feed and in the durable log. With the fix, neither contains the rejected generated title and the manual title stays current.
- `bun --no-env-file test --timeout 30000 test/session/prompt-title.test.ts test/session/session.test.ts`: 10 pass, 0 fail. `bun typecheck` in `packages/opencode` and formatting checks passed.

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

Before filing: recheck upstream v1 and the available slot, then verify the branch against the current base.
