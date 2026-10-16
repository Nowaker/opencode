export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ConfigManaged } from "./managed"

// Project discovery mirrors v2's ConfigDiscovery.discover (packages/core/src/config/discovery.ts on upstream dev):
// the walk runs from the directory up to the filesystem root instead of stopping at the git worktree, so config in a
// directory above the repository applies too. Results are ordered farthest first, so the nearest file or `.opencode`
// directory wins. The walk is skipped when the directory is itself a global config directory, and a global config
// file or directory is never re-read through it.
export const files = Effect.fn("ConfigPaths.projectFiles")(function* (name: string, directory: string) {
  const afs = yield* FSUtil.Service
  const globals = yield* globalDirectories()
  if (globals.includes(yield* afs.resolve(directory))) return []
  const globalFiles = yield* Effect.forEach(
    globals.flatMap((dir) => fileInDirectory(dir, name)),
    (file) => afs.resolve(file),
  )
  const found = yield* afs.up({ targets: [`${name}.jsonc`, `${name}.json`], start: directory })
  return (yield* Effect.filter(found, (file) =>
    afs.resolve(file).pipe(Effect.map((resolved) => !globalFiles.includes(resolved))),
  )).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string) {
  const afs = yield* FSUtil.Service
  const globals = yield* globalDirectories()
  const project =
    Flag.OPENCODE_DISABLE_PROJECT_CONFIG || globals.includes(yield* afs.resolve(directory))
      ? []
      : yield* Effect.filter(yield* afs.up({ targets: [".opencode"], start: directory }), (dir) =>
          afs.resolve(dir).pipe(Effect.map((resolved) => !globals.includes(resolved))),
        )
  return unique([
    Global.Path.config,
    ...project.toReversed(),
    ...(yield* afs.up({
      targets: [".opencode"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

const globalDirectories = Effect.fnUntraced(function* () {
  const afs = yield* FSUtil.Service
  return yield* Effect.forEach([ConfigManaged.managedConfigDir(), Global.Path.config], (dir) => afs.resolve(dir))
})
