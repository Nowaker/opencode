export function child(filename: string, mode: string, statement?: string) {
  const process = Bun.spawn([Bun.which("bun") ?? "bun", `${import.meta.dir}/maintenance-schema-writer.ts`, filename, mode, ...(statement ? [statement] : [])], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  })
  const reader = process.stdout.getReader()
  const decoder = new TextDecoder()
  const pending = { text: "" }
  return {
    process,
    async next() {
      while (!pending.text.includes("\n")) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error(`child ended: ${await new Response(process.stderr).text()}`)
        pending.text += decoder.decode(chunk.value, { stream: true })
      }
      const index = pending.text.indexOf("\n")
      const line = pending.text.slice(0, index)
      pending.text = pending.text.slice(index + 1)
      return line
    },
    send(command: string) { process.stdin.write(`${command}\n`) },
    async [Symbol.asyncDispose]() {
      reader.releaseLock()
      if (process.exitCode === null) process.kill()
      await process.exited
    },
  }
}
