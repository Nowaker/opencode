import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LegacyEvent } from "../src/legacy-event"
import { PermissionV1 } from "../src/permission-v1"
import { QuestionV1 } from "../src/question-v1"
import { Project } from "../src/project"
import { SessionV1 } from "../src/session-v1"

describe("legacy public event schemas", () => {
  test("retains abort provenance and decodes legacy errors", () => {
    const decode = Schema.decodeUnknownSync(SessionV1.AbortedError.Schema)
    for (const data of [
      { message: "Aborted" },
      { message: "Aborted", cause: "cancel", requester: "tui" },
      { message: "Aborted", cause: "cancel", requester: "tui-revert" },
      { message: "Aborted", cause: "cancel", requester: "api" },
      { message: "Aborted", cause: "dispose", dispose: "exit" },
      { message: "Aborted", cause: "dispose", dispose: "reload" },
      { message: "Aborted", cause: "dispose", dispose: "config" },
      { message: "Aborted", cause: "dispose", dispose: "api" },
      { message: "Aborted", cause: "killed" },
    ] as const) {
      const error = { name: "MessageAbortedError" as const, data }
      expect(decode(error)).toEqual(error)
    }
  })

  test("omits undefined abort fields and rejects unknown enum values", () => {
    const error = {
      name: "MessageAbortedError" as const,
      data: { message: "Aborted", cause: undefined, dispose: undefined, requester: undefined },
    }
    expect(Schema.encodeSync(SessionV1.AbortedError.Schema)(error)).toEqual({
      name: "MessageAbortedError",
      data: { message: "Aborted" },
    })
    for (const data of [
      { message: "Aborted", cause: "unknown" },
      { message: "Aborted", dispose: "unknown" },
      { message: "Aborted", requester: "unknown" },
    ]) {
      expect(Schema.is(SessionV1.AbortedError.Schema)({ name: "MessageAbortedError", data })).toBe(false)
    }
  })

  test("owns all SessionV1 definitions", () => {
    expect(SessionV1.Event.Definitions.map((event) => event.type)).toEqual([
      "session.created",
      "session.updated",
      "session.deleted",
      "message.updated",
      "message.removed",
      "message.part.updated",
      "message.part.removed",
      "message.part.delta",
      "session.diff",
      "session.error",
    ])
    const durable = SessionV1.Event.Definitions.filter((event) => event.durable !== undefined)
    expect(durable).toHaveLength(7)
    expect(durable.every((event) => event.durable?.aggregate === "sessionID")).toBe(true)
    expect(durable.every((event) => event.durable?.version === 1)).toBe(true)
  })

  test("owns the legacy transient public definitions", () => {
    expect([
      SessionV1.PartDelta.type,
      SessionV1.Diff.type,
      SessionV1.Error.type,
      PermissionV1.Event.Asked.type,
      PermissionV1.Event.Replied.type,
      QuestionV1.Event.Asked.type,
      QuestionV1.Event.Replied.type,
      QuestionV1.Event.Rejected.type,
      Project.Event.Updated.type,
      LegacyEvent.CommandExecuted.type,
    ]).toEqual([
      "message.part.delta",
      "session.diff",
      "session.error",
      "permission.asked",
      "permission.replied",
      "question.asked",
      "question.replied",
      "question.rejected",
      "project.updated",
      "command.executed",
    ])
  })
})
