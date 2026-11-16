# 10 - Keep a fast command's output on v1

Status: READY TO FILE, NOT FILED - queued at the coordinator's instruction for the daily PR drain, which files it when an author PR slot frees. No PR, issue or comment has been posted.

- Repository and base: `anomalyco/opencode`, `v1` at `6a5339d06611645937833c6eb32e57251b15ca3b` (`feat(desktop): offer the OpenCode 2 upgrade (#64153)`), fetched 2026-11-16.
- Head: `Nowaker:keep-late-output`, `7f1c045d29fafddf593605f697cbda8443a001bd`; one commit above `v1`. `git ls-remote` showed this head on both `origin` and `nowaker-github` on 2026-11-16.
- Fork twin: `1a4cba2fbef` on `dev-nowaker`, cherry-picked onto `v1`. The upstream commit adds one ShellTool change the fork does not need: upstream `v1` closes the reader's scope as soon as the exit is reported, while the fork already joins the reader (fork commit `5cc30c46fbc`, bash background). The ShellTool test fails on `v1` with either half alone.
- Prior art: [#46463](https://github.com/anomalyco/opencode/pull/46463) (`a6b49b3f740`, merged into `v2` on 2026-08-31) fixed the same race in the v2 spawner (`packages/util/src/cross-spawn-spawner.ts`) by piping stdout/stderr into a `PassThrough` eagerly. It was never backported: `a6b49b3f740` is not an ancestor of `v1`. Unrelated same-symptom reports: [#62763](https://github.com/anomalyco/opencode/issues/62763) / [#62766](https://github.com/anomalyco/opencode/pull/62766) (v2, capture file not writable). States checked through the public REST API on 2026-11-16.
- Scope: `packages/core/src/cross-spawn-spawner.ts`, `packages/opencode/src/tool/shell.ts` and their tests; no forklog, configuration or unrelated fork customizations in the range.
- Documentation: no new setting or command.
- Owner: [`ses_e1bb77423ffeFABSFtCGeavd1T`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1bb77423ffeFABSFtCGeavd1T). Evidence: [session record](../sessions/2026-11-16-shell-late-output.md), [feature record](../features/2026-11-16-shell-late-output.md).

## Title

`fix(core): keep a fast command's output for readers that attach late`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

Backports the fix of #46463 (merged into `v2`) to `v1`, where the bash tool still drops a fast command's output.

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

On `v1`, a command that prints and exits immediately (`echo hello`) can come back from the bash tool as `(no output)` with exit code 0, and no running-part `metadata.output` update is ever published. Two things race:

1. `CrossSpawnSpawner` hands out lazy `NodeStream.fromReadable` streams over the bare stdio pipes. Nothing listens to a pipe until the caller's reader fiber starts. Node and Bun discard what a child wrote to a pipe with no data listener once the child exits, so a reader that attaches after a fast child finished reads nothing.
2. `ShellTool` forks its reader after `spawn()` returns, races `handle.exitCode`, and closes the scope as soon as the exit is reported. That interrupts the reader while output is still being decoded.

Changes:

- The spawner now drains every output pipe (stdout, stderr and extra output fds) into a `PassThrough` synchronously right after launch, before any child event can fire. While the child runs, a full buffer pauses its pipe, so an unread stream still applies backpressure. After the exit the rest is buffered without limit, because the exit is reported on `close`, which waits for every pipe to end. A reader that stops early destroys its buffer and with it the pipe, so the child still sees a closed pipe. This matches what #46463 does on `v2`.
- `ShellTool` joins its reader, bounded to one second, before closing the scope.

Incremental streaming for long commands is unchanged. Because the fix is in the spawner, it covers every caller: the bash tool, the `!` prompt shell, `AppProcess.run`/`runStream`, ripgrep, project and git probes, and the platform `string`/`lines` helpers.

### How did you verify your code works?

The tests pin the race deterministically by awaiting the exit before the first read, with no sleeps:

- `packages/core/test/effect/cross-spawn-spawner.test.ts`, "output read after the process exits": 20 runs each read stdout, stderr and `all` only after `exitCode` resolved; a second case checks that unread stderr does not hold up the exit. Before the change the reads return `""`.
- `packages/opencode/test/tool/shell.test.ts`, "keeps a fast command's output when the child exits before the reader attaches": runs `echo` 20 times through `ShellTool` with the real spawner, wrapped so `spawn()` returns only after the child exited, and asserts the result output, `metadata.output` and a streamed metadata update. Without either half of the change it returns `(no output)`.

From `packages/core`: `bun test test/effect/cross-spawn-spawner.test.ts` 26 pass, 0 fail. From `packages/opencode`: `bun test test/tool/shell.test.ts` 24 pass, 0 fail. `bun typecheck` passes in both packages, and Prettier is clean.

### Screenshots / recordings

Not a UI change.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Filing command - prepared, do not execute while blocked

Requires Bash and `gh` on the filing host. The credential comes from the existing private env file and is never written into this artifact.

```bash
(
  source /home/nowaker/projekty/nowaker/env
  GH_TOKEN="${GITHUB_TOKEN_CLASSIC_PUBLIC_REPO:?Classic public-repo token is required}" gh pr create \
    --repo anomalyco/opencode --base v1 --head Nowaker:keep-late-output \
    --title "fix(core): keep a fast command's output for readers that attach late" \
    --body-file <(awk '/^<!-- BEGIN PR BODY -->$/{body=1;next}/^<!-- END PR BODY -->$/{exit}body' /home/nowaker/projekty/webapps/opencode/.vibeterm/forklog/pr-queue/10-shell-late-output.md)
)
```

Before filing, check that `v1` has not moved under the head (`git merge-tree --write-tree github/v1 keep-late-output`), that nobody else has backported #46463 to `v1` meanwhile, and that a slot is free.
