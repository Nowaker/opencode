import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { SessionMaintenanceSql } from "../src/database/session-maintenance-sql"
import { SessionMaintenanceConflict } from "../src/database/session-maintenance-conflict"
import { spawnSync } from "node:child_process"

test("conflict guards use indexed point lookups with empty and active fences on 100000 rows", () => {
  // Given a large ownership table and the actual generated persistent and TEMP guards.
  using db = new Database(":memory:")
  db.exec("CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,data TEXT); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000) INSERT INTO part SELECT 'p'||x,'s'||x,'data' FROM n")
  for (const ddl of SessionMaintenanceSql.schema) db.exec(ddl)
  for (const ddl of SessionMaintenanceSql.connection) db.exec(ddl)
  const guards = SessionMaintenanceConflict.triggers({ table: "part", columns: ["session_id"] }, [
    [{ name: "rowid", collation: "BINARY" }], [{ name: "id", collation: "BINARY" }],
  ])
  for (const ddl of guards) db.exec(ddl)
  for (const active of [false, true]) {
    if (active) db.exec("INSERT INTO session_maintenance_fence VALUES('s1','active','replacement'); INSERT INTO session_maintenance_generation VALUES('s1',1)")
    // When SQLite plans the exact guard predicate with the candidate row bound.
    for (const guard of guards) {
      const predicate = guard.slice(guard.indexOf("WHEN ") + 5, guard.indexOf("\n      BEGIN"))
        .replaceAll('NEW."rowid"', "100000").replaceAll('NEW.rowid', "100000").replaceAll('NEW."id"', "'p100000'")
      const plan = db.query<{ detail: string }, []>(`EXPLAIN QUERY PLAN SELECT 1 WHERE ${predicate}`).all()
      // Then no existing-row scan is permitted, including with a nonempty fence set.
      expect(plan.filter(row => /SCAN existing/i.test(row.detail))).toEqual([])
      expect(plan.some(row => /SEARCH existing/i.test(row.detail))).toBe(true)
    }
    db.exec("UPDATE part SET data='unrelated' WHERE id='p100000'")
  }
})

test("actual trigger execution stays below 500 VM steps on 500000 rows with empty and active fences", () => {
  // Given both kinds of production conflict guard installed on half a million rows.
  const target = { table: "part", columns: ["session_id"] }
  const guards = SessionMaintenanceConflict.triggers(target, [
    [{ name: "rowid", collation: "BINARY" }], [{ name: "id", collation: "BINARY" }],
  ])
  const setup = [
    "CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,data TEXT)",
    "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<500000) INSERT INTO part SELECT 'p'||x,'s'||x,'data' FROM n",
    ...SessionMaintenanceSql.schema, ...SessionMaintenanceSql.connection,
    ...SessionMaintenanceSql.triggers(target), ...SessionMaintenanceSql.generationTriggers(target), ...guards,
  ].join(";\n")
  // When SQLite counts actual executed VM instructions for unrelated update and insert paths.
  const result = spawnSync("sqlite3", [":memory:"], { encoding: "utf8", input: `${setup};
.stats vmstep
UPDATE part SET data='empty' WHERE id='p500000';
INSERT INTO part VALUES('p500001','other','empty');
.stats off
INSERT INTO session_maintenance_fence VALUES('s1','active','replacement');
INSERT INTO session_maintenance_generation VALUES('s1',1);
.stats vmstep
UPDATE part SET data='active' WHERE id='p500000';
INSERT INTO part VALUES('p500002','other','active');
` })
  // Then neither the empty nor active path performs work proportional to the table size.
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  const steps = [...result.stdout.matchAll(/VM-steps: (\d+)/g)].map(match => Number(match[1]))
  expect(steps).toHaveLength(4)
  for (const count of steps) expect(count).toBeLessThan(500)
  console.info("maintenance VM steps (500000 rows; empty update/insert, active update/insert):", steps)
})
