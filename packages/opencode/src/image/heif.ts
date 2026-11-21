import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { which } from "@opencode-ai/core/util/which"
import { Effect } from "effect"

const MAX_INPUT_BASE64 = 24 * 1024 * 1024
const MAX_JPEG_BYTES = 3 * 1024 * 1024
const cache = new Map<string, string | undefined>()

export function isHeifMime(mime: string) {
  return /^image\/(heic|heif)$/i.test(mime)
}

export const projectHeif = Effect.fnUntraced(function* (attachment: {
  readonly mime: string
  readonly url: string
  readonly filename?: string
}) {
  const prefix = /^data:image\/(?:heic|heif);base64,/i.exec(attachment.url)?.[0]
  if (!prefix || attachment.url.length - prefix.length > MAX_INPUT_BASE64) return
  const magick = which("magick")
  if (!magick) return

  const bytes = Buffer.from(attachment.url.slice(prefix.length), "base64")
  const key = createHash("sha256").update(bytes).digest("hex")
  if (cache.has(key)) {
    const url = cache.get(key)
    return url === undefined ? undefined : { mime: "image/jpeg", url, filename: attachment.filename }
  }

  const jpeg = yield* Effect.tryPromise(
    (signal) =>
      new Promise<Buffer | undefined>((resolve) => {
        const child = execFile(
          magick,
          [
            "-limit",
            "thread",
            "2",
            "-limit",
            "width",
            "8192",
            "-limit",
            "height",
            "8192",
            "-limit",
            "memory",
            "256MiB",
            "-limit",
            "map",
            "256MiB",
            "-limit",
            "disk",
            "0",
            "heic:-[0]",
            "-auto-orient",
            "-resize",
            "2000x2000>",
            "-strip",
            "-quality",
            "85",
            "jpeg:-",
          ],
          {
            signal,
            timeout: 5000,
            killSignal: "SIGKILL",
            maxBuffer: MAX_JPEG_BYTES,
            encoding: "buffer",
            windowsHide: true,
          },
          (error, stdout) => resolve(error ? undefined : stdout),
        )
        child.stdin?.on("error", () => child.kill("SIGKILL"))
        child.stdin?.end(bytes)
      }),
  ).pipe(Effect.orElseSucceed(() => undefined))

  const url = jpeg?.[0] === 0xff && jpeg[1] === 0xd8 ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : undefined
  const oldest = cache.keys().next()
  if (cache.size >= 8 && !oldest.done) cache.delete(oldest.value)
  cache.set(key, url)
  return url === undefined ? undefined : { mime: "image/jpeg", url, filename: attachment.filename }
})

export function heifPixelsUnavailable(attachment: { readonly mime: string; readonly filename?: string }) {
  return `[Attached ${attachment.mime}: ${attachment.filename ?? "file"}. Image pixels were not sent. Attach a PNG or JPEG for visual analysis.]`
}
