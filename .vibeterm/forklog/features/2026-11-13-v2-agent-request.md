# Selected-agent request defaults on v2

## Identity

- Status: active. Source integration: `v2-nowaker`; provenance: `dev-nowaker`.
- Development branch: `agent-defaults`. First/current source commit: `311b1a74ba`.
- Upstream base when introduced: `v2.2.7`, `fedc6f208aa2bd54c1019227214568083f6380ad`. Last independent live-upstream comparison: TBD.

## Original request and goals

The exact original request is not recovered in this record. The reconstructed assignment is to make configured selected-agent request settings, headers and body reach the native provider while preserving hook override precedence, document merging and absent-setting behavior. The [delivery session](../sessions/2026-11-13-v2-plugin-controls.md#agent-request-selection-and-reader-cancellation) records source, review and actual provider evidence.

## Rationale and constraints

- `/api/agent` exposed the configured temperature while the provider received its own default. Request settings must survive canonical Config decoding and native request preparation.
- Apply agent defaults before hooks and clone mutable settings so one request's hook cannot mutate the agent configuration for a later request.
- Preserve native provider defaults for omitted fields. Do not add a capability, provider fallback, v1 adapter or separate request registry.

## Changes

- `311b1a74ba`, 2026-11-13: retain optional request settings and merge configured documents in native order. Stable seams: `packages/schema/src/config/provider.ts`, `packages/core/src/config/plugin/agent.ts`.
- `311b1a74ba`, 2026-11-13: seed every native generation key before Session hooks; merge agent headers before model-request hooks and retain final body precedence. Stable seams: `packages/core/src/session/model-request.ts`, `model-request-options.ts`, `GENERATION_KEYS`.

## Verification

- W1 and its implementation worker report 67 Core tests/250 assertions, 11 schema tests/37 assertions, affected types and diagnostics clean. Seven owner mutations fail and source bytes are restored. Public Config clients regenerate twice with no changes on the second run.
- A real native request fixture exposes temperature 0.73 through `/api/agent`; the unchanged owner sends `[1, 0.29, 1]`, the corrected owner sends `[0.73, 0.29, 1]` for configured, hook-overridden and omitted settings. This is the fixture provider's absent-setting default, not a universal provider default.
- The actual installed binary prepares requests on desktop vt-28 and m4max vt-30; both provider witnesses receive `[0.73, 0.29, 1]`. Exact receipts and the source-loaded fixture boundary are recorded in the delivery session.
- Primary, compaction, title and generate requests share the corrected preparation. Tests also exercise header/body/nested merge and clone isolation.

## Timeline

- 2026-11-13 [W1 delivery](../sessions/2026-11-13-v2-plugin-controls.md#agent-request-selection-and-reader-cancellation), [ses_e3832b1b0ffe6q98OeUzhgqhjQ](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ), publishes the correction and verifies both native installations and provider outcomes.

## Current maintenance notes

- Keep Config's optional `Provider.Request.settings` and generated public clients aligned. Regenerate through `packages/client`, never edit derived artifacts directly.
- Preserve precedence across all native request paths: selected-agent defaults, awaited hook overrides, then existing final body handling. Run `packages/core/test/session-agent-request.test.ts` and `packages/core/test/config/agent.test.ts` from the package with isolated HOME/XDG and database paths.
