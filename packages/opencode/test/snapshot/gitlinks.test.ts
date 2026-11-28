import { expect } from "bun:test"
import assert from "node:assert/strict"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { AppProcess } from "@opencode-ai/core/process"
import { Hash } from "@opencode-ai/core/util/hash"
import { InstanceState } from "@/effect/instance-state"
import { Snapshot } from "@/snapshot"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Snapshot.node, FSUtil.node, AppProcess.node])),
)

const extension = "opencodesnapshotfixture"
const original = "original ordinary contents\n"
const edited = "ordinary contents edited after the snapshot\n"

const runGit = (cwd: string, args: string[]) =>
  AppProcess.Service.use((proc) => proc.run(ChildProcess.make("git", args, { cwd })))

const git = (cwd: string, args: string[]) =>
  runGit(cwd, args).pipe(
    Effect.flatMap(AppProcess.requireSuccess),
    Effect.map((result) => result.stdout.toString("utf8")),
  )

const captureWithGitlink = Effect.fnUntraced(function* (relative: string) {
  const ctx = yield* InstanceState.context
  const fs = yield* FSUtil.Service
  const snapshot = yield* Snapshot.Service
  const nested = path.join(ctx.worktree, relative)
  const nestedGitdir = path.join(ctx.worktree, ".git", "nested-fixture")
  const file = path.join(ctx.worktree, "ordinary.txt")
  const nestedFile = path.join(nested, "nested.txt")

  yield* git(ctx.worktree, ["rev-parse", "--verify", "HEAD"])
  yield* fs.writeWithDirs(nestedFile, "committed nested contents\n")
  yield* git(nested, ["init", "--quiet", "--separate-git-dir", nestedGitdir])
  yield* git(nested, ["add", "nested.txt"])
  yield* git(nested, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@opencode.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "nested fixture",
  ])
  const head = (yield* git(nested, ["rev-parse", "--verify", "HEAD"])).trim()
  yield* fs.writeFileString(file, original)

  const before = yield* snapshot.track()
  assert.ok(before, "the healthy nested repository must be snapshotted first")
  const store = path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree))
  const storeArgs = (args: string[]) => ["--git-dir", store, "--work-tree", ctx.worktree, ...args]
  const storeGit = (args: string[]) => git(ctx.worktree, storeArgs(args))
  const gitlink = `160000 commit ${head}\t${relative}\n`
  expect(yield* storeGit(["ls-tree", "-r", before, "--", relative])).toBe(gitlink)

  const config = path.join(nestedGitdir, "config")
  const poison = Effect.gen(function* () {
    yield* git(ctx.worktree, ["config", "--file", config, "core.repositoryformatversion", "1"])
    yield* git(ctx.worktree, ["config", "--file", config, `extensions.${extension}`, "true"])
    const probe = yield* runGit(ctx.worktree, storeArgs(["diff-files", "--name-only", "--", "."]))
    const stderr = probe.stderr.toString("utf8")
    expect(probe.exitCode, stderr).toBe(128)
    expect(stderr).toContain(extension)
  })

  return { before, file, nested, nestedFile, config, gitlink, storeGit, poison }
})

it.instance(
  "tracks ordinary edits and drops stale index entries under a newly ignored ancestor",
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const fs = yield* FSUtil.Service
    const snapshot = yield* Snapshot.Service
    const unchanged = "tmp/unchanged.txt"
    const unchangedFile = path.join(ctx.worktree, unchanged)
    yield* fs.writeWithDirs(unchangedFile, "unchanged ordinary contents\n")
    const fixture = yield* captureWithGitlink("tmp/embedded")
    expect(yield* fixture.storeGit(["ls-tree", "-r", "--name-only", fixture.before, "--", unchanged])).toBe(
      `${unchanged}\n`,
    )
    expect(yield* fixture.storeGit(["diff-files", "--name-only", "--", unchanged])).toBe("")

    yield* fs.writeFileString(path.join(ctx.worktree, ".git", "info", "exclude"), "tmp/\n")
    yield* fixture.poison
    yield* fs.writeFileString(fixture.file, edited)

    const after = yield* snapshot.track()
    assert.ok(after, "a newly ignored broken gitlink must not block ordinary changes")
    expect(yield* fixture.storeGit(["show", `${after}:ordinary.txt`])).toBe(edited)
    expect(yield* fixture.storeGit(["ls-files", "--stage", "--", "tmp"])).toBe("")
    expect(yield* fixture.storeGit(["ls-tree", "--name-only", after, "--", "tmp"])).toBe("")

    const patch = yield* snapshot.patch(fixture.before)
    expect(patch.files).toEqual([fixture.file.replaceAll("\\", "/")])
    expect(yield* snapshot.revert([patch])).toEqual([])
    expect(yield* fs.readFileString(fixture.file)).toBe(original)
    expect(yield* fs.readFileString(unchangedFile)).toBe("unchanged ordinary contents\n")
    expect(yield* fs.readFileString(fixture.nestedFile)).toBe("committed nested contents\n")
  }),
  { git: true },
)

it.instance(
  "diffs ordinary edits without removing or modifying an unignored broken gitlink",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const snapshot = yield* Snapshot.Service
    const relative = "vendor/embedded"
    const fixture = yield* captureWithGitlink(relative)
    const gitfile = path.join(fixture.nested, ".git")
    const link = yield* fs.readFileString(gitfile)
    yield* fs.writeFileString(fixture.nestedFile, "dirty nested contents\n")
    yield* fixture.poison
    const config = yield* fs.readFileString(fixture.config)
    yield* fs.writeFileString(fixture.file, edited)

    const diff = yield* snapshot.diff(fixture.before)
    expect(diff).toContain("\n-original ordinary contents\n")
    expect(diff).toContain("\n+ordinary contents edited after the snapshot")

    const after = yield* snapshot.track()
    assert.ok(after, "the unignored broken gitlink must not block ordinary changes")
    expect(yield* fixture.storeGit(["ls-tree", "-r", after, "--", relative])).toBe(fixture.gitlink)
    expect(yield* fs.readFileString(gitfile)).toBe(link)
    expect(yield* fs.readFileString(fixture.config)).toBe(config)
    expect(yield* fs.readFileString(fixture.nestedFile)).toBe("dirty nested contents\n")
  }),
  { git: true },
)

it.instance(
  "keeps a file replaced by a nested repository out of file diffs and undo",
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const fs = yield* FSUtil.Service
    const snapshot = yield* Snapshot.Service
    const relative = "replacement"
    const replaced = path.join(ctx.worktree, relative)
    yield* fs.writeFileString(replaced, "ordinary file before replacement\n")
    yield* fs.writeFileString(path.join(ctx.worktree, "ordinary.txt"), edited)
    const before = yield* snapshot.track()
    assert.ok(before, "the baseline must contain the ordinary file")

    yield* fs.remove(replaced)
    const after = yield* captureWithGitlink(relative)

    expect((yield* snapshot.diffFull(before, after.before)).map((file) => file.file)).toEqual([
      "ordinary.txt",
    ])
    const diff = yield* snapshot.diff(before)
    expect(diff).toContain("ordinary.txt")
    expect(diff).not.toContain("replacement")
    const patch = yield* snapshot.patch(before)
    expect(patch.files).toEqual([after.file.replaceAll("\\", "/")])
    expect(yield* snapshot.revert([patch])).toEqual([])
    expect(yield* fs.readFileString(after.file)).toBe(edited)
    expect(yield* fs.readFileString(after.nestedFile)).toBe("committed nested contents\n")
  }),
  { git: true },
)

it.instance(
  "captures ordinary files after a nested repository moves away",
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const fs = yield* FSUtil.Service
    const snapshot = yield* Snapshot.Service
    const relative = "replacement"
    const fixture = yield* captureWithGitlink(relative)
    yield* fs.rename(fixture.nested, path.join(ctx.worktree, ".git", "moved-nested"))
    yield* fs.writeWithDirs(path.join(fixture.nested, "ordinary.txt"), edited)

    const after = yield* snapshot.track()
    assert.ok(after, "ordinary files replacing a nested repository must be snapshotted")
    expect(yield* fixture.storeGit(["show", `${after}:${relative}/ordinary.txt`])).toBe(edited)
  }),
  { git: true },
)
