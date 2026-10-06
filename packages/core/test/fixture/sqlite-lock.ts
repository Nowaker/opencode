import { Effect } from "effect"
import { expect } from "bun:test"

export const holdSqliteWriter = (filename: string, milliseconds: number) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, `${import.meta.dir}/sqlite-lock-holder.ts`, filename, String(milliseconds)], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }),
    ),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode === null) child.kill()
        await child.exited
      }),
  ).pipe(
    Effect.tap((child) =>
      Effect.promise(async () => {
        const reader = child.stdout.getReader()
        const ready = await reader.read()
        reader.releaseLock()
        expect(new TextDecoder().decode(ready.value)).toBe("locked\n")
      }),
    ),
  )
