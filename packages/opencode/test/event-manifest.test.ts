import { describe, expect, test } from "bun:test"
import { EventManifest as SchemaEventManifest } from "@opencode-ai/schema/event-manifest"
import { ServerEvent } from "@opencode-ai/schema/server-event"
import { Todo } from "@/session/todo"
import { EventManifest } from "@/event-manifest"

describe("public event manifest", () => {
  test("re-exports the canonical indexes and exposes legacy engine lifecycle events", () => {
    expect(EventManifest.Definitions).toBe(SchemaEventManifest.Definitions)
    expect(EventManifest.Latest).toBe(SchemaEventManifest.Latest)
    expect(EventManifest.Durable).toBe(SchemaEventManifest.Durable)
    expect(EventManifest.Latest.get("todo.updated")).toBe(Todo.Event.Updated)
    expect(EventManifest.Latest.get("server.connected")).toBe(ServerEvent.Connected)
    expect(EventManifest.Latest.get("global.disposed")).toBe(ServerEvent.Disposed)
  })
})
