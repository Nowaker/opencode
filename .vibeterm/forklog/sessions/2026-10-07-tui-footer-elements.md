# One visibility scheme for every footer detail, message ID and tool calls included

## Identity

- Workday: 2026-10-07 (work continued past midnight)
- Session: `ses_ee68aab01ffei41gwUGJ5ESj6W`
- Agent/platform: `Sisyphus - ultraworker` (anthropic/claude-opus-5-5, high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode` (GitLab `origin`, GitHub `nowaker-github`)
- Integration branch: `dev-nowaker`
- Development branch(es): `footer-elements` (worktree); upstream `tui-footer-elements`
- Upstream base: `907b3bc518` (contains `v1.18.34`); upstream stack on `663fbd7573`
- Source result commit(s): `1ca196f2b2`, `efc7b3db27`, `4c6be131b4`
- Forklog commit: this file's introducing commit

## User requests

Item 24 from coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> new tui option: show msgid in the footers. default false, for me all, other
> options list of elements it's being shown on (and maybe an entry for
> important ones? do we have similar switch for showing some other elements?
> generally make things consistent, so if we have important-onlt on
> time-elapsed, then we should have it on datetime-ended, and on msgid, etc. -
> apply to all these footer elements, consistenly)

> tui feature - i wanted time finished and time taken for tool calls. looks
> like not all of them get the footer. eg vtps here don't get it. i basically
> want whatever has msgid, it has submit date, and finish date, right? so that
> should be an option for all footer elements - to be included there. default
> of course false but i want to see it on all tool calls. its valuable for me
> to know how long vtps takes.

Coordinator relays: open v1 PRs even though the bot closes them, starting the
body with the user's v1-maintenance note; keep the variant dimmed (item 14).

## Goals

- `footer` setting with one shared value shape for agent, model, variant,
  time, duration, total and message ID; `"important"` reuses the landmark
  predicate; defaults unchanged; legacy keys and toggles keep working.
- Every tool call can show finish time, duration and message ID.

## Constraints and non-goals

- Never touch the primary checkout's uncommitted retry patch or `.gitignore`.
- No serve or tab restarts.
- No live timer for running tool calls.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `06eba8720e` | `1ca196f2b2` | fast-forward from `footer-elements`; pushed both remotes |
| `opencode` | `dev-nowaker` | `feaf2e5468` | `efc7b3db27` | fast-forward (variant dimmed); pushed both remotes |
| `opencode` | `dev-nowaker` | `8a940a7a1c` | `4c6be131b4` | fast-forward (tool-call footer); pushed both remotes |
| `opencode` (GitHub fork + GitLab) | `tui-footer-elements` | - | `cc947a75a7` | new branch on `github/dev` `663fbd7573`: cherry-picks of #53195, #53654, #53639, #53848 (as `b762567377`, dimmed), #53333, then this feature; no AI trailers; head of PR #53877 |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Choose every message footer detail the same way](../features/2026-10-07-tui-footer-elements.md) | introduced | tests, typecheck, isolated captures |
| [Per-turn completion time and duration](../features/2026-10-04-tui-turn-timing.md) | extended: `turn_timing` maps onto `footer.time`/`footer.duration` | legacy capture identical to `bd9676d499` |
| [Choose which transcript entries show timestamps](../features/2026-10-06-tui-part-timestamps.md) | extended: `timestamps` maps onto `footer.time` (and `tool` durations) | config tests, legacy capture |
| [Show the turn's variant in assistant message footers](../features/2026-10-06-tui-footer-variant.md) | extended: `footer_variant` is the legacy alias of `footer.variant`; dimmed by `efc7b3db27` | config tests, `all` capture |
| [Show the provider and model id in message footers](../features/2026-10-06-tui-model-label.md) | re-verified; tui.mdx gained its missing `model_label` entry | docs diff, `model_label: "id"` captures |
| [Navigate the transcript by prompt, landmark and block](../features/2026-10-05-tui-block-nav.md) | extended: `isLandmark` helper for `"important"` | `navigation.test.ts` |

## Other delivered work

- Upstream PR [#53877](https://github.com/anomalyco/opencode/pull/53877),
  body opening with the v1-maintenance note and ending with the attribution
  line; closed by opencode-agent[bot] as v1 feature work.
- Comment on [#50891](https://github.com/anomalyco/opencode/issues/50891#issuecomment-6053344669)
  (finished-tool part only). #42498 and #38666 already had a Nowaker comment.
- Host config: `footer` with all seven keys `"all"` in
  `~/.config/opencode/tui.json` on desktop and m4max, by a jsonc-parser
  `modify` plus temp-file rename; only `footer` changed; both files decode
  with the new schema and select `tool` for time, duration and message ID.

## Verification

- See the feature record. `bun typecheck` exit 0; full `packages/tui` suite
  349 pass, 1 skip, 0 fail; pre-push hook 30/30 on every push.

## Build and install

- desktop: `.vibeterm/build.sh` from the primary checkout (retry patch
  sha1 matches the canonical patch): `1.18.34-vt-168-907b3bc518` at
  `1ca196f2b2` (inode `49946738`), then `1.18.34-vt-173-907b3bc518` at
  `4c6be131b4` (inode `49946742`). The binary holds the
  `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` and `plugin and MCP tools included`
  markers. `opencode-serve-tailscale` (PID 2994070) and `opencode-serve-lan`
  (PID 2994178) kept their PIDs and start times.
- m4max: checkout fast-forwarded; `1.18.34-vt-168-907b3bc518` (inode
  `22197786`), then `1.18.34-vt-174-907b3bc518` at `7bd6de4d44` (inode
  `22205782`), same markers and matching retry patch.
- Running TUIs pick it up on their next restart.

## Commit provenance

- `1ca196f2b2` - `footer` setting, docs, tests.
- `efc7b3db27` - variant muted.
- `4c6be131b4` - every tool call takes the footer details.
- Required trailer: `AI-Session-ID: ses_ee68aab01ffei41gwUGJ5ESj6W`

## Unknowns and blocked verification

- None.
