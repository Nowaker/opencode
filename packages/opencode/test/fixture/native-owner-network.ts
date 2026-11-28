// Loaded before the CLI and its real TUI worker. Only fixture origins may
// receive HTTP requests, including from provider SDKs and background startup.
const origins = new Set((process.env.NATIVE_OWNER_TEST_ORIGINS ?? "").split(" "))
const nativeFetch = globalThis.fetch

function checkURL(input: RequestInfo | URL) {
  const url = new URL(input instanceof Request ? input.url : input)
  if (!origins.has(url.origin) || url.hostname !== "127.0.0.1") {
    throw new Error(`Unexpected origin in native owner test: ${url.origin}`)
  }
}

globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    checkURL(input)
    return nativeFetch(input, { ...init, redirect: "error" })
  },
  {
    preconnect(url: string | URL) {
      checkURL(url)
      nativeFetch.preconnect(url)
    },
  },
)

globalThis.Worker = new Proxy(globalThis.Worker, {
  construct(target, [entry, options]: [string | URL, Bun.WorkerOptions?]) {
    const extra = options?.preload
    const preload = [import.meta.path, ...(typeof extra === "string" ? [extra] : (extra ?? []))]
    return new target(entry, { ...options, preload })
  },
})
