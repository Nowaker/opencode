import type { ImagePart } from "ai"

const PNG_PREFIX = "data:image/png;base64,"
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_END = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
const MAX_EDGE = 512
export const inlineImageTokenReserve = 4096

export function inlineImage(part: { readonly mime: string; readonly url: string }): ImagePart | undefined {
  if (part.mime !== "image/png" || !part.url.startsWith(PNG_PREFIX) || part.url.length > 1_400_000) return
  const image = part.url.slice(PNG_PREFIX.length)
  const bytes = Buffer.from(image, "base64")
  if (
    bytes.length < 45 ||
    bytes.toString("base64") !== image ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    !bytes.subarray(-12).equals(PNG_END)
  ) return
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width < 1 || width > MAX_EDGE || height < 1 || height > MAX_EDGE) return
  return { type: "image", image, mediaType: "image/png" }
}
