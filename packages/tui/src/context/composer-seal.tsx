import { createContext, createSignal, onCleanup, useContext, type ParentProps } from "solid-js"
import type { CliRenderer, KeyEvent, PasteEvent } from "@opentui/core"
import type { TuiComposerSeal } from "@opencode-ai/plugin/tui"

export type ComposerSeal = ReturnType<typeof createComposerSeal>

export function createComposerSeal(renderer: CliRenderer) {
  const [sealed, setSealed] = createSignal(false)
  const [inFlight, setInFlight] = createSignal(0)
  let generation = 0
  let mouse = false
  let held: TuiComposerSeal | undefined
  let committed = false
  const whileOpen = (work: () => void) => {
    if (sealed()) return false
    work()
    return true
  }
  const holdKey = (event: KeyEvent) => {
    if (!sealed()) return
    event.preventDefault()
    event.stopPropagation()
  }
  const holdPaste = (event: PasteEvent) => {
    if (!sealed()) return
    event.preventDefault()
    event.stopPropagation()
  }
  renderer.keyInput.prependListener("keypress", holdKey)
  renderer.keyInput.prependListener("keyrelease", holdKey)
  renderer.keyInput.prependListener("paste", holdPaste)
  onCleanup(() => {
    renderer.keyInput.off("keypress", holdKey)
    renderer.keyInput.off("keyrelease", holdKey)
    renderer.keyInput.off("paste", holdPaste)
  })

  return {
    sealed,
    busy: () => inFlight() > 0,
    whileOpen,
    async track<T>(work: () => Promise<T>): Promise<T> {
      setInFlight((count) => count + 1)
      try {
        return await work()
      } finally {
        setInFlight((count) => count - 1)
      }
    },
    /** The caller has already checked that nothing is sealed or in flight. */
    acquire(): TuiComposerSeal {
      generation++
      mouse = renderer.useMouse
      if (mouse) renderer.useMouse = false
      setSealed(true)
      renderer.requestRender()
      const sealGeneration = generation
      const release = () => {
        if (committed || !sealed() || sealGeneration !== generation) return false
        held = undefined
        setSealed(false)
        if (mouse && !renderer.isDestroyed) renderer.useMouse = true
        if (!renderer.isDestroyed) renderer.requestRender()
        return true
      }
      held = { generation, release, [Symbol.dispose]: release }
      return held
    },
    commit(seal: { readonly generation: number; release(): boolean }): boolean {
      if (!held || seal !== held || seal.generation !== generation) return false
      committed = true
      return true
    },
  }
}

const ComposerSealContext = createContext<ComposerSeal>()

export function ComposerSealProvider(props: ParentProps<{ value: ComposerSeal }>) {
  return <ComposerSealContext.Provider value={props.value}>{props.children}</ComposerSealContext.Provider>
}

/** Absent outside the app, where nothing can seal the composer. */
export function useComposerSeal(): ComposerSeal | undefined {
  return useContext(ComposerSealContext)
}
