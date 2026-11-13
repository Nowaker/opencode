# Guarded v2 fork and separate opencode2 installation

## Identity and request

- Status: active. Source branch: `v2-nowaker`; installer and forklog branch: `dev-nowaker`.
- Upstream base: `v2.2.7`, `fedc6f208aa2bd54c1019227214568083f6380ad`, the newest stable v2 tag at the November 10 start. Its release parent `5f76acb125` is on `github/dev`.
- Commits: `93f790182d` (pre-push cap), `84e23092d9` (Core database guard), `d90d41a907` (CLI explicit database), `ee1e5815cf` (installer).
- `v2-nowaker` is pinned and takes deliberate upstream merges. Never rebase or force-push it.

> GOAL: the v2 fork base that every later phase builds on.

> HARD SAFETY: never run any v2 binary against live data.

The coordinator clarified that the fork must refuse an unset `OPENCODE_DB`. `~/.local/share/opencode/opencode-v2.db` is the explicit value Vibeterm passes, not a binary fallback.

## Behavior and stable seams

- `packages/cli/src/database-path.ts`: require nonempty `OPENCODE_DB`; retain `:memory:`. `debug paths` and server startup yield this resolver. Help and version acquire no database.
- `packages/core/src/database/guard.ts`: refuse the effective data directory's `opencode.db`, the home-directory v1 default, symlink/hardlink aliases and unresolved symlinks. Inspect existing files through a read-only SQLite connection before permission changes or writable opening. Schema reads share one transaction so catalog and column checks see one snapshot, including committed WAL. SQLite may maintain WAL/SHM bookkeeping; this is not a claim that every sidecar remains byte-identical.
- Schema refusal covers the legacy `session`, `message` and `part` triple even alongside `session_v2`, trigger `_vt_refuse_v2_migration`, and `event.created` without `session_v2`. Fresh v2 legitimately has `event.created` and no legacy triple.
- `packages/core/src/database/database.ts`: file-based `layer`/`configured` preflight before `restrictToOwner`, native SQLite acquisition, PRAGMAs and migrations. `layerFromClient`/`configuredClient` check injected storage before this layer's PRAGMAs and migrations, including workerd.
- Native filesystem writers enter through `Database.layer` and conditional `sqlite.bun.ts`/`sqlite.node.ts`. The other native opening, `v1-migration.bun.ts` `openNextDatabase`, is explicitly read-only and does not migrate its source.
- `.husky/pre-push` retains upstream lint and caps `bun turbo typecheck` at concurrency 2.
- `.vibeterm/build.sh --v2` builds `packages/cli` in the managed `v2-nowaker` checkout by default, or `OPENCODE_SRC`, and installs only sibling `opencode-build/bin/opencode2`. V1 retains its existing installer and migration guard gate. V2 refuses install aliases of the v1 executable and isolates child HOME, XDG, database, config, tool and plugin stores.
- The v2 stamp uses stable `v2.*` tags and the `github/dev` merge-base: `<base>-vt-<seq>-<sha10>`. Tag fetching is scoped to the v2 line. Portable Node path canonicalization avoids BSD `realpath`'s lack of `-m`.

## Verification

- Core guard, permissions and migration tests: 36 pass, 0 fail. CLI resolver tests: 6 pass, 0 fail. Both packages' `bun typecheck` pass. Changed guard/test file lint: 0 warnings and 0 errors. Full lint exits 0 with 550 pre-existing warnings and 0 errors.
- V2 mirror push hooks pass all 34 workspace typecheck tasks; v1 installer hooks pass all 30 tasks.
- Disabling each default-path, legacy-table, trigger or column rule makes the guard suite fail. Mutations restore exact owner hashes. Oracle's dangling-symlink finding was reproduced with a red regression, corrected with `lstatSync` refusal and cleared by its follow-up review.
- `.vibeterm/build.test.sh` passes parser, tag/version selection, isolated child environment, v1 aliases, inode swap, lockfile restore, failed build and v1 gate cases. Its compiler stand-in exercises the installer; the full native build was run separately.
- Desktop installed `opencode v2.2.7-vt-4-5f76acb125`, inode `49972315`, 239963248 bytes. Installed proof created and served a real scratch v1 database, refused unset/default/home-default/explicit/poisoned cases byte-identically, and served fresh v2 `/api/info` with HTTP 200. Evidence: `.vibeterm/tmp/opencode/v2-guard-GKkwXN/result.json`.
- V1 retained inode `49984166`, 198708336 bytes. Protected serve units remained inactive with unchanged PID/start fields. No live v2 launch occurred. Node-driver execution was source-reviewed and typechecked, not separately run.
- m4max preflight verified Bun 1.4.4 and Command Line Tools, then the host became unreachable. W4 subsequently closes that initial delivery: host-native vt-8 builds from published `1f6d9fb8c1`, installs byte-identical native arm64 output and returns scratch `/api/info` 200. Its authorized legacy-gate fallback is recorded in the shared W4 session record; no binary was copied between hosts.
- [Demonstration](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37fc6aa2ffeItmFQYimsW3v7l): repeat installed proof and an actual multiline refusal, with isolated fresh startup returning 200.

## Timeline

- 2026-11-13 [plugin-controls delivery record](../sessions/2026-11-13-v2-plugin-controls.md), [W1 session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ): record published guard snapshot correction `398e98d11c`, WAL-only detection, the earlier clean vt-11 gate and the final published-source vt-14 gate (12 pass, 0 fail, 0 skip); correct the read-only bookkeeping claim without changing guard policy.
- 2026-11-10 [W4 session record](../sessions/2026-11-10-v2-patches.md), [W4 session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37e57935ffeTjd0whAV8iFPzQ): preserve the legacy XDG v1 default and aliases when moving v2 app-derived roots to `opencode2`; direct guard suite 17 pass, 0 fail. Initial host-native Mac vt-8 installation closes W1's host blocker; later desktop metadata vt-9 installation passes the canonical 12-row runtime gate with seven byte-preserving database refusals.
- 2026-11-10 [session record](../sessions/2026-11-10-v2-foundation.md), [W1 session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ): establish the pinned base, guard and separate installer, publish both branches to both mirrors, and install/verify desktop.
