import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { SessionMaintenanceSql } from "../src/database/session-maintenance-sql"

function fixture() {
  const db = new Database(":memory:")
  db.exec(
    "CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,title TEXT); INSERT INTO session VALUES('a',NULL,'old'),('b',NULL,'unrelated')",
  )
  for (const statement of SessionMaintenanceSql.schema) db.exec(statement)
  for (const statement of SessionMaintenanceSql.triggers({ table: "session", columns: ["id", "parent_id"] }))
    db.exec(statement)
  for (const statement of SessionMaintenanceSql.connection) db.exec(statement)
  for (const statement of SessionMaintenanceSql.generationTriggers({ table: "session", columns: ["id", "parent_id"] }))
    db.exec(statement)
  return db
}

test("rejects stale session writes after replacement while unrelated writes succeed", () => {
  // Given a connection that loaded generation zero before maintenance.
  using db = fixture()
  db.exec("INSERT INTO session_maintenance_generation VALUES('a',1)")
  // When an old connection tries to edit the replaced identity.
  expect(() => db.exec("UPDATE session SET title='stale' WHERE id='a'")).toThrow("session_identity_changed")
  // Then unrelated sessions are still writable.
  db.exec("UPDATE session SET title='changed' WHERE id='b'")
  expect(db.query("SELECT title FROM session WHERE id='b'").get()).toEqual({ title: "changed" })
})

test("refuses children attached to a replaced parent", () => {
  // Given a stale parent identity.
  using db = fixture()
  db.exec("INSERT INTO session_maintenance_generation VALUES('a',1)")
  // When the stale connection creates a descendant.
  expect(() => db.exec("INSERT INTO session VALUES('child','a','child')")).toThrow("session_identity_changed")
  // Then the child was not persisted.
  expect(db.query("SELECT id FROM session WHERE id='child'").get()).toBeNull()
})

test("blocks fenced writes without requiring a connection function", () => {
  // Given a fence visible to even an older, uninstrumented SQLite connection.
  using db = new Database(":memory:")
  db.exec("CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,title TEXT)")
  for (const statement of SessionMaintenanceSql.schema) db.exec(statement)
  for (const statement of SessionMaintenanceSql.triggers({ table: "session", columns: ["id", "parent_id"] }))
    db.exec(statement)
  db.exec("INSERT INTO session_maintenance_fence VALUES('a','operation','replace');")
  // When the old writer inserts a fenced identity.
  expect(() => db.exec("INSERT INTO session VALUES('a',NULL,'blocked')")).toThrow("session_under_maintenance")
  // Then an unfenced insert needs no missing UDF and succeeds.
  db.exec("INSERT INTO session VALUES('b',NULL,'allowed')")
  expect(db.query("SELECT count(*) AS count FROM session").get()).toEqual({ count: 1 })
})
