import fs from "node:fs"
import { StartupInput } from "../../src/startup/index"

if (process.argv[2]) {
  fs.closeSync(2)
  if (fs.openSync(process.argv[2], "w") !== 2) throw new Error("Expected redirected stderr on descriptor 2")
}

const handle = StartupInput.start({
  argv: ["--server", "http://127.0.0.1:9", "--server-wait", "1"],
  env: process.env,
  worker: new URL("../../src/startup/worker.ts", import.meta.url),
})
if (!handle) throw new Error("Expected the native startup terminal owner")

process.once("SIGUSR2", async () => {
  await handle.recover()
  if (process.stdin.isRaw) throw new Error("Recovery left the terminal in raw mode")
  process.stdout.write("RECOVERY_RETURNED\n")
  process.exit(1)
})
