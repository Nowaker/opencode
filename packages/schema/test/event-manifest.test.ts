import { describe, expect, test } from "bun:test"
import { Event, FileSystem, Integration, Permission, Project, Pty, Question, Reference, Session, Workspace } from "../src"
import { Catalog } from "../src/catalog"
import { EventManifest } from "../src/event-manifest"
import { FileSystemWatcher } from "../src/filesystem-watcher"
import { IdeEvent } from "../src/ide-event"
import { ModelsDev } from "../src/models-dev"
import { Plugin } from "../src/plugin"
import { ProjectDirectories } from "../src/project-directories"
import { SessionEvent } from "../src/session-event"
import { SessionTodo } from "../src/session-todo"
import { SessionV1 } from "../src/session-v1"
import { WorkspaceEvent } from "../src/workspace-event"

const legacySessionDurable = [
  SessionV1.Event.Created,
  SessionV1.Event.Updated,
  SessionV1.Event.Deleted,
  SessionV1.Event.MessageUpdated,
  SessionV1.Event.MessageRemoved,
  SessionV1.Event.PartUpdated,
  SessionV1.Event.PartRemoved,
]
const legacySessionLive = [SessionV1.Event.PartDelta, SessionV1.Event.Diff, SessionV1.Event.Error]

describe("public event manifest", () => {
  test("indexes each current public wire type exactly once", () => {
    const types = EventManifest.Definitions.map((definition) => definition.type)
    expect(types).toEqual([...new Set(types)])
    expect([...EventManifest.Latest.keys()].sort()).toEqual(types.sort())
    for (const definition of EventManifest.Definitions) {
      expect(EventManifest.Latest.get(definition.type) === definition, definition.type).toBe(true)
    }
  })

  test("shares canonical current events with v2 and keeps legacy live events off that surface", () => {
    const server = new Map<string, Event.Definition>(
      EventManifest.ServerDefinitions.map((definition) => [definition.type, definition]),
    )
    const currentPublic = [
      ...legacySessionDurable,
      ...SessionEvent.Definitions,
      ...Catalog.Event.Definitions,
      ...FileSystem.Event.Definitions,
      ...FileSystemWatcher.Event.Definitions,
      ...Integration.Event.Definitions,
      ...ModelsDev.Event.Definitions,
      ...Permission.Event.Definitions,
      ...Plugin.Event.Definitions,
      ...ProjectDirectories.Event.Definitions,
      ...Pty.Event.Definitions,
      ...Question.Event.Definitions,
      ...Reference.Event.Definitions,
      ...SessionTodo.Event.Definitions,
    ]
    expect(EventManifest.ServerDefinitions.map((definition) => definition.type).sort()).toEqual(
      currentPublic.map((definition) => definition.type).sort(),
    )
    for (const definition of currentPublic) {
      expect(server.get(definition.type) === definition, definition.type).toBe(true)
      expect(EventManifest.Latest.get(definition.type) === definition, definition.type).toBe(true)
    }
    for (const definition of legacySessionLive) {
      expect(EventManifest.Latest.get(definition.type) === definition, definition.type).toBe(true)
      expect(server.has(definition.type), definition.type).toBe(false)
      expect(definition.durable, definition.type).toBeUndefined()
    }
    expect(EventManifest.Latest.has(IdeEvent.Installed.type)).toBe(false)
    expect(server.has(IdeEvent.Installed.type)).toBe(false)
  })

  test("retains the canonical v1 session event family", () => {
    const v1 = new Map(SessionV1.Event.Definitions.map((definition) => [definition.type, definition] as const))
    expect(SessionV1.Event.Definitions.map((definition) => definition.type).sort()).toEqual(
      [...legacySessionDurable, ...legacySessionLive].map((definition) => definition.type).sort(),
    )
    for (const definition of [...legacySessionDurable, ...legacySessionLive]) {
      expect(v1.get(definition.type) === definition, definition.type).toBe(true)
    }
  })

  test("uses canonical definitions for current public events", () => {
    expect(Session.Event).toBe(SessionEvent)
    expect(Session.Event.Definitions).toBe(SessionEvent.Definitions)
    expect(Workspace.Event).toBe(WorkspaceEvent)
    expect(Workspace.Event.Definitions).toBe(WorkspaceEvent.Definitions)
    expect(EventManifest.Latest.get("project.updated")).toBe(Project.Event.Updated)
    expect(Project.Event.Definitions).toEqual([Project.Event.Updated])
    expect(FileSystem.Event.Definitions).toEqual([FileSystem.Event.Edited])
    expect(Integration.Event.Definitions).toEqual([Integration.Event.Updated, Integration.Event.ConnectionUpdated])
    expect(Permission.Event.Definitions).toEqual([Permission.Event.Asked, Permission.Event.Replied])
    expect(Reference.Event.Definitions).toEqual([Reference.Event.Updated])
    expect(IdeEvent.Definitions).toEqual([IdeEvent.Installed])
  })

  test("resolves durable replay keys to their canonical session schemas", () => {
    const replayKeys = [...legacySessionDurable, ...SessionEvent.DurableDefinitions].map((definition) => {
      const version = definition.durable?.version
      if (version === undefined) throw new Error(`Missing durable version for ${definition.type}`)
      const key = Event.versionedType(definition.type, version)
      expect(EventManifest.Durable.get(key) === definition, key).toBe(true)
      return key
    })
    expect([...EventManifest.Durable.keys()].sort()).toEqual(replayKeys.sort())
    expect(EventManifest.Durable.has("session.next.step.ended.1")).toBe(false)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
  })
})
