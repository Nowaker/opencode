import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { SessionMaintenanceWrite } from "../src/database/session-maintenance-write"
import { SessionMaintenanceSql } from "../src/database/session-maintenance-sql"

function fixture() {
  const db = new Database(":memory:")
  db.exec(
    "CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,title TEXT); INSERT INTO session VALUES('a',NULL,'winner')",
  )
  for (const statement of SessionMaintenanceSql.schema) db.exec(statement)
  for (const statement of SessionMaintenanceSql.triggers({ table: "session", columns: ["id", "parent_id"] }))
    db.exec(statement)
  db.exec(
    "INSERT INTO session_maintenance_generation VALUES('a',1); INSERT INTO session_maintenance_fence VALUES('a','','replace')",
  )
  for (const statement of SessionMaintenanceSql.connection) db.exec(statement)
  for (const statement of SessionMaintenanceSql.generationTriggers({ table: "session", columns: ["id", "parent_id"] }))
    db.exec(statement)
  return db
}

test("fresh instrumented writer edits a retired ID without exposing an unfenced commit", () => {
  // Given a fresh generation-aware connection after replacement.
  using db = fixture()
  // When its native driver retries a write under the retired-ID protocol.
  SessionMaintenanceWrite.run(db, () => db.exec("UPDATE session SET title='fresh edit' WHERE id='a'"))
  // Then the write persists while the old-binary barrier remains installed.
  expect(db.query("SELECT title FROM session").get()).toEqual({ title: "fresh edit" })
  expect(db.query("SELECT operation FROM session_maintenance_fence").get()).toEqual({ operation: "" })
})

test("stale instrumented writer cannot bypass its generation guard", () => {
  // Given a connection whose snapshot predates another replacement.
  using db = fixture()
  db.exec("UPDATE session_maintenance_generation SET generation=2")
  // When it tries the instrumented retry path.
  expect(() => SessionMaintenanceWrite.run(db, () => db.exec("UPDATE session SET title='stale'"))).toThrow(
    "session_identity_changed",
  )
  // Then the barrier and winning content survive the failed statement.
  expect(db.query("SELECT title FROM session").get()).toEqual({ title: "winner" })
  expect(db.query("SELECT operation FROM session_maintenance_fence").get()).toEqual({ operation: "" })
})

test("instrumented writer cannot bypass active maintenance", () => {
  // Given an active exclusive operation.
  using db = fixture()
  db.exec("UPDATE session_maintenance_fence SET operation='active'")
  // When a current-generation writer tries to write.
  expect(() => SessionMaintenanceWrite.run(db, () => db.exec("UPDATE session SET title='racing'"))).toThrow(
    "session_under_maintenance",
  )
  // Then the operation's fence remains owned by that operation.
  expect(db.query("SELECT operation FROM session_maintenance_fence").get()).toEqual({ operation: "active" })
})
