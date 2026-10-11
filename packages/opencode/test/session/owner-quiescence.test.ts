import { expect, test } from "bun:test"
import path from "node:path"

test("owner admission scenarios use an isolated process owner", async () => {
  const child = Bun.spawn([process.execPath, "test/fixtures/owner-quiescence.ts"], {
    cwd: path.resolve(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const [code, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(errors)
    expect(code).toBe(0)
    console.log(output.trim())
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM")
    await child.exited
  }
}, 15_000)
