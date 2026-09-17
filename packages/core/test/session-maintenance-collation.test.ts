import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { SessionMaintenanceSql } from "../src/database/session-maintenance-sql"
import { SessionMaintenanceConflict } from "../src/database/session-maintenance-conflict"

for (const generation of [false, true]) {
  test(`composite per-index collations preserve old conflicting owners (${generation ? "generation" : "fence"})`, () => {
    // Given BINARY columns with a unique index using different NOCASE and RTRIM semantics.
    using db = new Database(":memory:")
    db.exec(`CREATE TABLE item(id TEXT PRIMARY KEY,session_id TEXT,k1 TEXT,k2 TEXT);
      CREATE UNIQUE INDEX custom_key ON item(k1 COLLATE NOCASE,k2 COLLATE RTRIM);
      INSERT INTO item VALUES('protected','A','Key','value'),('other','B','Other','value')`)
    for (const ddl of SessionMaintenanceSql.schema) db.exec(ddl)
    for (const ddl of SessionMaintenanceSql.connection) db.exec(ddl)
    for (const ddl of SessionMaintenanceConflict.triggers({ table: "item", columns: ["session_id"] }, [
      [{ name: "id", collation: "BINARY" }], [{ name: "rowid", collation: "BINARY" }],
      [{ name: "k1", collation: "NOCASE" }, { name: "k2", collation: "RTRIM" }],
    ])) db.exec(ddl)
    db.exec(generation ? "INSERT INTO session_maintenance_generation VALUES('A',1)" : "INSERT INTO session_maintenance_fence VALUES('A','active','replacement')")
    const error = generation ? "session_identity_changed" : "session_under_maintenance"
    // When inserts or updates collide under the declared index collations, not the column defaults.
    expect(() => db.exec("INSERT OR REPLACE INTO item VALUES('new','B','KEY','value  ')")).toThrow(error)
    expect(() => db.exec("UPDATE OR REPLACE item SET k1='KEY',k2='value  ' WHERE id='other'")).toThrow(error)
    // Then the protected row remains, and an unrelated composite key remains writable.
    expect(db.query("SELECT session_id FROM item WHERE id='protected'").get()).toEqual({ session_id: "A" })
    db.exec("INSERT INTO item VALUES('allowed','B','KEY','different')")
  })
}
