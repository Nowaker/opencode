import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { Hash } from "@opencode/util/hash"

// Keep source fingerprints and import attempts together. Filesystem events
// should reload changed local graphs, not repeat unchanged evaluations.
//
// A read does not wait for its watches: arming one per graph file can take a
// long time, and the plugin should not wait for it. An edit landing before a
// watch is armed produces no event, so once every watch of a read has settled
// the graph is fingerprinted again, and a difference reports one change.
export function createPluginSources(watch: (file: string) => Promise<void>, changed: () => void) {
  const sources = new Map<string, Source>()
  const cleanups: Array<() => void> = []
  return {
    read: async (entrypoint: string) => {
      const previous = sources.get(entrypoint)
      if (previous && current(previous.files)) return previous.loaded

      const files: Source["files"] = new Map()
      const arming: Promise<void>[] = []
      const track = (file: string, directory = false) => {
        if (files.has(file)) return
        files.set(file, { digest: digest(file, directory), directory })
        const pending = watch(file)
        // Watch setup can be interrupted while module evaluation is still pending.
        void pending.catch(() => {})
        arming.push(pending)
      }
      track(fileURLToPath(entrypoint))
      const { prepareSource } = await import("#plugin-source")
      const prepared: { version: string; load: () => Promise<unknown>; dispose?: () => void } = await prepareSource(
        entrypoint,
        track,
      )
      if (prepared.dispose) cleanups.push(prepared.dispose)
      // Cache the attempt before evaluating it: unchanged failing modules must
      // not repeat import-time effects on every filesystem notification.
      const loaded = prepared.load().then((module) => ({ version: prepared.version, module }))
      sources.set(entrypoint, { loaded, files })
      // Node's loader tracks dependencies while it evaluates, so every watch of
      // this read has been requested only once the attempt settles.
      void loaded
        .catch(() => undefined)
        .then(() => Promise.allSettled(arming))
        .then(() => {
          if (sources.get(entrypoint)?.files === files && !current(files)) changed()
        })
      return loaded
    },
    dispose: () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
      sources.clear()
    },
  }
}

type Source = {
  loaded: Promise<{ version: string; module: unknown }>
  files: Map<string, { digest: string; directory: boolean }>
}

function current(files: Source["files"]) {
  return [...files].every(([file, item]) => item.digest === digest(file, item.directory))
}

function digest(file: string, directory: boolean) {
  try {
    return Hash.sha256(directory ? JSON.stringify(readdirSync(file).sort()) : readFileSync(file))
  } catch {
    return "missing"
  }
}

export function localSource(spec: string, directory: string) {
  if (spec.startsWith("file://")) return new URL(spec)
  if (spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec))
    return pathToFileURL(path.resolve(directory, spec))
  return undefined
}
