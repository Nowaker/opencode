export * as StartupComposer from "./composer"

import { CliRenderer, CliRenderEvents, TextareaRenderable, type CliRendererConfig } from "@opentui/core"
import { createSignal } from "solid-js"
import { destroyRenderer } from "../util/renderer"
import type { StartupFrame } from "./frame"
import type { StartupInput } from "./index"
import { StartupLayer } from "./layer"

// The startup draft between the worker and the full prompt. Once the worker has stopped at a token boundary, the
// one OpenTUI renderer starts with a temporary native editor (StartupLayer) that holds the draft; the renderer's
// parser handles every later byte. The editor stays outside the application's route tree, so plugin loading and
// session history cannot unmount it, until the composer of the route the startup resolves to claims the draft in
// one synchronous step.

export type Target = { readonly type: "home" } | { readonly type: "session"; readonly sessionID: string }

export type Claimant = {
  readonly sessionID: string | undefined
  readonly input: TextareaRenderable
  /** Replaces the composer's prompt with the draft text, without touching the cursor. */
  readonly set: (text: string) => void
}

export type Composer = ReturnType<typeof create>

export type Handoff = {
  readonly renderer: CliRenderer
  readonly mode: null
  readonly complete: () => void
  readonly startup: Composer
}

/** Builds the one renderer from a finished worker handover. Undefined when the early owner fell back. */
export async function adopt(early: StartupInput.Handle, options: CliRendererConfig): Promise<Handoff | undefined> {
  const transfer = await early.handover()
  if (!transfer) return
  const stdin = process.stdin
  const stdout = process.stdout
  const renderer = new CliRenderer(stdin, stdout, stdout.columns || 80, stdout.rows || 24, options)
  transfer.adopted()
  // The constructor resumed stdin; hold kernel input until the draft's selection is restored.
  stdin.pause()
  const startup = create(renderer, {
    route: early.route,
    snapshot: transfer.snapshot,
    // Bytes the worker read past its cutoff go to the renderer's parser before anything still in the kernel.
    resume: () => {
      if (transfer.bytes.length) stdin.emit("data", Buffer.from(transfer.bytes))
      stdin.resume()
    },
  })
  try {
    await renderer.setupTerminal()
  } catch (error) {
    startup.dispose()
    destroyRenderer(renderer)
    await renderer.closed.catch(() => undefined)
    throw error
  }
  return { renderer, mode: null, complete: () => {}, startup }
}

export function create(
  renderer: CliRenderer,
  input: { readonly route: StartupFrame.Route; readonly snapshot: StartupInput.Snapshot; readonly resume: () => void },
) {
  const [active, setActive] = createSignal(true)
  // The draft is still on its way to a composer, in the temporary editor or parked.
  const [pending, setPending] = createSignal(true)
  const [target, setTarget] = createSignal<Target>()
  // Set when the claimed draft carries an explicit Enter; consumed once by its composer.
  const [submit, setSubmit] = createSignal(false)
  const claimants = new Set<Claimant>()
  let claimed: Claimant | undefined
  let disposed = false
  let edited = false
  // A draft that left the temporary editor because its session showed no composer; that composer claims it later.
  let parked: StartupLayer.Draft | undefined
  const current = () => parked ?? editor.read()
  // The text an explicit Enter applied to; any later edit that changes the text withdraws it.
  let submitted = input.snapshot.submit ? input.snapshot.text : undefined

  const editor = StartupLayer.create(renderer, input.route, input.snapshot)
  const textarea = editor.textarea
  const initial = editor.draft
  // Input stays paused until the draft is in place, so these handlers see only edits made after it.
  void StartupLayer.restore(renderer, textarea, initial).then(() => {
    textarea.onContentChange = () => {
      edited = true
      if (textarea.plainText !== submitted) submitted = undefined
    }
    textarea.onSubmit = () => {
      if (textarea.plainText.trim()) submitted = textarea.plainText
    }
    input.resume()
  })

  const touched = (draft: StartupLayer.Draft) =>
    input.snapshot.touched ||
    edited ||
    draft.text !== initial.text ||
    draft.caret !== initial.caret ||
    draft.anchor !== initial.anchor

  const claim = (claimant: Claimant) => {
    if (claimed || disposed) return
    claimed = claimant
    // Claim right after the claimant's first layout, inside the render pass: no input runs between reading the
    // temporary editor and installing its state, and the claimant's coordinates are final for its selection.
    renderer.once(CliRenderEvents.FRAME, () => {
      if (disposed || claimant.input.isDestroyed || !claimants.has(claimant)) {
        claimed = undefined
        return
      }
      const draft = current()
      const keep = touched(draft)
      setSubmit(submitted !== undefined && submitted === draft.text)
      // The text lands before the temporary editor ends: ending it re-enables the application, whose effects (focus,
      // auto-submit) run at once and must see the claimed draft.
      if (keep) claimant.set(draft.text)
      dispose()
      if (!keep) return
      const paused = draft.anchor !== draft.caret
      if (paused) renderer.stdin.pause()
      void StartupLayer.restore(renderer, claimant.input, draft).then(() => {
        if (paused) renderer.stdin.resume()
      })
    })
    renderer.requestRender()
  }

  const matches = (sessionID: string | undefined, next = target()) =>
    next !== undefined && (next.type === "home" ? sessionID === undefined : next.sessionID === sessionID)

  const retarget = (next: Target) => {
    setTarget(next)
    const claimant = [...claimants].find((item) => matches(item.sessionID, next))
    if (claimant) claim(claimant)
  }

  // Ends the temporary editor; the application takes input from here on.
  function release() {
    if (!active()) return
    editor.destroy()
    setActive(false)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    claimants.clear()
    release()
    setPending(false)
  }

  return {
    /** The temporary editor holds input; application keymaps stay disabled meanwhile. */
    active,
    /** Where the draft goes: decided by the startup arguments once the route they lead to is known. */
    resolve(next: Target) {
      if (target() || disposed) return
      retarget(next)
    },
    /** The startup's session route gave up on its session and went home; the draft follows. */
    redirect(sessionID: string, next: Target) {
      if (disposed || claimed || !matches(sessionID)) return
      retarget(next)
    },
    /**
     * The target session route is showing without a composer (a permission, a form, a child session). The draft
     * leaves the temporary editor so the application can take input; its selection and an explicit Enter wait for
     * that session's composer to claim them.
     */
    park(sessionID: string) {
      if (disposed || claimed || parked || !matches(sessionID)) return
      const draft = editor.read()
      if (!touched(draft)) return dispose()
      parked = draft
      release()
    },
    /**
     * Whether this composer will receive an edited startup draft, so its own initial seeds must not apply. An
     * untouched draft leaves --prompt seeding and saved drafts to the composer.
     */
    owns(sessionID: string | undefined) {
      return !disposed && matches(sessionID) && touched(current())
    },
    /** Whether a composer for this route may act on its prompt: the draft is not still on its way to it. */
    settled(sessionID: string | undefined) {
      if (!pending()) return true
      const next = target()
      return next !== undefined && !matches(sessionID, next)
    },
    /** Registers a mounted composer; returns its unregister. */
    offer(claimant: Claimant) {
      if (disposed) return () => {}
      claimants.add(claimant)
      if (matches(claimant.sessionID)) claim(claimant)
      return () => {
        claimants.delete(claimant)
      }
    },
    /** Enter was pressed on the claimed draft before its composer took it; true once, for that composer. */
    takeSubmit(sessionID: string | undefined) {
      if (!submit() || !claimed || claimed.sessionID !== sessionID) return false
      setSubmit(false)
      return true
    },
    /** Keeps the temporary editor above the application tree; see StartupLayer.raise. */
    raise() {
      if (active()) editor.raise()
    },
    style(colors: StartupLayer.Style) {
      if (active()) editor.style(colors)
    },
    dispose,
  }
}
