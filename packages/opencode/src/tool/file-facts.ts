import path from "path"
import { existsSync, lstatSync, readlinkSync, realpathSync, statSync } from "fs"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { InstanceContext } from "../project/instance-context"
import { resolveTarget } from "./external-directory"

// Facts about a file that the file tools put into their output only when they
// apply: where a symbolic link leads, unusual line endings or a BOM, and
// whether the file changed on disk since this session last read or wrote it.

export const STALE =
  "File has been modified since read, either by the user or by a linter. Read it again before attempting to write it."

export const STALE_NOTE =
  "Note: the file had changed on disk since your last read; re-read it before edits that depend on surrounding content."

export type Link = {
  // The symbolic link on the way to the file: the file itself or a directory above it.
  path: string
  // The link's target as stored in the link.
  target: string
  // Where the file really is, following every link.
  real: string
  // The link points at nothing.
  missing: boolean
}

// Undefined for an ordinary path. Directories above the file are only checked
// inside the project, so a project that itself lives under a linked directory
// (for example ~/projects -> /Volumes/projects) does not mark every file.
export function link(filepath: string, ins: InstanceContext): Link | undefined {
  if (lstatSync(filepath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    return {
      path: filepath,
      target: readlinkSync(filepath),
      real: resolveTarget(filepath),
      missing: !existsSync(filepath),
    }
  }
  const base = projectRoot(filepath, ins)
  if (!base) return
  const parent = linkedParent(path.dirname(filepath), base)
  if (!parent) return
  return { path: parent, target: readlinkSync(parent), real: resolveTarget(filepath), missing: !existsSync(parent) }
}

// The read tool's `<symlink>` line.
export function describe(item: Link, filepath: string, ins: InstanceContext, kind: "file" | "directory" = "file") {
  const where = `${item.real} (${scope(item.real, ins)})`
  if (item.path === filepath) return item.target === item.real ? where : `${item.target} -> ${where}`
  const base = projectRoot(filepath, ins) ?? path.dirname(item.path)
  return `${path.relative(base, item.path)} -> ${item.target}, so this ${kind} is ${where}`
}

export function dangling(item: Link) {
  return `Refusing to write ${item.path}: it is a symbolic link to ${item.target} (${item.real}), which does not exist. Write to ${item.real} to create it.`
}

export function bytes(size: number) {
  return size === 1 ? "1 byte" : `${size} bytes`
}

// The BOM a sample starts with, if any. UTF-16 files are refused as binary by
// the read tool, so naming the encoding tells the model why.
export function encoding(sample: Uint8Array) {
  if (sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) return "UTF-8 with BOM"
  if (sample[0] === 0xff && sample[1] === 0xfe) return "UTF-16 LE with BOM"
  if (sample[0] === 0xfe && sample[1] === 0xff) return "UTF-16 BE with BOM"
}

// Counts the kinds of line breaks in text fed chunk by chunk, keeping a CR at
// the end of one chunk until the next shows whether it starts a CRLF.
export function lineEndings() {
  const seen = { crlf: false, lf: false, cr: false, pending: false }
  return {
    feed(text: string) {
      if (!seen.pending && !text.includes("\r")) {
        if (text.includes("\n")) seen.lf = true
        return
      }
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        if (seen.pending) {
          seen.pending = false
          if (code === 10) {
            seen.crlf = true
            continue
          }
          seen.cr = true
        }
        if (code === 13) seen.pending = true
        if (code === 10) seen.lf = true
      }
    },
    // Undefined for plain LF (or no line breaks at all).
    label() {
      const kinds = [seen.crlf && "crlf", seen.lf && "lf", (seen.cr || seen.pending) && "cr"].filter(
        (kind) => typeof kind === "string",
      )
      if (kinds.length === 0 || (kinds.length === 1 && kinds[0] === "lf")) return
      if (kinds.length === 1) return kinds[0]
      return `mixed (${kinds.join(", ")})`
    },
  }
}

type Stamp = { mtime: number; size: number }

// Session ID -> real path -> what the file looked like when the session last
// read or wrote it. Both maps keep recency order and drop the oldest entry.
const stamps = new Map<string, Map<string, Stamp>>()
const MAX_SESSIONS = 256
const MAX_FILES_PER_SESSION = 1024

export function remember(sessionID: string, filepath: string) {
  const info = statSync(filepath, { throwIfNoEntry: false })
  if (!info?.isFile()) return
  const files = stamps.get(sessionID) ?? new Map<string, Stamp>()
  stamps.delete(sessionID)
  stamps.set(sessionID, files)
  if (stamps.size > MAX_SESSIONS) stamps.delete(stamps.keys().next().value!)
  const real = realpathSync(filepath)
  files.delete(real)
  files.set(real, { mtime: info.mtimeMs, size: info.size })
  if (files.size > MAX_FILES_PER_SESSION) files.delete(files.keys().next().value!)
}

// True when the session read or wrote this file and it has changed on disk
// since. A file the session never touched is not guarded here.
export function changed(sessionID: string, filepath: string) {
  const info = statSync(filepath, { throwIfNoEntry: false })
  if (!info?.isFile()) return false
  const seen = stamps.get(sessionID)?.get(realpathSync(filepath))
  if (!seen) return false
  return seen.mtime !== info.mtimeMs || seen.size !== info.size
}

function projectRoot(filepath: string, ins: InstanceContext) {
  if (FSUtil.contains(ins.directory, filepath)) return ins.directory
  if (ins.worktree !== "/" && FSUtil.contains(ins.worktree, filepath)) return ins.worktree
}

function linkedParent(dir: string, base: string): string | undefined {
  if (dir === base || !FSUtil.contains(base, dir)) return
  if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) return dir
  return linkedParent(path.dirname(dir), base)
}

function scope(real: string, ins: InstanceContext) {
  const roots = [ins.directory, ins.worktree === "/" ? undefined : ins.worktree]
    .filter((root) => root !== undefined)
    .map((root) => (existsSync(root) ? realpathSync(root) : root))
  if (roots.some((root) => FSUtil.contains(root, real))) return "inside this worktree"
  const repo = gitRoot(path.dirname(real))
  return repo ? `outside this worktree, in git repo ${repo}` : "outside this worktree"
}

function gitRoot(dir: string): string | undefined {
  if (existsSync(path.join(dir, ".git"))) return dir
  const parent = path.dirname(dir)
  return parent === dir ? undefined : gitRoot(parent)
}

export * as FileFacts from "./file-facts"
