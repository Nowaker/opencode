import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { tmpdir } from "./fixture/tmpdir"

test("live runtime process rejects a replaced identity while accepting an unrelated write", async () => {
  // Given a real child runtime with its own SQLite connection and generation snapshot.
  await using tmp = await tmpdir()
  const filename = `${tmp.path}/runtime.db`
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/fixture/maintenance-writer.ts`, filename], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const reader = child.stdout.getReader()
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("ready\n")
    using maintenance = new Database(filename)
    // When another connection replaces the identity while the runtime remains alive.
    maintenance.exec(
      "BEGIN IMMEDIATE; INSERT INTO session_maintenance_generation VALUES('ses_replaced',1); INSERT INTO session_maintenance_fence VALUES('ses_replaced','','replacement'); COMMIT;",
    )
    child.stdin.end()
    const chunks: Uint8Array[] = []
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      chunks.push(next.value)
    }
    // Then both admission and stale writes fail, but unrelated work continues in that process.
    expect(await child.exited).toBe(0)
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({
      admission: "Failure",
      changed: "Failure",
      other: "Success",
    })
    const fresh = Bun.spawn([process.execPath, `${import.meta.dir}/fixture/maintenance-writer.ts`, filename], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = await new Response(fresh.stdout).text()
    expect(await fresh.exited).toBe(0)
    expect(JSON.parse(output.slice("ready\n".length))).toEqual({
      admission: "Success",
      changed: "Success",
      other: "Success",
    })
    expect(() => maintenance.exec("UPDATE event_sequence SET seq=5 WHERE aggregate_id='ses_replaced'")).toThrow(
      "session_under_maintenance",
    )
  } finally {
    reader.releaseLock()
    if (child.exitCode === null) child.kill()
    await child.exited
  }
}, 20_000)
