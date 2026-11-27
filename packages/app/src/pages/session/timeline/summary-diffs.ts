import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import { queryOptions, skipToken } from "@tanstack/solid-query"
import { unquoteGitPath } from "@/context/file/path"
import type { ServerScope } from "@/utils/server-scope"
import type { SummaryDiff } from "./timeline-row"

type TurnFileDiff = { file: string; patch?: string; additions: number; deletions: number }

export function uniqueSummaryDiffs(diffs: SnapshotFileDiff[] | undefined) {
  const files = new Set<string>()
  return (diffs ?? [])
    .reduceRight<SummaryDiff[]>((result, diff) => {
      if (!isSummaryDiff(diff)) return result
      const file = diff.file
      if (files.has(file)) return result
      files.add(file)
      result.push(diff)
      return result
    }, [])
    .reverse()
}

export function turnPatchMissing(diff: TurnFileDiff) {
  return typeof diff.patch !== "string" && (diff.additions > 0 || diff.deletions > 0)
}

// Without a message ID the query sits on an inert key, so a hidden view stops retaining the turn payload.
export const turnDiffQuery = (
  scope: ServerScope,
  directory: string,
  sessionID: string,
  messageID: string | undefined,
  client: {
    session: {
      diff(
        input: { sessionID: string; messageID: string },
        options: { throwOnError: true; signal: AbortSignal },
      ): Promise<{ data: SnapshotFileDiff[] }>
    }
  },
) =>
  queryOptions({
    queryKey: [scope, directory, "session-turn-diff", sessionID, messageID ?? ""] as const,
    queryFn: messageID
      ? ({ signal }) =>
          client.session.diff({ sessionID, messageID }, { throwOnError: true, signal }).then((result) => result.data)
      : skipToken,
    // Reuse a turn across a quick view switch without retaining it after the cache window.
    staleTime: 30_000,
    gcTime: 30_000,
  })

// The diff route already unquotes git paths; unquote only the stored list path.
export function withTurnPatches<T extends TurnFileDiff>(diffs: T[], fetched: SnapshotFileDiff[] | undefined): T[] {
  if (!fetched) return diffs
  const patches = new Map(uniqueSummaryDiffs(fetched).map((item) => [item.file, item.patch]))
  return diffs.map((diff) => {
    const patch = patches.get(unquoteGitPath(diff.file))
    if (typeof patch !== "string" || patch === diff.patch) return diff
    return { ...diff, patch }
  })
}

function isSummaryDiff(diff: SnapshotFileDiff): diff is SummaryDiff {
  return typeof diff.file === "string"
}
