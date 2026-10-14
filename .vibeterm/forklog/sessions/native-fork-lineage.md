# Exact native fork lineage at creation

## Identity

- Workday: 2026-10-14
- Session: `ses_ec549ca11ffeaEknagLhxmfpFp`
- Parent session: `ses_ede174837ffevzTKU3tLhpOB5E`
- Agent/platform: Sisyphus-Junior, `openai/gpt-6.1-sol`, xhigh / darwin; desktop build and runtime QA also ran on Linux over SSH.
- Repository: OpenCode fork, GitLab `vibeterm/opencode`, GitHub `Nowaker/opencode`.
- Integration branch: `dev-nowaker`
- Development branch: `native-fork-lineage`, fresh managed worktree from `c946d6626d`.
- Upstream base: `dfb56f76c7`, upstream `v1`, containing `v1.19.0`; no upstream bump.
- Source result: [`b0ebca176f3ec9c113e267334f2eca24a8686e9c`](https://gitlab.com/vibeterm/opencode/-/commit/b0ebca176f3ec9c113e267334f2eca24a8686e9c).
- Forklog commit: this file's introducing commit, kept separate from the source change.

## User request

> Nativeforks, includingmetadata-empty/historicalimports, exposeexactcurrentforksourceatcreationsoVibetermcanstampownbirthandtruthfulancestrywithoutguessing; deliveredandverifiedbothdesktop/m4maxforkbuilds.

## Contract And Call Order

- `Session.fork` reads the actual `input.sessionID`, then passes it privately as `forkedFrom` to `createNext` together with the original generic metadata.
- `createNext` allocates the new ID and creates `metadata.vibeterm.lineage = { sessionId: newID, kind: "native-fork", originalObjectId: input.sessionID }` before publishing `Session.Created`.
- The source's prior lineage is nested as `sourceLineage` only when its `sessionId` equals the actual input session ID. No incoming creator/origin or mapper birth is interpreted as fork ancestry.
- The durable creation event is sequence 0. Message copying starts only after `createNext` returns; focused tests verify the first copied message event follows it.
- All unrelated metadata is cloned and retained. Inherited `lastExecution` is still cleared. The generic metadata envelope, public routes, schemas, SDKs and event shapes are unchanged. No opencode-tools runtime modules are imported.
- [Machine provenance](../features/2026-10-10-machine-provenance.md) is the canonical feature record for this change.

## Integration And Verification

- Rebased the clean feature branch onto local `dev-nowaker`; it was already current. Fast-forward merged source into `dev-nowaker`, then pushed the same source tip to both remotes without force or amend.
- Left the unrelated `.gitignore` and canonical retry-cap source/test divergence untouched on both primary checkouts.
- Red: `bun test test/session/fork-lineage.test.ts -t 'with undefined'` against unmodified source fails because durable `session.created.1` metadata is `undefined`, not exact lineage.
- Baseline installed binary: scratch HTTP `POST /session` followed by native `POST /session/:id/fork` produced source `ses_ec53f473effen98OGKP4e1HA3T`, fork `ses_ec53f4703ffetmqC0dGE08eFnM`, creation metadata `null` (absent).
- Green on both hosts: `bun test test/session/fork-lineage.test.ts test/session/session.test.ts test/session/machine-provenance.test.ts test/session/messages-pagination.test.ts test/server/session-actions.test.ts` passed 81 tests and 225 assertions.
- `bun typecheck` in `packages/opencode` passed; pre-push monorepo typecheck passed all 30 runnable packages. All changed TypeScript files had clean LSP diagnostics.
- Independent read-only review `ses_ec53f4928ffe3LHPv41SHLV1JB` found no concrete issues.
- Before global installation, the compiled scratch binary passed real loopback HTTP, SSE `session.created`, indexed SQLite creation-event sequence 0, nested forks and foreign-lineage checks with no plugin or first turn.
- Installed probes used fresh scratch XDG/HOME plus `OPENCODE_TOOLS_DATA_DIR`, `OPENCODE_PLUGINS_DATA_DIR`, and an explicit scratch `OPENCODE_DB`; all owned servers and databases were cleaned afterward. They did not contact production state.

## Build And Installed Proof

- Both hosts built their own checkout at source commit `b0ebca176f3ec9c113e267334f2eca24a8686e9c` with tracked `.vibeterm/build.sh`. Desktop ran a full `bun install --frozen-lockfile` before building; no build artifacts were copied across hosts.
- Both installed versions: `1.19.0-vt-289-dfb56f76c7`.
- m4max installed target: `/Volumes/projects/webapps/opencode-build/bin/opencode`; mandatory v2 gate passed at `2026-10-14T14:16:31.644Z`.
- desktop installed target: `/home/nowaker/projekty/webapps/opencode-build/bin/opencode`; mandatory v2 gate passed at `2026-10-14T14:18:52.823Z`.
- Both gates exercised the built v1 and npm `opencode-ai@1.19.0` against `@opencode/cli@2.0.29`: v2 refused migration for both/trigger/column guards without changing the logical dump, and v1 remained usable.
- m4max installed native probe: source `ses_ec539a544ffepFeL9clEouzT73`, fork/own lineage `sessionId` `ses_ec539a52bffeJOhxKpb6B9GwLM`, `originalObjectId` equal to that exact source, birth `1791987440341`, durable sequence 0, zero messages before the first turn.
- desktop installed native probe: source `ses_ec5374addffemKAAgBqSQLxH9n`, fork/own lineage `sessionId` `ses_ec5374ac0ffeaKPzrqlAs9W71I`, `originalObjectId` equal to that exact source, birth `1791987594559`, durable sequence 0, zero messages before the first turn.
- Installed probes on both hosts also passed nested fork ancestry, rejection of foreign source lineage, unrelated metadata/creator preservation and inherited execution clearing.
- Logs on m4max: `/Volumes/projects/nowaker/opencode-tools/.vibeterm/tmp/opencode/native-fork-{qa,m4max,desktop}-build.log`, `native-fork-{native-qa,m4max-proof,desktop-proof,baseline}.log` in the same directory.
- No TUI, default tmux server or production service was restarted. The parent owns its later TUI restart.

## Commit Provenance

- Source commit contains the full own `AI-Session-ID` and parent `AI-Parent-Session-ID` with the resolved human author.
- Correction: the source commit's `AI-Harness: Vibeterm 1e793a4d` label is inaccurate; the session's mandatory harness label is `Vibeterm 9e8addab`. This record corrects it without amending or rewriting published source history.
- No upstream, OMO, Meridian, model-catalog, pins or global configuration changes.
- Unknowns or blocked verification: none for the engine producer; the opencode-tools consumer remains the parent session's separate work.
