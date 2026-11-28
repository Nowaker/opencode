import { Cause, Deferred, Effect, Exit, Fiber, Semaphore, Stream } from "effect"
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
import { ShellHandoff } from "./shell/handoff"
import { ShellBackgroundOutput } from "./shell/background-output"
import { cancelUnsettledForeground, ForegroundShellError, spawnFailureDetail } from "./shell/foreground"
import { snapshotWorktree, snapshotWriters } from "@/snapshot/writers"

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
        observation: Effect.Success<ReturnType<typeof ShellBackgroundOutput.prepare>>
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      const instance = yield* InstanceRef
      const id = Identifier.create("bash", "ascending")
      const startedAt = Date.now()
      const readinessStartedAt = performance.now()
      const handoff = !input.runInBackground && ctx.callID ? ShellHandoff.make(id, ctx.abort) : undefined
      const observed = input.observation && ShellBackgroundOutput.observe(input.observation)
      const spawned = Deferred.makeUnsafe<void>()
      const outputDrained = Deferred.makeUnsafe<void>()
      const finishDrain = Deferred.succeed(outputDrained, undefined)
      // `full`, `file` and `sink` change together while the reader appends; one lock keeps a chunk from landing in
      // `full` after it was written out to the file.
      const outputLock = Semaphore.makeUnsafe(1)
      let full = ""
      let last = ""
      const list: Chunk[] = []
      const bufferedOutput = () => list.map((item) => item.text).join("")
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let sinkClosed = false
      let cut = false
      let expired = false
      let aborted = false
      let capped = false
      let isProcessRunning = Effect.succeed(false)
      let spawnError: string | undefined
      // Undefined means the owned handle has not delivered its exit receipt.
      let exitReceipt: number | null | undefined
      // A loaded host can take many seconds to spawn, and the exit event can be published later still, so the reported
      // duration runs from the spawn to the exit rather than from the call to the publish.
      const exited: { code: number | null; spawnedAt?: number; at?: number } = { code: null }
      // Once the call leaves cleanup to the registry, its tool part no longer takes previews.
      let ownsJob = true
      const releaseJob = () => {
        ownsJob = false
      }
      // Released once Started is published, or when the call ends without announcing one. A command can exit while
      // its start is still being announced (moving the output to a file can take a while), and a listener that saw
      // Exited first would then record a job that never ends, so Exited waits for it.
      const announced = Deferred.makeUnsafe<void>()
      yield* Effect.addFinalizer(() => {
        handoff?.close()
        return Deferred.succeed(announced, undefined).pipe(
          Effect.andThen(handoff?.finish ?? Effect.void),
          Effect.andThen(() => (ownsJob ? background.cancel(id) : Effect.void)),
        )
      })

      const preview_ = (output: string) =>
        ownsJob
          ? ctx.metadata({
              metadata: { output, ...(handoff?.available() ? { foregroundJobID: id } : {}) },
            })
          : Effect.void

      const closeSink = () =>
        outputLock.withPermits(1)(
          Effect.gen(function* () {
            sinkClosed = true
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
          }),
        )

      /** Moves the output to a file that keeps growing, so a background command's whole output can be read later. */
      const outputFile = () =>
        outputLock.withPermits(1)(
          Effect.gen(function* () {
            if (file) return file
            const next = yield* trunc.write(full)
            file = next
            if (!sinkClosed) sink = createWriteStream(next, { flags: "a" })
            full = ""
            return next
          }),
        )

      const onChunk = (chunk: string) =>
        outputLock
          .withPermits(1)(
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
              observed?.append(chunk)

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
          )
          .pipe(Effect.andThen(() => preview_(last)))

      const backgroundCap = Effect.gen(function* () {
        yield* background.waitForPromotion(id)
        if (input.backgroundTimeoutMs === false) return yield* Effect.never
        const left = Math.max(0, input.backgroundTimeoutMs - (Date.now() - startedAt))
        yield* Effect.sleep(`${left} millis`)
      })

      const publishExited = (exit: Exit.Exit<string, unknown>) =>
        Effect.gen(function* () {
          if (handoff?.accepted()) yield* handoff.decision
          const job = yield* background.get(id)
          if (job?.metadata?.background !== true) return
          yield* Deferred.await(announced)
          const status = capped
            ? "timeout"
            : exited.code !== null
              ? exited.code === 0
                ? "completed"
                : "failed"
              : Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
                ? "cancelled"
                : "failed"
          const raw = bufferedOutput()
          const finalLines = observed?.finish()
          yield* events.publish(ShellBackgroundEvent.Exited, {
            sessionID: ctx.sessionID,
            id,
            command: input.command,
            status,
            ...(status === "cancelled" && job.cancelReportedBy === "background_cancel"
              ? { reportedBy: "background_cancel" as const }
              : {}),
            ...(exited.code === null ? {} : { exitCode: exited.code }),
            durationMs: Math.max(0, (exited.at ?? Date.now()) - (exited.spawnedAt ?? startedAt)),
            outputPath: file,
            output: tail(raw, EXIT_NOTICE_LINES, EXIT_NOTICE_BYTES).text,
            ...(finalLines ? { finalLines } : {}),
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
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env)).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                spawnError = spawnFailureDetail(error)
              }),
            ),
          )
          isProcessRunning = handle.isRunning.pipe(Effect.orDie)
          exited.spawnedAt = Date.now()
          yield* Deferred.succeed(spawned, undefined)
          const reader = yield* Effect.forkScoped(Stream.runForEach(Stream.decodeText(handle.all), onChunk))
          if (observed && input.observation?.notify.length) {
            yield* Deferred.await(announced).pipe(
              Effect.andThen(
                observed.drain((batch) =>
                  events
                    .publish(ShellBackgroundEvent.Lines, {
                      sessionID: ctx.sessionID,
                      id,
                      outputPath: file,
                      ...batch,
                    })
                    .pipe(
                      Effect.asVoid,
                      Effect.catchCause((cause) =>
                        Effect.logError("shell background lines event failed", { id, cause }),
                      ),
                    ),
                ),
              ),
              Effect.forkScoped,
            )
          }
          handoff?.open(isProcessRunning)
          if (handoff?.available()) {
            yield* Effect.forkScoped(Effect.suspend(() => preview_(last)), { startImmediately: true })
          }
          const ended = yield* Effect.raceFirst(
            handle.exitCode.pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  if (Exit.isSuccess(exit)) exitReceipt = exit.value
                  else if (Cause.hasFails(exit.cause)) exitReceipt = null
                }),
              ),
              Effect.map((exitCode) => {
                handoff?.close()
                return { kind: "exit" as const, code: exitCode }
              }),
            ),
            backgroundCap.pipe(Effect.map(() => ({ kind: "capped" as const, code: null }))),
          ).pipe(
            Effect.onInterrupt(() =>
              finishDrain.pipe(Effect.andThen(handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.ignore))),
            ),
          )
          if (ended.kind === "capped") {
            capped = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          exited.code = ended.code
          exited.at = Date.now()
          yield* Fiber.join(reader).pipe(Effect.timeoutOption("1 second"), Effect.ignore)
          return ""
        }).pipe(Effect.ensuring(finishDrain)),
      ).pipe(
        (work) => snapshotWriters.hold(snapshotWorktree(instance), work),
        Effect.onExit((exit) => {
          handoff?.close()
          return publishExited(exit)
        }),
      )

      yield* ctx.metadata({
        metadata: {
          output: "",
        },
      })

      const announce = Effect.fnUntraced(function* (reason: "requested" | "timeout" | "user") {
        const outputPath = yield* outputFile()
        releaseJob()
        yield* events.publish(ShellBackgroundEvent.Started, {
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID ?? "",
          id,
          command: input.command,
          outputPath,
          reason,
          timeoutMs: input.backgroundTimeoutMs === false ? null : input.backgroundTimeoutMs,
          cancelToolReceipt: 1,
        })
        return outputPath
      })
      const started = (reason: "requested" | "timeout" | "user") =>
        announce(reason).pipe(Effect.ensuring(Deferred.succeed(announced, undefined)))

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
        foreground: handoff,
        canReportCancellation: Effect.suspend(() =>
          capped || exited.at !== undefined ? Effect.succeed(false) : isProcessRunning,
        ),
        run: runProcess,
      })

      const abort = Effect.callback<void>((resume) => {
        if (ctx.abort.aborted) return resume(Effect.void)
        const handler = () => resume(Effect.void)
        ctx.abort.addEventListener("abort", handler, { once: true })
        return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
      })

      if (input.runInBackground) {
        const outputPath = yield* started("requested")
        const timeout = input.observation?.timeout
        const ready =
          observed && timeout !== undefined
            ? yield* Effect.raceAll([
                Deferred.await(spawned).pipe(Effect.andThen(observed.wait), Effect.as("ready" as const)),
                background.wait({ id }).pipe(Effect.as("exited" as const)),
                Effect.sleep(Math.max(0, timeout - (performance.now() - readinessStartedAt))).pipe(
                  Effect.as("timeout" as const),
                ),
                abort.pipe(Effect.as("aborted" as const)),
              ]).pipe(Effect.ensuring(Effect.sync(observed.stopWaiting)))
            : undefined
        const exitCode = ready === "exited" ? exited.code : null
        const outcome =
          ready === "exited"
            ? `Command exited before readiness${exitCode !== null ? ` (exit code ${exitCode})` : ""}; background ID: ${id}. Full output: ${outputPath}.`
            : `Command running in background with ID: ${id}.${ready === "ready" ? " Readiness matched." : ready === "timeout" ? ` Readiness was not reached within ${timeout} ms; the readiness timeout does not stop the job.` : ready === "aborted" ? " Stopped waiting for readiness; the job continues." : ""} ${notice(outputPath)}`
        return {
          title: input.command,
          metadata: {
            output: "",
            exit: exitCode,
            truncated: false,
            background: true,
            jobId: id,
            outputPath,
            ...(ready ? { readiness: ready } : {}),
          },
          output: outcome,
        }
      }

      const failForeground = (error: ForegroundShellError) =>
        Effect.logWarning("foreground shell failed", {
          reason: error.reason,
          id,
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
        }).pipe(Effect.andThen(Effect.fail(error)))

      const deadline = performance.now() + input.timeout + 100
      const wait = (control?: typeof handoff) =>
        Effect.raceAll([
          background.wait({ id }).pipe(Effect.map(({ info }) => ({ kind: "exit", info }) as const)),
          abort.pipe(Effect.as({ kind: "abort" } as const)),
          Effect.sleep(Math.max(0, deadline - performance.now())).pipe(
            Effect.map(() => {
              handoff?.close()
              return { kind: "timeout" } as const
            }),
          ),
          ...(control ? [control.wait.pipe(Effect.as({ kind: "user" } as const))] : []),
        ])

      let outcome = yield* wait(handoff)
      handoff?.close()
      let movedTo: string | undefined
      if (handoff?.accepted()) {
        movedTo = yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const prepared = yield* outputFile().pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("shell handoff could not open the output file", { id, cause }).pipe(
                  Effect.as(undefined),
                ),
              ),
            )
            if (!prepared) return
            if (!(yield* background.promote(id))) return
            const outputPath = yield* started("user")
            yield* handoff.confirm
            return outputPath
          }),
        )
        if (movedTo) outcome = { kind: "user" }
        else {
          yield* handoff.refuse
          outcome = yield* wait()
        }
      }
      if (outcome.kind === "abort") {
        aborted = true
        yield* background.cancel(id)
      }
      let receipt = outcome.kind === "exit" ? outcome.info : undefined
      let drainedSnapshot: string | undefined
      if (outcome.kind === "timeout") {
        const hasSpawned = yield* Deferred.isDone(spawned)
        const running = hasSpawned && exitReceipt === undefined && (yield* isProcessRunning)
        receipt = yield* background.get(id)
        if (receipt?.status === "running") {
          if (exitReceipt !== undefined) {
            // A real exit beats the deadline even if registry cleanup is still underway.
            exited.code = exitReceipt
            releaseJob()
            // Native teardown can hold outputLock; the in-memory snapshot does not need to join it.
            drainedSnapshot = yield* Deferred.await(outputDrained).pipe(Effect.map(bufferedOutput))
          } else if (!running) {
            receipt = yield* cancelUnsettledForeground(background, id, releaseJob)
            if (receipt?.status === "cancelled") {
              return yield* failForeground(
                new ForegroundShellError(
                  hasSpawned
                    ? { reason: "missing-exit", message: "Bash exited without a completion receipt." }
                    : { reason: "missing-spawn", message: "Bash did not acknowledge startup before the deadline." },
                ),
              )
            }
          } else if (input.onTimeout === "background" && !BARE_SLEEP.test(input.command.trim())) {
            if (yield* background.promote(id)) movedTo = yield* started("timeout")
            else receipt = yield* background.get(id)
          } else {
            if (yield* background.cancel(id)) expired = true
            else receipt = yield* background.get(id)
          }
        }
      }
      if (receipt?.status === "error" && !(yield* Deferred.isDone(spawned))) {
        return yield* failForeground(
          new ForegroundShellError({
            reason: "startup-failed",
            message: `Bash could not start: ${spawnError ?? "unknown startup error"}`,
          }),
        )
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
          outcome.kind === "user"
            ? `The user moved the command to the background as ${id}. ${notice(movedTo)}`
            : `The command was still running after the timeout of ${input.timeout} ms, so it moved to the background as ${id} instead of being stopped. ${notice(movedTo)}`,
        )
      }
      const snapshot = drainedSnapshot ?? (yield* outputLock.withPermits(1)(Effect.sync(bufferedOutput)))
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
              const observation = yield* ShellBackgroundOutput.prepare(params).pipe(Effect.orDie)
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

              return yield* Effect.scoped(
                run(
                  {
                    shell,
                    command: params.command,
                    cwd,
                    env: yield* shellEnv(ctx, cwd),
                    timeout,
                    runInBackground: params.run_in_background === true,
                    onTimeout,
                    backgroundTimeoutMs: cfg.bash_background?.timeout ?? BACKGROUND_TIMEOUT_MS,
                    observation,
                  },
                  ctx,
                ),
              ).pipe(Effect.orDie)
            }),
        }
      })
  }),
)
