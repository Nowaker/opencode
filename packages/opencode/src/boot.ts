import { InstantPrompt } from "@opencode-ai/tui/instant"

// Paint the instant startup prompt and start capturing keys before the rest of
// the CLI is loaded; the dynamic import keeps that load out of this module.
InstantPrompt.start()
await import("./index")
