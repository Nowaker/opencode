export * as SessionMaintenanceWrite from "./session-maintenance-write"

type Connection = { exec(query: string): unknown }

/** Retired IDs remain fenced to old binaries. Only an instrumented connection
 * retries under a private transaction; its TEMP generation guards remain active.
 * Active maintenance fences are never removed by this path. */
export function run<T>(connection: Connection, write: () => T): T {
  try {
    return write()
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("session_under_maintenance")) throw error
  }
  connection.exec("SELECT 1 FROM temp.session_maintenance_snapshot LIMIT 0")
  connection.exec("SAVEPOINT session_retired_write")
  try {
    connection.exec(
      "CREATE TEMP TABLE IF NOT EXISTS session_retired_write AS SELECT * FROM main.session_maintenance_fence WHERE 0",
    )
    connection.exec("DELETE FROM temp.session_retired_write")
    connection.exec(
      "INSERT INTO temp.session_retired_write SELECT * FROM main.session_maintenance_fence WHERE operation=''",
    )
    connection.exec("DELETE FROM main.session_maintenance_fence WHERE operation=''")
    const result = write()
    connection.exec("INSERT INTO main.session_maintenance_fence SELECT * FROM temp.session_retired_write")
    connection.exec("DELETE FROM temp.session_retired_write")
    connection.exec("RELEASE session_retired_write")
    return result
  } catch (error) {
    connection.exec("ROLLBACK TO session_retired_write; RELEASE session_retired_write")
    throw error
  }
}
