import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./location"

export const searchLayer = (
  directory: string,
  vcs?: Location.Interface["vcs"],
  backend: "default" | "watched" = "default",
) => {
  const bound = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) }, { vcs })),
  )
  return backend === "watched"
    ? LayerNode.compile(FileSystemSearch.node, [[FileSystemSearch.node, Layer.provide(FileSystemSearch.fffLayer, bound)]])
    : LayerNode.compile(FileSystemSearch.node, [[Location.node, bound]])
}

export const withSearch = (directory: string) => Effect.provide(searchLayer(directory))
