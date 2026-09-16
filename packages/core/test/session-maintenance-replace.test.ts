import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { SessionMaintenanceSql } from "../src/database/session-maintenance-sql"
import { SessionMaintenanceConflict } from "../src/database/session-maintenance-conflict"

for (const statement of [
  "INSERT OR REPLACE INTO message VALUES('original','other','overwrite')",
  "UPDATE OR REPLACE message SET id='original' WHERE id='other'",
  "INSERT OR REPLACE INTO message(rowid,id,session_id,data) VALUES(1,'fresh','other','overwrite')",
]) {
  test(`refuses implicit deletion of a fenced row: ${statement}`, () => {
    // Given default recursive_triggers=OFF and a protected conflicting row.
    using db = new Database(":memory:")
    db.exec("CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT); INSERT INTO message VALUES('original','protected','keep'),('other','other','other')")
    for (const ddl of SessionMaintenanceSql.schema) db.exec(ddl)
    for (const ddl of SessionMaintenanceSql.triggers({ table: "message", columns: ["session_id"] })) db.exec(ddl)
    for (const ddl of SessionMaintenanceSql.connection) db.exec(ddl)
    for (const ddl of SessionMaintenanceConflict.triggers({ table: "message", columns: ["session_id"] }, [
      [{ name: "id", collation: "BINARY" }], [{ name: "rowid", collation: "BINARY" }],
    ])) db.exec(ddl)
    db.exec("INSERT INTO session_maintenance_fence VALUES('protected','operation','replace')")
    // When REPLACE would silently delete the conflicting protected row.
    expect(() => db.exec(statement)).toThrow("session_under_maintenance")
    // Then its original content remains intact.
    expect(db.query("SELECT data FROM message WHERE id='original'").get()).toEqual({ data: "keep" })
  })
}
