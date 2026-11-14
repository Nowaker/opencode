# Automatic session titles through ChatGPT gateways

## Identity

- Workday: 2026-11-14
- Session: [`ses_e260d756cffeESP9yeZasZMm2X`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e260d756cffeESP9yeZasZMm2X)
- Agent/platform: OpenCode, openai/gpt-6.1-sol / darwin
- Integration branch: `dev-nowaker`; development branch: `fix-title-sampling`
- Source result: `f82e3efdce2`, rebased onto the concurrent pause delivery through `05d3e55825c` without changing the title patch.
- Upstream base: `006d837c50`, release base `1.19.5`.

## User request

> these sessions didn't get their session title generated. figure out why and fix.

The reported sessions are [desktop](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e261519a3ffeFkfolmbhqZgWvK) and [m4max](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e27174c5dffeA2iietysJUO2Jq).

## Cause and delivered behavior

Both hosts logged `Unsupported parameter: temperature` for the `openai/gpt-6-luna` title stream. The direct API catalog advertised temperature support; the built-in title agent supplied `0.5`, which the ChatGPT backend rejected. Gateway providers now normalize temperature support after config and served-model discovery, including fallback. Default OpenAI API URLs and `openai2` retain sampling support. Existing gateway classification is unchanged.

Feature: [OpenAI Meridian provider clone](../features/2026-09-27-openai-meridian-provider.md).

## Verification

- Provider regressions before the fix: 10 failures, four direct API controls passing. Corrected provider suite: 134 tests, 310 assertions, no failures.
- Real `SessionPrompt` regression: removing only the gateway policy produces a title request with `temperature: 0.5`, HTTP 400 and the persisted default title; the direct API control passes. Restoring it passes both cases with 10 assertions. The same tests pass after integrating pause support.
- Desktop: 136 provider/title tests and 320 assertions pass; package typecheck passes. Both pre-push hooks pass all 30 workspace typechecks.
- Source diagnostics are clean; the new title-flow test passes the test-junk audit. Final gate review approves with high confidence.
- Both reported sessions were named through generated titles and the shared writer, preserving activity time: `Quick test and exit` and `Portal Touch ID action note labeling help`.
- The ordinary [Vibeterm demonstration](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e25b005baffekQbOXdaNLE6Dti) received `Title generation test` automatically and answered without tool calls or a supplied title.

## Build and installation

- Canonical `.vibeterm/build.sh` installs m4max `1.19.5-vt-486-006d837c50`; the v1/v2 migration guard passes. The existing uncommitted retry-header cap is preserved.
- A fresh installed m4max process reports Luna temperature support as false. Isolated real HTTP first-turn naming persists `Automatic session title testing` without a temperature rejection.
- Desktop fetched the full committed source from m4max, installed its locked dependencies, passed the native build and migration guard, and installed the same `1.19.5-vt-486-006d837c50`. A fresh isolated HTTP request through its configured real backend also persists `Automatic session title testing` with no temperature rejection.
- Busy TUIs and the default tmux server are not restarted. The version-aware warm pool replaces old idle processes through its existing make-before-break path.
- GitLab and GitHub `dev-nowaker` were independently verified at `f82e3efdce2` after publication. This record's introducing commit carries the full session trailer.
