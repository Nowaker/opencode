import path from "path"
import { rename, rm } from "fs/promises"
import { readJson, writeJsonAtomic } from "../../util/persistence"
import type { PromptInfo } from "./history"

// One draft per session, consumed on take, as v2's draft-stash.ts. v2 holds it in memory for a tab's own
// remounts; here a background fork leaves it for a session no tab has open yet, which any TUI process may
// open later, so it lives in the state directory.
export type DraftEntry = { prompt: PromptInfo; cursor: number }

const draftPath = (state: string, sessionID: string) => path.join(state, "prompt-draft", `${sessionID}.json`)

export function saveDraft(state: string, sessionID: string, entry: DraftEntry) {
  return writeJsonAtomic(draftPath(state, sessionID), entry)
}

export async function takeDraft(state: string, sessionID: string) {
  const target = draftPath(state, sessionID)
  // The rename claims the draft, so two TUIs opening the session at once can't both restore it.
  const claimed = `${target}.${process.pid}.taken`
  const owned = await rename(target, claimed).then(
    () => true,
    () => false,
  )
  if (!owned) return undefined
  const entry = await readJson<DraftEntry>(claimed).catch(() => undefined)
  await rm(claimed, { force: true })
  return entry
}
