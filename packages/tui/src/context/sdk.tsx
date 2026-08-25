import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export const EVENT_BATCH_INTERVAL_MS = 100

type PartDeltaEvent = GlobalEvent & {
  readonly payload: Extract<GlobalEvent["payload"], { readonly type: "message.part.delta" }>
}

type EventBatcherOptions<TimerHandle> = {
  readonly emit: (events: readonly GlobalEvent[]) => void
  readonly now: () => number
  readonly schedule: (run: () => void, delay: number) => TimerHandle
  readonly cancel: (timer: TimerHandle) => void
}

function isPartDelta(event: GlobalEvent | undefined): event is PartDeltaEvent {
  return event?.payload.type === "message.part.delta"
}

function samePartDelta(previous: PartDeltaEvent, current: PartDeltaEvent) {
  return (
    previous.directory === current.directory &&
    previous.project === current.project &&
    previous.workspace === current.workspace &&
    previous.payload.properties.sessionID === current.payload.properties.sessionID &&
    previous.payload.properties.messageID === current.payload.properties.messageID &&
    previous.payload.properties.partID === current.payload.properties.partID &&
    previous.payload.properties.field === current.payload.properties.field
  )
}

export function createEventBatcher<TimerHandle>(options: EventBatcherOptions<TimerHandle>) {
  let queue: GlobalEvent[] = []
  let timer: TimerHandle | undefined
  let last = 0

  const flush = () => {
    if (timer !== undefined) {
      options.cancel(timer)
      timer = undefined
    }
    if (queue.length === 0) return
    const events = queue
    queue = []
    last = options.now()
    options.emit(events)
  }

  const push = (event: GlobalEvent) => {
    const previous = queue.at(-1)
    if (isPartDelta(previous) && isPartDelta(event) && samePartDelta(previous, event)) {
      queue[queue.length - 1] = {
        ...event,
        payload: {
          ...event.payload,
          properties: {
            ...event.payload.properties,
            delta: previous.payload.properties.delta + event.payload.properties.delta,
          },
        },
      }
    } else {
      queue.push(event)
    }

    if (timer !== undefined) return
    const elapsed = options.now() - last
    if (elapsed >= EVENT_BATCH_INTERVAL_MS) {
      flush()
      return
    }
    timer = options.schedule(() => {
      timer = undefined
      flush()
    }, EVENT_BATCH_INTERVAL_MS - elapsed)
  }

  const dispose = () => {
    if (timer !== undefined) options.cancel(timer)
    timer = undefined
    queue = []
  }

  return { push, flush, dispose }
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK() {
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()

    const handlers = new Set<(event: GlobalEvent) => void>()
    const emitter = {
      emit(_type: "event", event: GlobalEvent) {
        for (const handler of handlers) handler(event)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }

    const retryDelay = 1000
    const maxRetryDelay = 30000
    const eventBatcher = createEventBatcher({
      emit: (events) => {
        batch(() => {
          for (const event of events) emitter.emit("event", event)
        })
      },
      now: Date.now,
      schedule: setTimeout,
      cancel: clearTimeout,
    })

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          const events = await sdk.global.event({
            signal: ctrl.signal,
            sseMaxRetryAttempts: 0,
          })

          if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
            // Start syncing workspaces, it's important to do this after
            // we've started listening to events
            await sdk.sync.start().catch(() => {})
          }

          for await (const event of events.stream) {
            if (ctrl.signal.aborted) break
            eventBatcher.push(event)
          }

          eventBatcher.flush()
          attempt += 1
          if (abort.signal.aborted || ctrl.signal.aborted) break

          // Exponential backoff
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    onMount(async () => {
      if (props.events) {
        const unsub = await props.events.subscribe(eventBatcher.push)
        onCleanup(unsub)

        if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
          // Start syncing workspaces, it's important to do this after
          // we've started listening to events
          await sdk.sync.start().catch(() => {})
        }
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      eventBatcher.dispose()
      handlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
    }
  },
})
