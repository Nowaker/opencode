import { CliRenderEvents, type CliRenderer } from "@opentui/core"
import { batch, createEffect, createSignal, onCleanup, untrack } from "solid-js"
import type { SessionInbox } from "@opencode/schema/session-inbox"

// A submit the composer refused only because the catalogs it resolves an agent and model from were still loading.
// A composer holds at most one: Enter again joins it, while observed changed content, an explicit agent, model or variant
// choice, a route or location change, or unmount cancels it for good. Once the catalogs settle it binds the pair the
// existing resolver picks, shows that pair in the footer, and after the frame that painted it submits once with the
// frozen pair. A catalog that fails to load, or settles without a usable pair, drops it with a visible error;
// nothing retries it.

/** The agent and model one submission uses, and the composer and location they were chosen for. */
export type SubmitBinding = {
  readonly sessionID: string | undefined
  readonly location: string
  readonly agentID: string
  readonly providerID: string
  readonly modelID: string
  readonly variant: string | undefined
}

export type SubmitResolution =
  | { readonly type: "loading" }
  | { readonly type: "unavailable"; readonly show: () => void }
  | { readonly type: "ready"; readonly binding: SubmitBinding }

/** Taken when the native editor reports Enter; inert once a later submission starts or the intent ends. */
export type SubmitTicket = {
  readonly live: () => boolean
  readonly submit: () => void
}

export type SubmitIntentOptions = {
  readonly renderer: CliRenderer
  /** The location key this composer submits to while its route shows it; undefined otherwise. */
  readonly owner: () => string | undefined
  /** Increments on each explicit agent, model or variant choice. */
  readonly choice: () => number
  /** A displayed or durable pair already known when Enter is pressed. */
  readonly capture: () => SubmitBinding | undefined
  /** Text, parts and mode, excluding caret and selection. */
  readonly content: () => string
  /** Joins the loads of everything a resolution reads. */
  readonly load: () => Promise<unknown>
  readonly resolve: (captured?: SubmitBinding) => SubmitResolution
  /** Whether the footer visibly shows this binding. */
  readonly displayed: (binding: SubmitBinding) => boolean
  readonly fail: (error: unknown) => void
  readonly consume: (delivery: SessionInbox.Delivery, binding: SubmitBinding) => void
}

type Intent = {
  readonly delivery: SessionInbox.Delivery
  readonly owner: string
  readonly content: string
  readonly choice: number
  readonly captured: SubmitBinding | undefined
}

export function createSubmitIntent(options: SubmitIntentOptions) {
  const [intent, setIntent] = createSignal<Intent>()
  const [settled, setSettled] = createSignal(false)
  const [binding, setBinding] = createSignal<SubmitBinding>()
  const [content, setContent] = createSignal<string>()
  // Native Enter tickets stay live only until the next submission starts or the intent ends.
  let generation = 0
  let publication: (() => void) | undefined

  function cancel() {
    generation++
    if (publication) options.renderer.off(CliRenderEvents.FRAME, publication)
    publication = undefined
    batch(() => {
      setIntent(undefined)
      setSettled(false)
      setBinding(undefined)
      setContent(undefined)
    })
  }

  function edited() {
    const snapshot = content()
    // Native callbacks observe the current content. An edit and revert in one input chunk may leave an identical
    // snapshot and still send; once a callback observes different content, later reverting cannot revive the intent.
    if (snapshot !== undefined && options.content() !== snapshot) cancel()
  }

  createEffect(edited)

  createEffect(() => {
    const current = intent()
    if (current && (options.owner() !== current.owner || options.choice() !== current.choice)) untrack(cancel)
  })

  // Binds once: a catalog refresh or preference reload after this never rebinds the published pair.
  createEffect(() => {
    const current = intent()
    if (!current || !settled() || binding()) return
    const resolution = options.resolve(current.captured)
    if (resolution.type === "loading") return
    untrack(() => publish(current, resolution))
  })

  onCleanup(cancel)

  function publish(current: Intent, resolution: Exclude<SubmitResolution, { type: "loading" }>) {
    switch (resolution.type) {
      case "unavailable":
        cancel()
        return resolution.show()
      case "ready": {
        const next = resolution.binding
        setBinding(next)
        // The frame that paints the bound pair is the one boundary between showing it and sending with it.
        publication = () => consume(current, next)
        options.renderer.once(CliRenderEvents.FRAME, publication)
        options.renderer.requestRender()
        return
      }
      default: {
        const exhaustive: never = resolution
        return exhaustive
      }
    }
  }

  function consume(current: Intent, next: SubmitBinding) {
    publication = undefined
    if (intent() !== current || binding() !== next) return
    const valid =
      options.owner() === current.owner &&
      options.choice() === current.choice &&
      options.content() === current.content &&
      options.displayed(next)
    cancel()
    if (!valid) return
    const resolution = options.resolve(next)
    switch (resolution.type) {
      case "ready":
        return options.consume(current.delivery, next)
      case "unavailable":
        return resolution.show()
      case "loading":
        return options.fail(new Error("The selected model is not ready to send the prompt"))
      default: {
        const exhaustive: never = resolution
        return exhaustive
      }
    }
  }

  return {
    /** An intent exists; Enter joins it instead of submitting again. */
    pending: () => intent() !== undefined,
    /** The pair a pending submission is bound to; the footer shows it until the submission starts. */
    binding,
    /** A submission is starting; earlier native Enter tickets go inert. */
    enter() {
      generation++
      setContent(undefined)
    },
    ticket(run: (captured: SubmitBinding | undefined) => void): SubmitTicket {
      const issued = generation
      const owner = options.owner()
      const choice = options.choice()
      const snapshot = options.content()
      const captured = options.capture()
      if (content() === undefined) setContent(snapshot)
      const live = () => {
        if (issued !== generation) return false
        if (owner === undefined || owner !== options.owner() || choice !== options.choice() || snapshot !== options.content()) {
          cancel()
          return false
        }
        return true
      }
      return {
        live,
        submit: () => {
          if (!live()) return
          if (!intent()) {
            generation++
            setContent(undefined)
          }
          run(captured)
        },
      }
    },
    request(delivery: SessionInbox.Delivery, requested?: { readonly captured: SubmitBinding | undefined }) {
      const owner = options.owner()
      if (owner === undefined || intent()) return
      const next = {
        delivery,
        owner,
        content: options.content(),
        choice: options.choice(),
        captured: requested ? requested.captured : options.capture(),
      }
      setContent(next.content)
      setIntent(next)
      options.load().then(
        () => {
          if (intent() === next) setSettled(true)
        },
        (error: unknown) => {
          if (intent() !== next) return
          cancel()
          options.fail(error)
        },
      )
    },
    /** Observe the draft's current text, attachments, mentions, pasted parts and mode. */
    edited,
  }
}
