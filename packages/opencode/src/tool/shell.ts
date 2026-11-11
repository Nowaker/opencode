import { Cause, Effect, Exit, Fiber, Semaphore, Stream } from "effect"
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { lazy } from "@/util/lazy"
import { Language, type Node } from "web-tree-sitter"

import { FSUtil } from "@opencode-ai/core/fs-util"
import { fileURLToPath } from "url"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Shell } from "@opencode-ai/core/shell"
import { ShellID } from "./shell/id"

import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ShellPrompt, type Parameters } from "./shell/prompt"
import { BashArity } from "@/permission/arity"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceRef } from "@/effect/instance-ref"
import { Identifier } from "@opencode-ai/core/id/id"
import { ShellBackgroundEvent } from "@opencode-ai/schema/shell-background-event"

export { Parameters } from "./shell/prompt"

const MAX_METADATA_LENGTH = 30_000
/** A bare sleep is a wait, not work: at its timeout it is stopped, never moved to the background. */
const BARE_SLEEP = /^sleep\s+\S+$/
/** How much of a background command's output its exit notice carries; the rest is in its output file. */
const EXIT_NOTICE_LINES = 40
const EXIT_NOTICE_BYTES = 4000
/** Background limit when `bash_background.timeout` is not set. */
const BACKGROUND_TIMEOUT_MS = 30 * 60 * 1000
const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
const CMD_FILES = new Set([
  "copy",
  "del",
  "dir",
  "erase",
  "md",
  "mkdir",
  "move",
  "rd",
  "ren",
  "rename",
  "rmdir",
  "type",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

type Part = {
  type: string
  text: string
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

type Chunk = {
  text: string
  size: number
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

function parts(node: Node) {
  const out: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean, cmd = false) {
  if (!ps) {
    return list
      .slice(1)
      .filter(
        (item) =>
          !item.text.startsWith("-") &&
          !(cmd && item.text.startsWith("/")) &&
          !(list[0]?.text === "chmod" && item.text.startsWith("+")),
      )
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return {
      text,
      cut: false,
    }
  }

  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
        out.unshift(buf.subarray(start).toString("utf-8"))
      }
      break
    }
    out.unshift(lines[i])
    bytes += size
  }
  return {
    text: out.join("\n"),
    cut: true,
  }
}

const parse = Effect.fn("ShellTool.parse")(function* (command: string, ps: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree
})

const ask = Effect.fn("ShellTool.ask")(function* (ctx: Tool.Context, scan: Scan, input: { command: string }) {
  if (scan.dirs.size > 0) {
    const directories = Array.from(scan.dirs)
    const globs = directories.map((dir) => {
      if (process.platform === "win32") return FSUtil.normalizePathPattern(path.join(dir, "*"))
      return path.join(dir, "*")
    })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {
        command: input.command,
        directories,
        patterns: globs,
      },
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: ShellID.ToolID,
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {
      command: input.command,
    },
  })
})

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}
const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const psPath = resolveWasm(psWasm)
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
})

export const ShellTool = Tool.define(
  ShellID.ToolID,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const fs = yield* FSUtil.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service
    const flags = yield* RuntimeFlags.Service
    const background = yield* BackgroundJob.Service
    const events = yield* EventV2Bridge.Service
    const defaultTimeoutMs = flags.bashDefaultTimeoutMs ?? 2 * 60 * 1000

    const cygpath = Effect.fn("ShellTool.cygpath")(function* (shell: string, text: string) {
      const lines = yield* spawner
        .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const file = lines[0]?.trim()
      if (!file) return
      return FSUtil.normalizePath(file)
    })

    const resolvePath = Effect.fn("ShellTool.resolvePath")(function* (text: string, root: string, shell: string) {
      if (process.platform === "win32") {
        if (Shell.posix(shell) && text.startsWith("/") && FSUtil.windowsPath(text) === text) {
          const file = yield* cygpath(shell, text)
          if (file) return file
        }
        return FSUtil.normalizePath(path.resolve(root, FSUtil.windowsPath(text)))
      }
      return path.resolve(root, text)
    })

    const argPath = Effect.fn("ShellTool.argPath")(function* (arg: string, cwd: string, ps: boolean, shell: string) {
      const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
      const file = text && prefix(text)
      if (!file || dynamic(file, ps)) return
      const next = ps ? provider(file) : file
      if (!next) return
      return yield* resolvePath(next, cwd, shell)
    })

    const collect = Effect.fn("ShellTool.collect")(function* (
      root: Node,
      cwd: string,
      ps: boolean,
      shell: string,
      instance: InstanceContext,
    ) {
      const scan: Scan = {
        dirs: new Set<string>(),
        patterns: new Set<string>(),
        always: new Set<string>(),
      }
      const shellKind = ShellID.toKind(Shell.name(shell))

      for (const node of commands(root)) {
        const command = parts(node)
        const tokens = command.map((item) => item.text)
        const cmd = ps || shellKind === "cmd" ? tokens[0]?.toLowerCase() : tokens[0]

        if (cmd && (FILES.has(cmd) || (shellKind === "cmd" && CMD_FILES.has(cmd)))) {
          for (const arg of pathArgs(command, ps, shellKind === "cmd")) {
            const resolved = yield* argPath(arg, cwd, ps, shell)
            yield* Effect.logInfo("resolved path", { arg, resolved })
            if (!resolved || containsPath(resolved, instance)) continue
            const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
            scan.dirs.add(dir)
          }
        }

        if (tokens.length && (!cmd || !CWD.has(cmd))) {
          scan.patterns.add(source(node))
          scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
        }
      }

      return scan
    })

    const shellEnv = Effect.fn("ShellTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, messageID: ctx.messageID, callID: ctx.callID, source: "tool" },
        { env: {} },
      )
      return {
        ...process.env,
        ...extra.env,
      }
    })

    const run = Effect.fn("ShellTool.run")(function* (
      input: {
        shell: string
        command: string
        cwd: string
        env: NodeJS.ProcessEnv
        timeout: number
        runInBackground: boolean
        onTimeout: ShellPrompt.OnTimeout
        backgroundTimeoutMs: number | false
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      const instance = yield* InstanceRef
      const id = Identifier.create("bash", "ascending")
      const startedAt = Date.now()
      // `full`, `file` and `sink` change together while the reader appends; one lock keeps a chunk from landing in
      // `full` after it was written out to the file.
      const outputLock = Semaphore.makeUnsafe(1)
      let full = ""
      let last = ""
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false
      let capped = false
      // A loaded host can take many seconds to spawn, and the exit event can be published later still, so the reported
      // duration runs from the spawn to the exit rather than from the call to the publish.
      const exited: { code: number | null; spawnedAt?: number; at?: number } = { code: null }
      // Set once the call has returned and the command runs on in the background: its part is final, so the
      // streaming preview stops.
      let detached = false

      const preview_ = (output: string) => (detached ? Effect.void : ctx.metadata({ metadata: { output } }))

      const closeSink = Effect.fnUntraced(function* () {
        const stream = sink
        if (!stream) return
        sink = undefined
        if (stream.destroyed || stream.closed) return
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              let settled = false
              const done = () => {
                if (settled) return
                settled = true
                stream.off("close", done)
                stream.off("error", done)
                stream.off("finish", done)
                resolve()
              }
              stream.once("close", done)
              stream.once("error", done)
              stream.once("finish", done)
              stream.end(done)
            }),
        ).pipe(Effect.catch(() => Effect.void))
      })

      /** Moves the output to a file that keeps growing, so a background command's whole output can be read later. */
      const outputFile = () =>
        outputLock.withPermits(1)(
          Effect.gen(function* () {
            if (file) return file
            const next = yield* trunc.write(full)
            file = next
            sink = createWriteStream(next, { flags: "a" })
            full = ""
            return next
          }),
        )

      const onChunk = (chunk: string) =>
        outputLock.withPermits(1)(
          Effect.gen(function* () {
            const size = Buffer.byteLength(chunk, "utf-8")
            list.push({ text: chunk, size })
            used += size
            while (used > keep && list.length > 1) {
              const item = list.shift()
              if (!item) break
              used -= item.size
              cut = true
            }

            last = preview(last + chunk)

            if (file) {
              sink?.write(chunk)
              return
            }
            full += chunk
            if (Buffer.byteLength(full, "utf-8") <= limits.maxBytes) return
            const next = yield* trunc.write(full)
            file = next
            cut = true
            sink = createWriteStream(next, { flags: "a" })
            full = ""
          }),
        ).pipe(Effect.andThen(() => preview_(last)))

      const backgroundCap = Effect.gen(function* () {
        yield* background.waitForPromotion(id)
        if (input.backgroundTimeoutMs === false) return yield* Effect.never
        const left = Math.max(0, input.backgroundTimeoutMs - (Date.now() - startedAt))
        yield* Effect.sleep(`${left} millis`)
      })

      const publishExited = (exit: Exit.Exit<string, unknown>) =>
        Effect.gen(function* () {
          const job = yield* background.get(id)
          if (job?.metadata?.background !== true) return
          const status = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
            ? "cancelled"
            : capped
              ? "timeout"
              : exited.code === 0
                ? "completed"
                : "failed"
          const raw = list.map((item) => item.text).join("")
          yield* events.publish(ShellBackgroundEvent.Exited, {
            sessionID: ctx.sessionID,
            id,
            command: input.command,
            status,
            ...(exited.code === null ? {} : { exitCode: exited.code }),
            durationMs: Math.max(0, (exited.at ?? Date.now()) - (exited.spawnedAt ?? startedAt)),
            outputPath: file,
            output: tail(raw, EXIT_NOTICE_LINES, EXIT_NOTICE_BYTES).text,
          })
        }).pipe(
          Effect.provideService(InstanceRef, instance),
          Effect.catchCause((cause) => Effect.logError("shell background exit event failed", { id, cause })),
        )

      // The process runs inside a background job rather than the call's own scope, so a command can keep running
      // after the call returns. In the foreground the call waits for it and the job is invisible.
      const runProcess = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(closeSink)
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env))
          exited.spawnedAt = Date.now()
          const reader = yield* Effect.forkScoped(Stream.runForEach(Stream.decodeText(handle.all), onChunk))
          const ended = yield* Effect.raceFirst(
            handle.exitCode.pipe(Effect.map((exitCode) => ({ kind: "exit" as const, code: exitCode }))),
            backgroundCap.pipe(Effect.map(() => ({ kind: "capped" as const, code: null }))),
          ).pipe(Effect.onInterrupt(() => handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.ignore)))
          if (ended.kind === "capped") {
            capped = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          exited.code = ended.code
          exited.at = Date.now()
          yield* Fiber.join(reader).pipe(Effect.timeoutOption("1 second"), Effect.ignore)
          return ""
        }),
      ).pipe(Effect.onExit(publishExited))

      yield* ctx.metadata({
        metadata: {
          output: "",
        },
      })

      const started = Effect.fnUntraced(function* (reason: "requested" | "timeout") {
        const outputPath = yield* outputFile()
        detached = true
        yield* events.publish(ShellBackgroundEvent.Started, {
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID ?? "",
          id,
          command: input.command,
          outputPath,
          reason,
          timeoutMs: input.backgroundTimeoutMs === false ? null : input.backgroundTimeoutMs,
        })
        return outputPath
      })

      const notice = (outputPath: string) =>
        `Output is being written to: ${outputPath}. You will be notified when it exits; do not poll it or sleep waiting for it.`

      yield* background.start({
        id,
        type: ShellID.ToolID,
        title: input.command,
        metadata: {
          parentSessionId: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          command: input.command,
          ...(input.runInBackground ? { background: true } : {}),
        },
        run: runProcess,
      })

      if (input.runInBackground) {
        const outputPath = yield* started("requested")
        return {
          title: input.command,
          metadata: {
            output: "",
            exit: null,
            truncated: false,
            background: true,
            jobId: id,
            outputPath,
          },
          output: `Command running in background with ID: ${id}. ${notice(outputPath)}`,
        }
      }

      const abort = Effect.callback<void>((resume) => {
        if (ctx.abort.aborted) return resume(Effect.void)
        const handler = () => resume(Effect.void)
        ctx.abort.addEventListener("abort", handler, { once: true })
        return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
      })

      const outcome = yield* Effect.raceAll([
        background.wait({ id }).pipe(Effect.map(() => "exit" as const)),
        abort.pipe(Effect.map(() => "abort" as const)),
        Effect.sleep(`${input.timeout + 100} millis`).pipe(Effect.map(() => "timeout" as const)),
      ]).pipe(Effect.onInterrupt(() => (detached ? Effect.void : background.cancel(id).pipe(Effect.asVoid))))

      let movedTo: string | undefined
      if (outcome === "abort") {
        aborted = true
        yield* background.cancel(id)
      }
      if (outcome === "timeout") {
        if (input.onTimeout === "background" && !BARE_SLEEP.test(input.command.trim())) {
          if (yield* background.promote(id)) movedTo = yield* started("timeout")
        } else {
          expired = true
          yield* background.cancel(id)
        }
      }

      const meta: string[] = []
      if (expired) {
        meta.push(
          `shell tool terminated command after exceeding timeout ${input.timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
        )
      }
      if (aborted) meta.push("User aborted the command")
      if (movedTo) {
        meta.push(
          `The command was still running after the timeout of ${input.timeout} ms, so it moved to the background as ${id} instead of being stopped. ${notice(movedTo)}`,
        )
      }
      const snapshot = yield* outputLock.withPermits(1)(Effect.sync(() => list.map((item) => item.text).join("")))
      const end = tail(snapshot, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) {
        file = yield* trunc.write(snapshot)
      }

      let output = end.text
      if (!output) output = "(no output)"

      if (cut && file && !movedTo) {
        output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      }

      if (meta.length > 0) {
        output += "\n\n<shell_metadata>\n" + meta.join("\n") + "\n</shell_metadata>"
      }
      return {
        title: input.command,
        metadata: {
          output: last || preview(output),
          exit: movedTo ? null : exited.code,
          truncated: cut,
          ...(movedTo ? { background: true, jobId: id, outputPath: movedTo } : cut && file ? { outputPath: file } : {}),
        },
        output,
      }
    })

    return () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const shell = Shell.acceptable(cfg.shell)
        const name = Shell.name(shell)
        const limits = yield* trunc.limits()
        const onTimeout = cfg.bash_background?.on_timeout ?? "background"
        const prompt = ShellPrompt.render(name, process.platform, limits, defaultTimeoutMs, onTimeout)
        yield* Effect.logInfo("shell tool using shell", { shell })

        return {
          description: prompt.description,
          parameters: prompt.parameters,
          callTimeout: (args) => (typeof args.timeout === "number" ? args.timeout : defaultTimeoutMs),
          execute: (params: Parameters, ctx: Tool.Context) =>
            Effect.gen(function* () {
              const instanceCtx = yield* InstanceState.context
              const cwd = params.workdir
                ? yield* resolvePath(params.workdir, instanceCtx.directory, shell)
                : instanceCtx.directory
              if (params.timeout !== undefined && params.timeout < 0) {
                throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
              }
              const timeout = params.timeout ?? defaultTimeoutMs
              const ps = Shell.ps(shell)
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const tree = yield* Effect.acquireRelease(parse(params.command, ps), (tree) =>
                    Effect.sync(() => tree.delete()),
                  )
                  const scan = yield* collect(tree.rootNode, cwd, ps, shell, instanceCtx)
                  if (!containsPath(cwd, instanceCtx)) scan.dirs.add(cwd)
                  yield* ask(ctx, scan, params)
                }),
              )

              return yield* run(
                {
                  shell,
                  command: params.command,
                  cwd,
                  env: yield* shellEnv(ctx, cwd),
                  timeout,
                  runInBackground: params.run_in_background === true,
                  onTimeout,
                  backgroundTimeoutMs: cfg.bash_background?.timeout ?? BACKGROUND_TIMEOUT_MS,
                },
                ctx,
              )
            }),
        }
      })
  }),
)
