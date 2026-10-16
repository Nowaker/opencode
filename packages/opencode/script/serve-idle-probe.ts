import { createServer } from "node:net"
import { readFile } from "node:fs/promises"
import path from "node:path"

export async function waitFor<T>(read: () => Promise<T | undefined>, message: string, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await read()
    if (result !== undefined) return result
    await Bun.sleep(20)
  }
  throw new Error(message)
}

export async function unusedPort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  if (!address || typeof address === "string") throw new Error("missing dynamic TCP port")
  return address.port
}

export type ProcessIdentity = { readonly pid: number; readonly start: string; readonly parent: number }

export async function identity(pid: number): Promise<ProcessIdentity | undefined> {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (!stat) return undefined
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
  if (fields[0] === "Z") return undefined
  const start = fields[19]
  if (!start) throw new Error("missing process start identity")
  return { pid, start, parent: Number(fields[1]) }
}

export async function alive(process: ProcessIdentity) {
  return (await identity(process.pid))?.start === process.start
}

export async function sample(processes: readonly ProcessIdentity[]) {
  const live = (
    await Promise.all(processes.map(async (process) => ((await alive(process)) ? process : undefined)))
  ).filter((process) => process !== undefined)
  const rss = await Promise.all(
    live.map(async (process) => {
      const value = await readFile(`/proc/${process.pid}/status`, "utf8").catch(() => "")
      return Number(value.match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0) * 1024
    }),
  )
  return { processes: live.length, rss: rss.reduce((sum, value) => sum + value, 0) }
}

export async function fixtureProcesses(directory: string) {
  return Promise.all(
    ["mcp.pid", "mcp-child.pid"].map(async (name) => {
      const file = Bun.file(path.join(directory, name))
      return waitFor(
        async () => ((await file.exists()) ? identity(Number(await file.text())) : undefined),
        "MCP fixture did not start",
      )
    }),
  )
}
