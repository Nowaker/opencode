# Awaited plugin configuration on v2

## Identity and request

- Status: active; published and installed on desktop and m4max. Consumer acceptance remains pending W10's queued adapter work.
- Source integration: `v2-nowaker`; forklog: `dev-nowaker`; development branch: `config-stage`.
- First source candidate: `1ab8f38bb4fa707653fb31d55e810d2b582b8f16`, committed November 13 after the resource pause. Published source commit: `72527fce0c218c39619fd93d8ef78a975529bccb`, rebased onto W1's `ea2e468b53` and fast-forwarded into `v2-nowaker`; both mirrors independently verified. Upstream base: `v2.2.7` (`fedc6f208aa2bd54c1019227214568083f6380ad`).

> Add an activation-owned, AWAITED configuration stage for plugins.

> During activation, external plugins get the real resolved, mutable config draft, and their changes apply before the builtin ConfigProvider/Agent/Command consumers read it, with v1's precedence (plugin edits apply on top of loaded config).

## Behavior and stable seams

- `packages/plugin/src/{effect,promise}/config.ts`: `ctx.config.configure(callback)` registers during setup and returns a scoped registration. Its draft is mutable native `Config.Info`, with `providers`, `agents`, `commands` and object-valued `model`; the stage does not emulate v1 field names or inject runtime catalog defaults.
- `packages/core/src/plugin.ts`, `plugin/supervisor.ts`, `plugin/activation.ts`, `plugin/configuration.ts` and `plugin/configuration-stage.ts`: setup and builtin post generations are separated by an awaited boundary. Callbacks run in activation order. Every pass starts from fresh raw sources and discards a candidate if its source revision changes while awaiting.
- `packages/core/src/config/draft.ts` and `draft-resolve.ts`: field-specific resolution and changed-path projection preserve source order, aliases, path provenance and integration attribution. Pending edit plans survive Agent/Command Markdown expansion. Deletions cannot reveal an earlier command declaration.
- `packages/core/src/config/snapshot.ts`: Config owns raw and committed views. Source changes request serialized activation; commit awaits native observers and publishes `config.updated`. An origin in event metadata prevents its own publication from causing activation feedback; explicit external `config.updated` retains its reload behavior.
- `packages/core/src/config/plugin/{entry-observer,mcp,skill,instruction}.ts`: awaited refresh retains each consumer's service context and the current activation batch. Plugin discovery and admission policy read raw configuration.
- `packages/plugin/src/promise/adapter.ts`: registrations made inside an async configuration callback use that pass's scope. Rerun/unload removes the prior pass's contributions.
- `State.guard` routes asynchronous failures through the owning registration group. Invalid drafts and edits to `plugins` disable that owner; protected managed/integration policy contributions cannot be replaced through the draft.
- `ctx.app.capabilities.pluginConfiguration` and `GET /api/info` `capabilities.pluginConfiguration` advertise support. Client artifacts come from `packages/client` generation.
- Native tool-schema removal and owned command execution remain compat-layer domain transforms. The fork stage does not add a v1 `tools` field.

## Verification

- Focused source run: 76 pass, 0 fail, 242 assertions. Follow-up after observer context correction, including setup-only admission: 27 pass, 0 fail, 95 assertions.
- Canonical `bun run check`: 34 workspace typechecks pass; lint reports 554 existing warnings and 0 errors. Core, plugin, protocol, server and client diagnostics have 0 errors. Second client generation is unchanged.
- Scratch source CLI HTTP proof: the loaded provider is renamed, a new provider appears in native inventory, a scratch session is created, and the owned engine exits 0. No inference request or live data is used.
- Five in-memory mutation controls exercise projection loss, flattening, callback cleanup, late registration and configured commit loss; assertion failures distinguish the regressions. One extra discard-mutant timeout is not counted as behavioral proof.
- Three source gate findings were reproduced and corrected: managed Console documents refresh on commit, provider endpoint edits preserve earlier alias captures, and Promise callback RPC registrations use the per-pass scope. Real native integration documents also retain optional-field and origin semantics. The November 13 focused run passes 74 tests with 240 assertions; core typechecking covers 2,034 files and targeted lint has zero warnings/errors.
- The [narrow source gate review](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2b329d1affeZ4eITIi5MJzNBm) approves the corrected candidate with high confidence and judges it upstreamable. Desktop and m4max independently build and install `opencode v2.2.7-vt-15-5f76acb125`, each after the mandatory 12/12 probe gate with no skips. V1 identity and the protected desktop service identities remain unchanged.
- Rebased integration checks pass 59 tests with 221 assertions, including W1 plugin messages, fork, child-cancellation and job-control surfaces. Core typechecking covers 2,061 files. Regenerated clients reproduce exactly. Both normal source-push hooks pass lint and all 34 workspace typechecks.
- The [v1 controller demo](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2af0f920ffehJ2FaMuPluSLlb) runs the installed proof once: the native inventory returns `Configured provider` and `Added by configuration plugin`; all sibling capabilities survive, and the scratch engine exits 0. The controller tab is closed. W10's actual v1 config/model/header/tool-omission/owned-command fixture has not run; its preserved wrapper now invokes the installed native binary.

## Timeline

- 2026-11-11 [Session record](../sessions/2026-11-11-plugin-configuration.md), [W12 session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35a0c9d8ffeV0Ic4uhdjveeAc): agreed native API with W10, implemented the source candidate, exercised native HTTP and lifecycle regressions; delivery facts are pending.
- 2026-11-13 [Same session record](../sessions/2026-11-11-plugin-configuration.md): resumed after the resource pause, closed all three gate findings, published `72527fce0c`, and completed the sequential gated desktop/m4max installations plus the single controller demo. Source approved; consumer acceptance pending W10.

## Maintenance

- Preserve the explicit setup/configuration/post boundary and the raw-source admission path when merging upstream.
- Re-run `packages/core/test/plugin/configuration*.test.ts`, `test/config/draft*.test.ts`, the existing config reload and supervisor suites, and W10's compat `mapping-runtime.test.ts` acceptance.
- Regenerate clients after the public capability changes. Build/install through the primary checkout's `.vibeterm/build.sh --v2` with the mandatory probe gate.
