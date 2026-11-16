import { randomUUID } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { LiveFrame } from "@opencode-ai/plugin"
import { PublicationFence } from "./publication-fence"
import { isRecord } from "@/util/record"
import type { SessionStatus } from "./status"

type Attachment = { readonly frames: ReadableStream<LiveFrame>; readonly close: () => void }
type Source = () => readonly SessionV1.Part[]
type Snapshot = { readonly messages: SessionV1.WithParts[]; readonly status: SessionStatus.Info }
type NativeEvent = { readonly type: string; readonly data: unknown }
type Subscriber = {
  readonly omitted: Set<string>
  readonly send: (frame: LiveFrame) => void
  readonly close: () => void
  readonly epoch: string
  sequence: number
}
type State = {
  readonly fence: ReturnType<typeof PublicationFence.make>
  readonly sources: Map<Source, ((event: NativeEvent) => void) | undefined>
  readonly subscribers: Set<Subscriber>
  users: number
}

export interface Interface {
  readonly guard: <A, E, R>(sessionID: string, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly register: (sessionID: string, source: Source, onEvent?: (event: NativeEvent) => void) => Effect.Effect<() => void>
  readonly capture: (event: NativeEvent) => void
  readonly raw: (part: SessionV1.ToolPart, delta: string) => void
  readonly open: <E, R>(
    input: { sessionID: string; signal?: AbortSignal },
    read: Effect.Effect<Snapshot, E, R>,
  ) => Effect.Effect<Attachment, E | DOMException, R>
}
export class Service extends Context.Service<Service, Interface>()("@opencode/LiveEvents") {}
export class Overflow extends Error {
  constructor() {
    super("Live event consumer overflow")
    this.name = "LiveEventsOverflow"
  }
}
const generation = randomUUID()
const relevant = new Set([
  "message.updated", "message.removed", "message.part.updated", "message.part.removed",
  "message.part.delta", "session.status", "session.error", "session.deleted",
])

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const sessions = new Map<string, State>()
  const state = (sessionID: string) => {
    const existing = sessions.get(sessionID)
    if (existing) return existing
    const created: State = { fence: PublicationFence.make(), sources: new Map(), subscribers: new Set(), users: 0 }
    sessions.set(sessionID, created)
    return created
  }
  const prune = (sessionID: string, entry: State) => {
    if (!entry.users && !entry.sources.size && !entry.subscribers.size) sessions.delete(sessionID)
  }
  const guard: Interface["guard"] = (sessionID, work) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const entry = state(sessionID)
        entry.users++
        return entry
      }),
      (entry) => entry.fence.guard(work),
      (entry) => Effect.sync(() => {
        entry.users--
        prune(sessionID, entry)
      }),
    )
  const capture = (event: NativeEvent) => {
    if (!relevant.has(event.type) || !isRecord(event.data) || typeof event.data.sessionID !== "string") return
    const entry = sessions.get(event.data.sessionID)
    if (!entry) return
    for (const onEvent of entry.sources.values()) onEvent?.(event)
    if (!entry.subscribers.size) return
    const info = isRecord(event.data.info) ? event.data.info : undefined
    const part = isRecord(event.data.part) ? event.data.part : undefined
    const messageID = event.data.messageID ?? info?.id ?? part?.messageID
    for (const sub of entry.subscribers) {
      if (typeof messageID === "string" && sub.omitted.has(messageID)) continue
      sub.send({
        type: "vibeterm.stream.event",
        properties: {
          version: 1,
          sessionID: event.data.sessionID,
          epoch: sub.epoch,
          sequence: ++sub.sequence,
          event: { type: event.type, properties: structuredClone(event.data) },
        },
      })
    }
  }
  const open: Interface["open"] = (input, read) => Effect.gen(function* () {
    if (input.signal?.aborted) return yield* Effect.fail(new DOMException("Aborted", "AbortError"))
    const entry = state(input.sessionID)
    entry.users++
    let controller: ReadableStreamDefaultController<LiveFrame>
    let closed = false
    const close = (error?: Error, cancelled = false) => {
      if (closed) return
      closed = true
      entry.subscribers.delete(sub)
      input.signal?.removeEventListener("abort", abort)
      if (!cancelled) {
        if (error) controller.error(error)
        else controller.close()
      }
      prune(input.sessionID, entry)
    }
    const abort = () => close(new DOMException("Aborted", "AbortError"))
    const sub: Subscriber = {
      omitted: new Set(),
      epoch: `${generation}:${randomUUID()}`,
      sequence: 0,
      close,
      send(frame) {
        if (closed) return
        if ((controller.desiredSize ?? 0) <= 0) return close(new Overflow())
        controller.enqueue(frame)
      },
    }
    const frames = new ReadableStream<LiveFrame>(
      {
        start(value) { controller = value },
        cancel() { close(undefined, true) },
      },
      { highWaterMark: 256 },
    )
    input.signal?.addEventListener("abort", abort, { once: true })
    const cancelled = Effect.callback<never, DOMException>((resume) => {
      if (!input.signal) return
      const cancel = () => {
        input.signal?.removeEventListener("abort", cancel)
        resume(Effect.fail(new DOMException("Aborted", "AbortError")))
      }
      input.signal.addEventListener("abort", cancel, { once: true })
      if (input.signal.aborted) cancel()
      return Effect.sync(() => input.signal?.removeEventListener("abort", cancel))
    })
    return yield* entry.fence.snapshot(Effect.gen(function* () {
      const snapshot = yield* read
      const history = snapshot.messages
      const active = entry.sources.size > 0 || snapshot.status.type !== "idle" || snapshot.status.paused !== undefined
        ? history.findLast((message) => message.info.role === "assistant")
        : undefined
      const parentID = active?.info.role === "assistant" ? active.info.parentID : undefined
      const start = parentID === undefined
        ? history.findLastIndex((message) => message.info.role === "user")
        : history.findIndex((message) => message.info.id === parentID)
      const messages = structuredClone(history.slice(Math.max(0, start)))
      for (const message of history.slice(0, Math.max(0, start))) sub.omitted.add(message.info.id)
      for (const source of entry.sources.keys()) {
        for (const part of source()) {
          const message = messages.find((message) => message.info.id === part.messageID)
          if (!message) continue
          const index = message.parts.findIndex((existing) => existing.id === part.id)
          if (index < 0) continue
          const stored = message.parts[index]
          if (
            stored.type === "tool" && part.type === "tool" &&
            stored.state.status === "pending" && part.state.status === "pending"
          ) {
            message.parts[index] = { ...stored, state: { ...stored.state, raw: part.state.raw } }
          }
          if (
            (stored.type === "text" || stored.type === "reasoning") &&
            stored.type === part.type && stored.time?.end === undefined
          ) {
            message.parts[index] = part
          }
        }
      }
      sub.send({
        type: "vibeterm.stream.snapshot",
        properties: {
          version: 1,
          sessionID: input.sessionID,
          epoch: sub.epoch,
          sequence: 0,
          messages,
          status: structuredClone(snapshot.status),
        },
      })
      entry.subscribers.add(sub)
      return { frames, close: () => close() }
    })).pipe(
      Effect.raceFirst(cancelled),
      Effect.onError(() => Effect.sync(() => close())),
      Effect.ensuring(Effect.sync(() => {
        entry.users--
        prune(input.sessionID, entry)
      })),
    )
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => {
    for (const entry of sessions.values()) for (const sub of entry.subscribers) sub.close()
    sessions.clear()
  }))
  return Service.of({
    guard,
    capture,
    open,
    register: (sessionID, source, onEvent) => Effect.sync(() => {
      const entry = state(sessionID)
      entry.sources.set(source, onEvent)
      return () => {
        entry.sources.delete(source)
        prune(sessionID, entry)
      }
    }),
    raw: (part, delta) => {
      if (!sessions.get(part.sessionID)?.subscribers.size) return
      capture({
        type: "message.part.delta",
        data: {
          sessionID: part.sessionID,
          messageID: part.messageID,
          partID: part.id,
          callID: part.callID,
          field: "state.raw",
          delta,
        },
      })
    },
  })
}))
export const node = LayerNode.make({ service: Service, layer, deps: [] })
export * as LiveEvents from "./live-events"
