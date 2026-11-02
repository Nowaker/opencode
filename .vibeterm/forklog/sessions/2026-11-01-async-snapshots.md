# Async per-step snapshots

## Identity

- Workday: 2026-11-01
- Session: `ses_e6649eb52ffeWA5U81qVUQP5Td` (spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`)
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` / `linux`
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `async-snapshots` (managed worktree, cut from `github/v1`), `async-snapshots-merge` (managed worktree, cut from `dev-nowaker`)
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `5890ad1411` (feature, no AI trailers), `6977deacde` (merge)
- Forklog commit: this file's introducing commit

## User requests

> Task: make opencode's per-turn snapshots asynchronous in our fork, as an upstreamable change. The user approved this design ("Build async snapshots").

The full design brief from the coordinator is summarized in the [feature record](../features/2026-11-01-async-snapshots.md#goals).

## Goals

- Model request and read-only tools no longer wait for snapshots; write-capable tools do; diffs, patches and undo unchanged.

## Constraints and non-goals

- Upstreamable branch off `github/v1` without AI trailers, merged (not rebased) into `dev-nowaker`; no force-push.
- Push the upstream branch to `nowaker-github` and write the PR body; do not open the PR.
- Preserve the uncommitted retry patch and `.gitignore` edit on both hosts; build only with `.vibeterm/build.sh` and `VIBETERM_V2_GUARD`.
- Do not restart tabs, serve units, Vibeterm or Meridian.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `async-snapshots` | `006d837c50` | `5890ad1411` | commit; pushed to `nowaker-github` |
| `opencode` | `dev-nowaker` | `96a3e6f14f` | `6977deacde` | fast-forward from `async-snapshots-merge` (merge commit) |
| `opencode` (m4max) | `dev-nowaker` | `31db5f1325` | `6977deacde` | fast-forward from `origin` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Send the model request while file snapshots run](../features/2026-11-01-async-snapshots.md) | introduced | tests and timings below |

## Verification

- `packages/opencode` `bun test --timeout 30000 test/session/async-snapshot.test.ts` - 3 pass, on `github/v1` and in the merge worktree. Snapshot calls are held on explicit deferreds: (1) the model request goes out and `read` completes while the turn snapshot is held, `bash` stays blocked and its file is absent, and after release `step-start.snapshot` equals the pre-turn tree hash; (2) a two-step `edit` + `bash` turn with step one's "after" and step two's "before" snapshots held: the second request goes out, writes wait, step hashes equal the directly taken before/after tree hashes, and patch parts, `summary.diffs` (equal to `snapshot.diffFull(before, after)`), `revert` and `unrevert` match; (3) abort while held: the abort waits, the gated `bash` never runs, `step-start` gets the right hash, no patch part, session idle.
- Mutation checks on `github/v1`: a no-op gate fails all three tests; awaiting the initial snapshot synchronously fails all three.
- `github/v1` worktree, 9 suites (snapshot, prompt, processor-effect, revert-compact, snapshot-tool-race, compaction, tools, registry, async-snapshot) - 214 pass, 0 fail. `test/session` + `test/tool` - 753 pass, 10 fail; the same 10 (instruction, grep, external-directory, shell permissions, skill) fail on plain `github/v1` with this host's in-repo `TMPDIR`. Without `--timeout 30000`, the first test of `processor-effect.test.ts` and `snapshot-tool-race.test.ts` exceeds the 5 s default on plain `github/v1` too.
- Merge worktree, same 9 suites - 273 pass, 1 fail: `does not leave a summary assistant when aborted before processor setup`, which fails identically on clean `dev-nowaker` `96a3e6f14f` (probe worktree `compaction-probe`).
- `bun typecheck` in `packages/opencode` clean on both branches; prettier clean on changed upstream files.
- Dispatch timing (scratch harness, not committed): time from `SessionPrompt.loop()` to the model request reaching the test provider, real snapshots, tmp git repos:
  - copy of this repo (7.4k files): before first turn 5782 ms, later median 63 ms; after 551 ms and 36 ms.
  - 40k untracked files: before first turn 89405 ms, later median 62 ms; after 604 ms and 28 ms (the initial 76 s snapshot now runs after dispatch).

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard bash .vibeterm/build.sh` from each primary checkout at `6977deacde`, Bun 1.4.4; v2 migration guard gate PASSED on both.
- Desktop: `1.19.5-vt-391-006d837c50`, inode `49938570` -> `49969887`, retry marker present.
- m4max: `1.19.5-vt-391-006d837c50`, inode `53274353` -> `53335075`, retry marker present; checkout fast-forwarded from `31db5f1325`, retry patch and `.gitignore` edit kept.
- Running services: desktop `opencode-serve-tailscale` and `opencode-serve-lan` inactive (MainPID 0) before and after; nothing restarted.

## Commit provenance

- `5890ad1411` - feature and tests on `async-snapshots` (upstream branch, no AI trailers)
- `6977deacde` - merge into `dev-nowaker`, with fork conflict resolution
- Required trailer: `AI-Session-ID: ses_e6649eb52ffeWA5U81qVUQP5Td`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-01-async-snapshots.md
```

## Unknowns and blocked verification

- Upstream PR not opened by this session; body at `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/pr-body-async-snapshots.md`.
- No live-session latency measurement on the real checkout: running the harness against the live snapshot store would race the running tabs' snapshots.
- GitLab reports the project moved to `vibeterm/opencode`; the `origin` URL was left unchanged.
