# Phase 2 native v1 cross-provider switching

## Identity

- Workday: 2026-11-25 (provenance recorded after the November 20-22 source work and November 22 release).
- Engine and release: [`ses_e03f2641dffexzhoucIQcjpRQC`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e03f2641dffexzhoucIQcjpRQC), OpenCode on m4max. Provider fixture: [`ses_e03f0b962ffe5cfq7DiVn2wyo8`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e03f0b962ffe5cfq7DiVn2wyo8). Engine matrix: [`ses_e03e10d1fffe6V0NNnvfiu5YAg`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e03e10d1fffe6V0NNnvfiu5YAg).
- Coordination: [release coordinator](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e043139c8ffefHb1ufDvWhIfc8), [Meridian coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_fe8a27c6effe6KEx3TRNvOLgUo), [fork audit owner](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_eeda1d251ffel81U5Y42j4kb33).
- Repository: OpenCode fork; integration `dev-nowaker`; source branch `cross-provider-v1`; documentation worktree `phase-two-forklog`. Upstream v1 base `006d837c50` (`v1.19.5`). Forklog commit: this record's introducing commit.
- Feature: [Meridian refusal parking and bidirectional recovery](../features/2026-11-16-park-no-routable-account.md#native-v1-cross-provider-switching-phase-2). The [Phase 1 record](./2026-11-20-cross-provider-switch.md) remains Claude-origin only.

## Behavior and stable seams

- When the managed policy allows it, a GPT-origin step refused before inference because the ChatGPT pool is exhausted or held by reserve can continue once on the approved same-tier Claude route with fresh allowance. It stays in the same turn: no new user message, no rerun of a completed tool, and no rewrite of the preferred route. The existing controls can distinguish serving from preferred. If return is enabled, a new submission admitted after clean idle can use the exact saved preferred provider, model and effort after a fresh allowance check; it does not reverse-map the alternate or switch during the running turn.
- `packages/opencode/src/provider/meridian-routing.ts`, `meridian-refusal.ts` and `session/llm.ts`: only a direct trusted HTTP 429 JSON response for the first request can attest the GPT refusal. Match the local `x-meridian-route-refusal: 1` response marker, request UUID, exact serialized model and effort, provider, and `before_inference`/`sent: false`. Missing or mismatched evidence cannot authorize alternate inference. The dispatch fence uses the actual provider in either direction, checks the exact wire effort from the registered variant, and blocks explicit Meridian profile pins.
- `packages/opencode/src/session/prompt.ts` and `auto-switch.ts`: the owner rechecks admission, current policy revision, permissions and exact route before dispatch and retains the original park when no alternate is claimed. Policy supplies candidate tuples through `reverse-routing-v1` and the registered catalog; this fork does not hardcode the managed family map. The Hephaestus-to-Sisyphus direction requires exact configured routes and affirmative authorization from the existing OMO hook; other eligible agents retain their identity.
- `packages/opencode/src/session/auto-switch-transcript.ts` and `auto-switch-image.ts`: complete portable tool exchanges can cross with remapped call IDs; private reasoning remains in storage and is omitted from the alternate request. A bounded inline PNG can cross when the destination supports it. Unsupported structured output and insufficient context park with a specific reason rather than truncating or sending the alternate request. `pause.ts` keeps the refused route and uses provider-neutral fallback wording; the existing sanitized switch log identifies the rejection gate without exposing request content.

## Commit provenance

| Full commit | What it records |
|---|---|
| `9cfcece98a467501fec1b595f47416a36be03cc8` | Loopback fixture for provider streams, model discovery, exact availability and attested refusals. |
| `c07807ed5656991a5e72fddc01e5377cdb3d62d4` | GPT-local refusal marker and exact request binding, with real SDK wire tests. |
| `bf958ab69d593bd803a37de025a7d26ffa3534e8` | Ordinary pinned GPT refusal fixture, without attestation. |
| `4ff3315e0ad7f968283ab4a10c04d7047d59ca63` | Same-step GPT-to-Claude continuation, portable history, exact idle return and native matrix. |
| `62f55adb1cc81ab777e596152b6904eb77601f70` | Integrate the Phase 1 stack while keeping both dispatch directions and the serialized owner fence. |
| `eb34b05dcc086da470f9f5335ece29ad838abeed` | Integrate the final Phase 1 sanitized gate logging and preserve provider-neutral park diagnostics. |
| `dac97ab1cd9dc90589959e038782634d85fdd259` | November 22 fast-forward preparation: merge landed `dev-nowaker` at `8f3eca215e494893818a6f69ae68d67bb69f5af1` into the feature branch without rewriting either history. |
| `936fbe45d2d05ad9fbfcfdf36429c1ffa300fc8a` | Test-only family expansion and exact idle-return coverage; released unchanged to both `dev-nowaker` mirrors. |

## Verification and historical install

- In `packages/opencode`, `bun run test test/session/auto-switch-v1-matrix.test.ts`: 13 pass, 0 fail at `936fbe45d2`. Tests cover one independent tool write on same-step continuation, Claude-to-GPT-to-Claude round trip, Sol `max` exact return, inline PNG, and no alternate POST for missing marker, pinned profile, unsupported structured output or context no-fit. Reverse rows cover Sol/Opus, Astra/Fable, Terra/Sonnet and Luna or Luna-fast/Haiku. Terra `medium` returns as `medium` after Sonnet `high`; absent approved Haiku effort parks before the probe.
- November 22 release rerun: 141 pass, 0 fail across matrix, processor Meridian, transcript, budget, inheritance, pause and owner HTTP suites; `bun typecheck` passed. The broader feature refresh run had 291 pass, 1 skip, 0 fail. Release log on m4max: `/tmp/opencode-phase2-release-tests-936fbe45.log`.
- [Managed policy](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e03bdb239ffeB4Vkb8SrksAHjA) reported 17/17 composed cases and a stamped-binary Sol `max` TUI switch/return; the fresh release status-only proof passed 4/4 with zero inference. [OMO](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e03bec0afffeWO5ZIpk8TfF4sD) verified the qualified agent swap, pin vetoes and exact return. [Meridian](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e03f312d4ffeofE8EUwQ5S4MDz) tested the separate producer contract. Scripted provider evidence does not establish live allowance; live entitlement at release: TBD.
- On November 22, tracked `.vibeterm/build.sh` installed `1.19.5-vt-597-006d837c50` on desktop and m4max after mandatory migration-guard passes. Each installed artifact matched its build and passed isolated localhost health with `autoSwitch: 1`; no running service or TUI was restarted. Host build logs: `/tmp/opencode-phase2-release-936fbe45-desktop.log` and `/tmp/opencode-phase2-release-936fbe45-m4max.log`. This November 25 record changes documentation only; no rebuild or restart.
