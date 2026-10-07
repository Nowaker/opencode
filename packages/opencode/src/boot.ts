import { InstantPrompt } from "@opencode-ai/tui/instant"

// Paint the instant startup prompt and start capturing keys before the rest of
// the CLI is loaded; the dynamic import keeps that load out of this module.
// It only shortens startup, so if it fails opencode starts without it.
try {
  InstantPrompt.start()
} catch {
  InstantPrompt.dismiss()
}
await import("./index")
