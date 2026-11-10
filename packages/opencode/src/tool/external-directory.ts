import path from "path"
import { existsSync, lstatSync, readlinkSync, realpathSync } from "fs"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type * as Tool from "./tool"
import { containsPath } from "../project/instance-context"
import { FSUtil } from "@opencode-ai/core/fs-util"

// Matches Linux's MAXSYMLINKS; a cycle stops here instead of recursing forever.
const MAX_SYMLINK_HOPS = 40

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return false

  if (options?.bypass) return false

  const ins = yield* InstanceState.context
  const written = process.platform === "win32" ? FSUtil.normalizePath(target) : target
  // A path inside the project can still land outside it through a symlink, so
  // also check where it resolves. Paths written outside the project keep their
  // written form so existing external_directory rules for aliases still match.
  const full = containsPath(written, ins) ? FSUtil.normalizePath(resolveTarget(written)) : written
  if (containsPath(full, ins)) return false

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? FSUtil.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir: dir,
    },
  })
  return true
})

// Resolve every symlink on the way to target, including a dangling final link,
// because writing through it creates the file it points at. Missing trailing
// components are kept as written.
export function resolveTarget(target: string, hops = 0): string {
  if (existsSync(target)) return realpathSync(target)
  const parent = path.dirname(target)
  if (parent === target || hops > MAX_SYMLINK_HOPS) return target
  const dir = resolveTarget(parent, hops)
  const resolved = path.join(dir, path.basename(target))
  if (!lstatSync(resolved, { throwIfNoEntry: false })?.isSymbolicLink()) return resolved
  return resolveTarget(path.resolve(dir, readlinkSync(resolved)), hops + 1)
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options))
}
