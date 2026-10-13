import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../test/fixture/tmpdir"
import z from "zod"

const Ready = z.object({ ready: z.literal(true), entries: z.number(), hidden: z.number(), empty: z.number() })

const duration = 3_000
const repositories = 16
const generated = 20
const repeats = 3
const ticks = Number((await new Response(Bun.spawn(["getconf", "CLK_TCK"], { stdout: "pipe" }).stdout).text()).trim())

async function cpuTicks(file: string) {
  try {
    const stat = await fs.readFile(file, "utf8")
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)
    return Number(fields[11]) + Number(fields[12])
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0
    throw error
  }
}

async function sample(pid: number) {
  const threads = await Promise.all((await fs.readdir(`/proc/${pid}/task`)).map(async (tid) =>
    ({ tid, ticks: await cpuTicks(`/proc/${pid}/task/${tid}/stat`) }),
  ))
  const descriptors = await fs.readdir(`/proc/${pid}/fdinfo`)
  const watches = await Promise.all(descriptors.map(async (fd) => {
    try {
      return (await fs.readFile(`/proc/${pid}/fdinfo/${fd}`, "utf8")).split("\n").filter((line) => line.startsWith("inotify wd:")).length
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0
      throw error
    }
  }))
  return { time: performance.now(), processTicks: await cpuTicks(`/proc/${pid}/stat`), threads, watches: watches.reduce((sum, count) => sum + count, 0) }
}

function difference(before: Awaited<ReturnType<typeof sample>>, after: Awaited<ReturnType<typeof sample>>) {
  const elapsed = after.time - before.time
  const threads = after.threads.map((thread) => ({
    tid: thread.tid,
    cpuPercent: 100_000 * (thread.ticks - (before.threads.find((item) => item.tid === thread.tid)?.ticks ?? 0)) / ticks / elapsed,
  }))
  return { elapsedMs: elapsed, watchesBefore: before.watches, watchesAfter: after.watches, cpuPercent: 100_000 * (after.processTicks - before.processTicks) / ticks / elapsed, threads }
}

await using tmp = await tmpdir()
const root = path.join(tmp.path, "container")
const home = path.join(tmp.path, "home")
await fs.mkdir(root)
await fs.mkdir(home)
const churn: string[] = []
for (let repo = 0; repo < repositories; repo++) {
  const base = path.join(root, `repo-${repo}`)
  await fs.mkdir(base)
  const git = Bun.spawn(["git", "init", "--quiet", base], { env: { PATH: process.env.PATH, HOME: home, GIT_MASTER: "1" }, stdout: "ignore", stderr: "ignore" })
  if (await git.exited !== 0) throw new Error("synthetic nested git initialization failed")
  await fs.writeFile(path.join(base, ".gitignore"), "node_modules/\nbuild/\n")
  await fs.writeFile(path.join(base, "entry.ts"), "needle\n")
  for (let index = 0; index < generated; index++) {
    for (const category of ["node_modules", "build", "src"]) {
      const folder = path.join(base, category, `generated-${index}`)
      await fs.mkdir(folder, { recursive: true })
      const file = path.join(folder, "output.txt")
      await fs.writeFile(file, "output\n")
      if (index === 0 || category === "src") churn.push(file)
    }
  }
}
await fs.writeFile(path.join(root, ".hidden-probe"), "needle\n")
await fs.writeFile(path.join(root, "entry.ts"), "needle\n")
const results = []
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const mode of ["baseline", "candidate", "repository"] as const) {
    if (mode === "repository") {
      const git = Bun.spawn(["git", "init", "--quiet", root], { env: { PATH: process.env.PATH, HOME: home, GIT_MASTER: "1" }, stdout: "ignore", stderr: "ignore" })
      if (await git.exited !== 0) throw new Error("synthetic git initialization failed")
    }
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "search-watch-worker.ts"), root, mode], {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, "config"),
        XDG_DATA_HOME: path.join(home, "data"),
        XDG_CACHE_HOME: path.join(home, "cache"),
        XDG_STATE_HOME: path.join(home, "state"),
        OPENCODE_TOOLS_DATA_DIR: path.join(home, "tools"),
        OPENCODE_PLUGINS_DATA_DIR: path.join(home, "plugins"),
      }, stdout: "pipe", stderr: "pipe",
    })
    try {
      const initial = await sample(child.pid)
      const reader = child.stdout.getReader()
      let timeout: ReturnType<typeof setTimeout> | undefined
      const ready = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("backend readiness timeout")), 10_000)
        }),
      ]).finally(() => clearTimeout(timeout))
      if (ready.done) throw new Error(await new Response(child.stderr).text())
      const message = Ready.parse(JSON.parse(new TextDecoder().decode(ready.value)))
      const start = await sample(child.pid)
      await Bun.sleep(duration)
      const idle = await sample(child.pid)
      let batches = 0
      const end = performance.now() + duration
      while (performance.now() < end) {
        await Promise.all(churn.map((file) => fs.writeFile(file, `output-${batches}\n`)))
        batches++
        await Bun.sleep(25)
      }
      const active = await sample(child.pid)
      if (mode === "candidate" ? active.watches !== 0 : active.watches === 0) throw new Error("backend watch-count control failed")
      results.push({ repeat, mode, entries: message.entries, hidden: message.hidden, empty: message.empty, batches, startup: difference(initial, start), idle: difference(start, idle), churn: difference(idle, active) })
      reader.releaseLock()
    } finally {
      child.kill()
      await child.exited
    }
    if (mode === "repository") await fs.rm(path.join(root, ".git"), { recursive: true })
  }
}
const output = { scale: { repositories, generated, churnFiles: churn.length, duration, repeats }, results }
if (process.argv[2]) await Bun.write(process.argv[2], JSON.stringify(output, null, 2))
console.log(JSON.stringify({ scale: output.scale, results: results.map((result) => ({
  repeat: result.repeat, mode: result.mode, entries: result.entries, hidden: result.hidden, empty: result.empty, batches: result.batches,
  watches: result.churn.watchesAfter, idleCPU: result.idle.cpuPercent, churnCPU: result.churn.cpuPercent,
  startupMs: result.startup.elapsedMs, startupCPU: result.startup.cpuPercent,
  busiestThreadCPU: Math.max(...result.churn.threads.map((thread) => thread.cpuPercent)),
})) }, null, 2))
