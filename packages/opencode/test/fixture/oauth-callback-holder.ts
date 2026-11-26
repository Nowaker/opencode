// Another opencode process with a sign-in of its own waiting on the shared MCP OAuth callback port.
// Usage: bun oauth-callback-holder.ts <redirectUri> <state>
// Prints "ready" once it waits, then "code:<code>" when its own callback arrives, and stays alive
// until killed, as a TUI or server process does.
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"

const [redirectUri, state] = process.argv.slice(2)
if (!redirectUri || !state) throw new Error("usage: oauth-callback-holder.ts <redirectUri> <state>")

await McpOAuthCallback.ensureRunning(redirectUri)
const code = McpOAuthCallback.waitForCallback(state)
process.stdout.write("ready\n")
code.then(
  (value) => process.stdout.write(`code:${value}\n`),
  (error: Error) => process.stdout.write(`error:${error.message}\n`),
)
setInterval(() => {}, 60_000)
