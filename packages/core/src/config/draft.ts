export * as ConfigDraft from "./draft.js"

import { Config } from "@opencode/schema/config"
import { isRecord } from "@opencode/util/record"
import { Schema } from "effect"
import { isDeepStrictEqual } from "node:util"
import { ConfigDraftResolve } from "./draft-resolve.js"
import { ConfigIntegration } from "./integration.js"
import { ConfigManaged } from "./managed.js"

export const resolve = ConfigDraftResolve.resolve

export class EditError extends Error {
  constructor(readonly field: "plugins" | "policies") {
    super(`Config drafts cannot edit ${field}`)
    this.name = "ConfigDraft.EditError"
  }
}

type Edit = {
  readonly path: readonly string[]
  readonly value: unknown
  readonly source?: Config.Document
}

const decode = Schema.decodeUnknownSync(Config.Info)
// Copies retain their source identity without adding metadata to Config's owned documents.
const origins = new WeakMap<Config.Document, Config.Document>()

export function origin(document: Config.Document) {
  return origins.get(document) ?? document
}

class Pending extends Config.Document {
  constructor(readonly edits: readonly Edit[]) {
    super({
      type: "document",
      info: decode(edits.reduce<unknown>((info, edit) => (edit.source ? info : write(info, edit)), {})),
    })
  }
}

/** Project only the callback's changes; the input documents remain owned by Config. */
export function project(entries: readonly Config.Entry[], before: Config.Info, after: Config.Info): Config.Entry[] {
  // Validate the native callback result once, without introducing catalog data or normalizing legacy input.
  decode(ConfigDraftResolve.plain(after))
  const edits = differences(ConfigDraftResolve.plain(before), ConfigDraftResolve.plain(after), [])
  if (!edits.length) return [...entries]
  if (edits.some((edit) => edit.path[0] === "plugins")) throw new EditError("plugins")
  if (
    edits.some((edit) => edit.path[0] === "policies") &&
    entries.some(
      (entry) =>
        (entry instanceof ConfigManaged.Document ||
          entry instanceof ConfigIntegration.Document ||
          entry instanceof ConfigIntegration.WellKnownDocument) &&
        entry.info.policies !== undefined,
    )
  )
    throw new EditError("policies")
  const plan = edits.map((edit): Edit => {
    // Provider folds bind aliases at each source and integrations authenticate at their original position.
    // Edit an existing provider in place; path-bearing callback additions use Pending's pathless document.
    const reference =
      edit.path[0] === "references" &&
      edit.path.length === 2 &&
      isDeepStrictEqual(referencePath(read(before, edit.path)), referencePath(edit.value))
    if ((edit.path[0] !== "providers" && !reference) || edit.value === undefined) return edit
    const source = entries.findLast(
      (entry): entry is Config.Document =>
        entry.type === "document" && !(entry instanceof Pending) && read(entry.info, edit.path) !== undefined,
    )
    const owner =
      source ??
      entries.findLast(
        (entry): entry is Config.Document =>
          entry.type === "document" &&
          !(entry instanceof Pending) &&
          read(entry.info, edit.path.slice(0, 2)) !== undefined,
      )
    return owner ? { ...edit, source: origin(owner) } : edit
  })
  return apply([...entries, new Pending(plan)])
}

/** Reapply pending edits after Agent/Command directory entries have expanded into documents. */
export function apply(entries: readonly Config.Entry[]): Config.Entry[] {
  const pending = entries.filter((entry): entry is Pending => entry instanceof Pending)
  return pending.reduce<Config.Entry[]>(
    (current, plan) => {
      const projected = current.map((entry) => {
        switch (entry.type) {
          case "directory":
            return entry
          case "document": {
            const info = plan.edits.reduce<unknown>((info, edit) => {
              const source = origin(entry)
              if (edit.source && edit.source !== source) return info
              return write(info, { ...edit, value: edit.source === source ? edit.value : undefined })
            }, entry.info)
            if (isDeepStrictEqual(ConfigDraftResolve.plain(entry.info), ConfigDraftResolve.plain(info))) return entry
            // Preserve subclasses and their enumerable attribution fields (connection, organization, integrationID).
            const copy = { ...entry, info: decode(ConfigDraftResolve.plain(info)) }
            Object.setPrototypeOf(copy, Object.getPrototypeOf(entry))
            origins.set(copy, origin(entry))
            return copy
          }
          default:
            return entry satisfies never
        }
      })
      return [...projected, new Pending(plan.edits)]
    },
    entries.filter((entry) => !(entry instanceof Pending)),
  )
}

function differences(before: unknown, after: unknown, path: readonly string[]): Edit[] {
  if (isDeepStrictEqual(before, after)) return []
  if (isRecord(before) && isRecord(after) && !ConfigDraftResolve.atomic(path))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
      differences(before[key], after[key], [...path, key]),
    )
  return [{ path, value: after }]
}

function read(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((item, key) => (isRecord(item) ? item[key] : undefined), value)
}

function referencePath(value: unknown) {
  return isRecord(value) ? value.path : value
}

function write(value: unknown, edit: Edit, ancestors: readonly string[] = []): unknown {
  const [key, ...rest] = edit.path
  if (key === undefined) return edit.value
  if (!isRecord(value) && edit.value === undefined) return value
  const record = isRecord(value) ? value : {}
  const headers = ancestors[0] === "providers" && ancestors.at(-1) === "headers"
  const names = Object.keys(record).filter((name) =>
    headers ? name.toLowerCase() === key.toLowerCase() : name === key,
  )
  const current = record[names.at(-1) ?? key]
  const next = rest.length ? write(current, { ...edit, path: rest }, [...ancestors, key]) : edit.value
  if (next === current && (names.length === 0 || (names.length === 1 && names[0] === key))) return value
  return Object.fromEntries([
    ...Object.entries(record).filter(([name]) => !names.includes(name)),
    ...(next === undefined ? [] : [[key, next]]),
  ])
}
