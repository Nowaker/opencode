export * as ConfigDraftResolve from "./draft-resolve.js"

import { Config } from "@opencode/schema/config"
import { isRecord } from "@opencode/util/record"
import { Schema, type Types } from "effect"

const decode = Schema.decodeUnknownSync(Config.Info)
const accumulated = new Set(["permissions", "plugins"])
const layered = new Set(["providers", "agents", "commands", "references", "formatter", "mcp", "compaction", "media"])

/** A loaded-document view; catalog defaults and directory discovery stay with their domain owners. */
export function resolve(entries: readonly Config.Entry[]): Types.DeepMutable<Config.Info> {
  const values: Record<string, unknown> = {}
  for (const entry of entries) {
    switch (entry.type) {
      case "directory":
        break
      case "document":
        for (const [key, value] of Object.entries(entry.info)) {
          if (value === undefined) continue
          values[key] =
            key === "policies"
              ? [...list(value), ...list(values[key])]
              : accumulated.has(key)
                ? [...list(values[key]), ...list(value)]
                : key === "instructions" || key === "skills"
                  ? [...new Set([...list(values[key]), ...list(value)])]
                  : key === "watcher"
                    ? { ignore: [...list(record(values[key]).ignore), ...list(record(value).ignore)] }
                    : layered.has(key)
                      ? merge(values[key], value, [key])
                      : value
        }
        break
      default:
        entry satisfies never
    }
  }
  // Schema classes are readonly contracts. A separate, recursively copied object is the callback's mutable draft.
  const draft: Types.DeepMutable<Config.Info> = {}
  Object.defineProperties(
    draft,
    Object.fromEntries(
      Object.entries(decode(plain(values))).map(([key, value]) => [
        key,
        { value: plain(value), writable: true, enumerable: true, configurable: true },
      ]),
    ),
  )
  return draft
}

/** Object traversal also removes schema prototypes, so draft comparison is about values alone. */
export function plain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plain)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => (item === undefined ? [] : [[key, plain(item)]])),
  )
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function merge(before: unknown, after: unknown, path: readonly string[]): unknown {
  if (after === undefined) return before
  if (path[0] === "agents" && path.length === 2 && (record(before).disabled || record(after).disabled)) return after
  if (path[0] === "agents" && path.length === 3 && path[2] === "permissions") return [...list(before), ...list(after)]
  if (path[0] === "providers" && path.at(-1) === "variants" && Array.isArray(after)) {
    const variants = new Map(list(before).map((item) => [record(item).id, item]))
    for (const item of after) {
      const id = record(item).id
      variants.set(id, merge(variants.get(id), item, [...path, String(id)]))
    }
    return [...variants.values()]
  }
  if (!isRecord(after) || atomic(path)) return after
  if (path[0] === "providers" && path.at(-1) === "headers") {
    return Object.fromEntries(
      [...Object.entries(record(before)), ...Object.entries(after)]
        .reduce((headers, entry) => headers.set(entry[0].toLowerCase(), entry), new Map<string, [string, unknown]>())
        .values(),
    )
  }
  return Object.fromEntries(
    new Set([...Object.keys(record(before)), ...Object.keys(after)])
      .values()
      .map((key) => [key, merge(record(before)[key], after[key], [...path, key])]),
  )
}

/** These objects replace as a unit in the native consumers rather than merging their nested members. */
export function atomic(path: readonly string[]): boolean {
  if (path.length === 1) return !layered.has(path[0]) && path[0] !== "watcher"
  if ((path[0] === "commands" || path[0] === "references") && path.length === 2) return true
  if (path[0] === "mcp" && path[1] === "servers" && path.length === 3) return true
  if (path[0] === "agents")
    return (path.length === 3 && path[2] === "model") || (path.length === 5 && path[2] === "request")
  return false
}
