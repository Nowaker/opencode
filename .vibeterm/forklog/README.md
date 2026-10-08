# OpenCode forklog

This directory is the tracked source of truth for local OpenCode behavior on
`dev-nowaker`. It answers two different questions through linked views:

- [`features/`](./features/) explains why each durable customization exists,
  where its stable seams live, and how its behavior changed over time.
- [`sessions/`](./sessions/) records what one coding-agent session did to which
  branch and upstream base, including verification, build, and install facts.

The cross-repository inventory and upstream PR monitor live in Vibeterm's
[`docs/opencode-patches/README.md`](https://gitlab.com/Nowaker/opencode-tools/-/blob/master/docs/opencode-patches/README.md).
That inventory links fork commits, development branches, source-work sessions,
upstream PR state, patch dispositions, and regression evidence. This README
governs feature/session provenance; the Vibeterm inventory governs the audit.

Track forklog changes only on `dev-nowaker`. Each coding-agent session gets
one unsquashed forklog commit per user workday, even when an upstream bump
carries every feature forward unchanged. That commit includes the full
`AI-Session-ID` trailer.

## Templates

- [`_feature.md`](./_feature.md) - one durable customization.
- [`_session.md`](./_session.md) - one coding-agent session and user workday.

## Active features

- [SQLite admission recovery and safe diagnosis](./features/sqlite-admission.md)

- [Unchanged message summary event suppression](./features/2026-09-26-summary-event-dedup.md)

- [Session replacement maintenance](./features/session-maintenance.md)

- [Global memory diagnostics](./features/2026-05-13-global-memory-diagnostics.md)
- [Message shape normalization](./features/2026-05-23-message-shape-normalization.md)
- [Interrupted assistant tail filtering](./features/2026-05-29-interrupted-assistant-tail.md)
- [Sync hot-path tuning](./features/2026-05-29-sync-hot-path.md)
- [Alternate provider clones](./features/2026-05-30-alt-provider-clones.md)
- [Compaction decision tracing](./features/2026-06-16-compaction-decision-tracing.md)
- [Strict global bus typing](./features/2026-07-21-global-bus-typing.md)
- [Retry-header delay cap](./features/2026-08-06-retry-header-delay-cap.md)
- [Native tool commands](./features/2026-08-08-native-tool-commands.md)
- [TUI streaming render throttle](./features/2026-08-25-tui-stream-throttle.md)
- [Prompt input latency](./features/2026-08-31-prompt-input-latency.md)
- [Watcher inotify preflight](./features/2026-09-09-watcher-inotify-preflight.md)
- [OpenAI Meridian provider clone](./features/2026-09-27-openai-meridian-provider.md)
- [TUI composer read and part-preserving replace](./features/2026-09-27-tui-composer-read.md)
- [Tracked build script and vt version stamp](./features/2026-09-29-vt-version-stamp.md)
- [Unmanaged install method for fork builds](./features/2026-10-02-unmanaged-install-method.md)
- [Agent lookup by configured name](./features/2026-10-02-agent-name-lookup.md)
- [Reopen opencode.log after an external rotation](./features/2026-10-03-log-reopen.md)
- [One-line "LSPs are disabled" in the sidebar](./features/2026-10-04-sidebar-lsp-disabled-oneline.md)
- [Keep the scroll position when a prompt is submitted](./features/2026-10-04-keep-scroll-on-submit.md)
- [Per-turn completion time and duration in the TUI](./features/2026-10-04-tui-turn-timing.md)
- [Pin the session title at the top of the sidebar](./features/2026-10-04-sidebar-pin-title.md)
- [Compact sidebar Context display](./features/2026-10-04-sidebar-context-compact.md)
- [Keep a scrolled-up reader's place in a long session](./features/2026-10-04-scroll-anchor.md)
- [Order, hide and drag session sidebar sections](./features/2026-10-04-sidebar-section-order.md)
- [Per-status MCP counts in the sidebar heading](./features/2026-10-04-sidebar-mcp-summary.md)
- [Todo counts after the sidebar Todo heading](./features/2026-10-04-sidebar-todo-summary.md)
- [Color context usage and cost by thresholds](./features/2026-10-04-sidebar-context-colors.md)
- [Keep a completed todo list in the sidebar](./features/2026-10-05-sidebar-todo-completed.md)
- [Compact sidebar MCP rows without status text](./features/2026-10-04-sidebar-mcp-list.md)
- [Navigate the transcript by prompt, landmark and block](./features/2026-10-05-tui-block-nav.md)
- [Return to the scrolled-up position on messages_first](./features/2026-10-06-tui-home-return.md)
- [Choose which transcript entries show timestamps](./features/2026-10-06-tui-part-timestamps.md)
- [Show the provider and model id in message footers](./features/2026-10-06-tui-model-label.md)
- [Instant home and session prompt and early input at startup](./features/2026-10-06-tui-instant-prompt.md)
- [Show the session ID in the sidebar](./features/2026-10-06-sidebar-session-id.md)
- [Single-press session abort, /abort and immediate "aborting…" feedback](./features/2026-10-06-tui-session-abort.md)
- [Show and load the messages a long session hides](./features/2026-10-06-tui-history-crop.md)
- [Read and place the composer caret from a TUI plugin](./features/2026-10-06-tui-composer-caret.md)
- [Stop the file logger waking every second while idle](./features/2026-10-06-idle-log-flush.md)
- [Load the full provider catalog after the prompt is shown](./features/2026-10-06-tui-lazy-provider-list.md)
- [Keep a failed prompt instead of losing it, without sending it twice](./features/2026-10-07-tui-prompt-admission.md)

## Session records

- [2026-10-07 `ses_ee74c94dfffe71uYsYScadAio7`](./sessions/2026-10-07-tui-prompt-admission.md)
  - Keep a failed prompt's draft until the server stores it, restore it (above
    any newer text, caret kept), reconcile an ambiguous send by its client
    message ID before resending, and never let the server run a known message
    ID twice; build and install on both hosts.

- [2026-10-07 `ses_eebf2e45cfferJAfg1d5eBsDB6`](./sessions/fork-audit.md#prompt-failure-follow-up-2026-10-07)
  - Record transaction phase and bounded SQLite identifiers at the existing
    HTTP failure log, without changing recovery or the original error.

- [2026-10-06 `ses_eebf9a83fffeIQQwW9gVFo5jaO`](./sessions/2026-10-06-tui-instant-prompt.md)
  - Paint an editable home prompt within ~50 ms of `opencode` and capture
    early input (`startup.instant_prompt`, `startup.early_input`), then the
    session screen for `-s`/`-c`, and keep a damaged startup cache or a small
    pane from breaking startup; upstream issue #53696 and PR #53698; build and
    install on both hosts.

- [2026-10-06 `ses_eec5b2a34ffe9sjf6Wf21vNSMg`](./sessions/2026-10-06-idle-cpu-startup.md)
  - Idle CPU, memory and time to prompt: a hermetic harness, a file logger
    that no longer wakes every second (-15% idle CPU; issue #53673, PR
    #53674), and the provider catalog off the blocking bootstrap (-250 ms to
    prompt; issue #53679, PR #53680); build and install on both hosts.

- [2026-10-06 `ses_eec44ad14ffeownfvFKtEeqk4N`](./sessions/2026-10-06-tui-composer-caret.md)
  - Let TUI plugins read and place the composer caret, so vibeterm's restored
    drafts keep it; build and install on both hosts.

- [2026-10-06 `ses_eebf95604ffekfFQU7LOgARLnt`](./sessions/2026-10-06-sidebar-session-id.md)
  - Add `sidebar.session_id` and `/session-id` to show the session ID below
    the sidebar title; upstream issue #53662 and PR #53663; installed on both
    hosts, no host `tui.json` change.

- [2026-10-06 `ses_eec5b71ddffe4A47jCysfkQh6l`](./sessions/2026-10-06-tui-history-crop.md)
  - Add `transcript.max_messages` and `transcript.keep_first_prompt`, a
    hidden-messages divider with load above/below/all, and `after`/`order`/
    `X-Total-Count` on the paged messages route; RSS/CPU at 50/100/200;
    issue #53642, PR #53660; build and install on both hosts.

- [2026-10-06 `ses_eec446a24ffebz6buEl7LB2m3O`](./sessions/2026-10-06-tui-session-abort.md)
  - Add `session_abort` (`/abort`, single press, default `alt+escape`, ESC
    bursts resolve to it) and show `aborting…` as soon as any abort is
    requested; issues #53652/#53653, PRs #53655/#53656; build and install on
    both hosts, `alt+escape,ctrl+k` set in their `tui.json`.

- [2026-10-06 `ses_eec3e5569ffe2otGPxp4LBssZb`](./sessions/2026-10-06-tui-part-timestamps.md)
  - Add `timestamps` (`all`, `none`, a list of `user`, `assistant`, `text`,
    `reasoning`, `tool`, `error`, `compaction`) so tool calls and other
    entries show when they finished; PR #53654 on #42498; build and install
    on both hosts, `all` set in their `tui.json`.

- [2026-10-06 `ses_eec44cf7effeFCqQefM0NkWLaW`](./sessions/2026-10-06-tui-model-label.md)
  - Add `model_label` (`name`/`id`) so message footers and the prompt show
    `providerID/modelID`; upstream issue #53638 and PR #53639; build and
    install on both hosts, `id` set in their `tui.json`.

- [2026-10-06 `ses_ef46f1775ffe29MtElYF4DQySL`](./sessions/2026-10-06-tui-nav-layout.md)
  - Move prompt navigation to `ctrl+up`/`ctrl+down` and blocks to
    `ctrl+alt+shift+up`/`down` (PR #53333 amended); `ctrl+end` remembers a
    scrolled-up position for the next `ctrl+home` (issue #53629, stacked PR
    #53630); build and install on both hosts.

- [Fork inventory and regression audit `ses_eeda1d251ffel81U5Y42j4kb33`](./sessions/fork-audit.md)
  - Establish reciprocal inventory ownership and behavioral regression gates.

- [2026-10-05 `ses_ef81ad30fffeo7m3HoZisuJdli`](./sessions/2026-10-05-sidebar-header-select.md)
  - Make the values on sidebar header lines (compact Context, MCP counts,
    Todo summary, "are disabled") drag-copyable again beside the section
    drag handle; PR #53217 head amended; build and install on both hosts.

- [2026-10-05 `ses_ef46f1775ffe29MtElYF4DQySL`](./sessions/2026-10-05-tui-block-nav.md)
  - Add block (`ctrl+up`/`ctrl+down`) and landmark (`ctrl+shift+up`/
    `ctrl+shift+down`) transcript navigation and `ctrl+home`/`ctrl+end`;
    upstream issue #53331 and PR #53333; build and install on both hosts.

- [2026-10-05 `ses_ef49a49d9ffeKmNRrjg4DFrQtW`](./sessions/2026-10-05-sidebar-todo-completed.md)
  - Add `sidebar.todo_completed` (`hide`, `collapsed`, `show`) so an
    all-completed todo list stays in the sidebar; build and install on both
    hosts, `show` set in their `tui.json`.

- [2026-10-04 `ses_ef48e41cfffeCewCXcQUj6z1n2`](./sessions/2026-10-04-sidebar-mcp-list.md)
  - Add `sidebar.mcp_list` (`descriptive`/`compact`) so the sidebar MCP rows
    can drop their status text; upstream issue #53321 and PR #53322; build
    and install on both hosts, `compact` set in their `tui.json`.

- [2026-10-04 `ses_ef6439100ffea6UZ1MqYyvXDjR`](./sessions/2026-10-04-sidebar-context-colors.md)
  - Add `usage.context_color`, `usage.context_thresholds` and
    `usage.cost_thresholds` to color context usage and cost in the sidebar
    Context block and the prompt footer; upstream issue #53263 and PR
    #53264; build and install on both hosts, `colored` set in their
    `tui.json`.

- [2026-10-04 `ses_ef6415913ffeq4hyR0MCqsjDsn`](./sessions/2026-10-04-sidebar-todo-summary.md)
  - Show todo counts after the sidebar Todo heading (`sidebar.todo_summary`,
    `sidebar.todo_summary_style`); upstream issue #53258 and PR #53259;
    build and install on both hosts, `always` set in their `tui.json`.

- [2026-10-04 `ses_ef63ef95cffeIfyDzjCjdXqrYc`](./sessions/2026-10-04-sidebar-mcp-summary.md)
  - Add `sidebar.mcp_summary` for per-status colored counts on the sidebar
    MCP heading; upstream issue #53260 and PR #53261; build and install on
    both hosts, `always` set in their `tui.json`.

- [2026-10-04 `ses_ef81ad30fffeo7m3HoZisuJdli`](./sessions/2026-10-04-sidebar-section-order.md)
  - Order and hide sidebar sections from `tui.json` (`sidebar.order`,
    `sidebar.hidden`) and reorder them by dragging headers; upstream issue
    #53198, PRs #53201 and #53217; build and install on both hosts.

- [2026-10-04 `ses_ef81ca107ffet5DwnFLaGWlUap`](./sessions/2026-10-04-scroll-anchor.md)
  - Stop new AI output from sliding a scrolled-up transcript in sessions past
    100 messages; upstream PR #53219 closing #41243; build and install on
    desktop and m4max.

- [2026-10-04 `ses_f01c05e81ffeH39PdmzetO2pyw`](./sessions/2026-10-04-llm-test-models-read.md)
  - Fix `llm.test.ts`'s mock queue, which `openai`'s served-model read
    consumed after the `v1.18.34` rebase; no build.

- [2026-10-04 `ses_ef81b7a80ffeaAyKTHFHlHGXVs`](./sessions/2026-10-04-sidebar-context-compact.md)
  - Add an expanded/compact sidebar Context display with a header toggle;
    upstream issue #53200 and PR #53205; build and install on both hosts,
    `compact` set in their `tui.json`.

- [2026-10-04 `ses_ef81bccccffeaNpV0Vw2TPKgyP`](./sessions/2026-10-04-sidebar-pin-title.md)
  - Add `sidebar.pin_title` and `/pin-title` so a scrolling sidebar keeps the
    session title on top with the scrollbar below it; upstream issue #53193
    and PR #53194; build and install on both hosts, enabled in their
    `tui.json`.

- [2026-10-04 `ses_ef81c7229ffeqHzmyR9O4v0AMH`](./sessions/2026-10-04-keep-scroll-on-submit.md)
  - Add `keep_scroll_on_submit` and `/keep-scroll` so a submitted prompt does
    not yank a scrolled-up view down; upstream issue #53186 and PR #53187;
    build and install on both hosts, enabled in their `tui.json`.

- [2026-10-04 `ses_ef81db9cdffe5vRz7Y2HqCmvNs`](./sessions/2026-10-04-upstream-1.18.34.md)
  - Rebase `dev-nowaker` onto upstream `dev` past `v1.18.34` without
    conflicts, reapply the retry-header cap, build and install on both hosts;
    bisect a pre-existing `llm.test.ts` regression to `eb573a78de`.

- [2026-10-04 `ses_ef81b0c61ffe9TD8cftI93JGis`](./sessions/2026-10-04-sidebar-lsp-disabled-oneline.md)
  - Fold the sidebar's "LSPs are disabled" into the LSP heading line;
    upstream issue #53183 and PR #53185.

- [2026-10-04 `ses_ef81c1485ffeC5Sb59U9mVI77g`](./sessions/2026-10-04-tui-turn-timing.md)
  - Show completion time and duration on every assistant turn and the total
    on the final one (`turn_timing`, `/turn-times`, `/turn-durations`);
    upstream issue #53192 and PR #53195; build and install on desktop and
    m4max.

- [2026-10-03 `ses_efb698c02ffefXlxsxKlISKpRH`](./sessions/2026-10-03-log-reopen.md)
  - Reopen `opencode.log` when a rotator renames or deletes it, so
    rename-based rotation is lossless; build and install on desktop and
    m4max; upstream issue #53089 and PR #53090.

- [2026-10-02 `ses_f011ccc18ffeZAKpRC9OjZ40a8`](./sessions/2026-10-02-agent-name-lookup.md)
  - Resolve a renamed agent (`agent.plan.name = "OC-Plan"`) by its name so
    `opencode run --agent plan` works; explain the lost error-ref log line
    (upstream exit-before-flush); build and install on desktop and m4max.

- [2026-10-02 `ses_f01c05e81ffeH39PdmzetO2pyw`](./sessions/2026-10-02-openai-gateway-parity.md)
  - Give `openai/` behind a gateway baseURL `openai-meridian`'s served models
    and small model, let a configured baseURL beat Codex OAuth, stamp fork
    builds as an unmanaged install, build and install on desktop and m4max.

- [2026-09-30 `ses_f0f108c6dffeMymgpAsLy9LESM`](./sessions/2026-09-30-upstream-1.18.33.md)
  - Rebase `dev-nowaker` onto upstream `dev` past `v1.18.33`, reapply the
    retry-header cap, build and install on both hosts.

- [2026-09-29 `ses_f0fa472b3ffewPFKUIOfLnesvB`](./sessions/2026-09-29-vt-version-stamp.md)
  - Track the build script in the fork, stamp builds `<base>-vt-<seq>-<sha>`,
    keep registry and semver consumers on the base release, build and install.

- [2026-09-29 `ses_f106b7eecffenW3xCMfi1WsXia`](./sessions/2026-09-29-openai-meridian-served-models.md)
  - Make `openai-meridian` offer exactly what meridian-gpt serves, drop the
    config whitelist, build and install.

- [2026-09-28 `ses_f14dc2d9effeJ663ftS9g8dVoS`](./sessions/2026-09-28-openai-meridian-small-model.md)
  - Give `openai-meridian` a small model its Codex backend serves, fold the
    three provider clones into one table, build and install.

- [2026-09-27 `ses_f19bcd194ffecw7EE6UaCiWdxI`](./sessions/2026-09-27-tui-composer-read.md)
  - Let TUI plugins read the composer and restore its parts, for vibeterm's
    native draft persistence; build and install without restarting services.

- [2026-09-27 `ses_f1b584ed7ffe6o2WMYwwpxohpL`](./sessions/2026-09-27-openai-meridian-provider.md)
  - Land the `openai-meridian` provider clone, build, install, and configure it
    for the Meridian ChatGPT gateway without restarting existing processes.

- [2026-09-26 `ses_f1f9b9b74ffe8xPPTsmvM4op8M`](./sessions/2026-09-26-summary-event-dedup.md)
  - Integrate the emitter-only guard and verify the installed desktop binary
    without pruning, a version bump, or restarting existing processes.

- [Session maintenance protocol-3 distribution](./sessions/session-maintenance.md)

- [2026-08-29 `ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](./sessions/2026-08-29-upstream-bump-and-forklog.md)
  - Integrate `v1.18.25`, verify every seam, rebuild, and establish linked
    feature/session provenance.
- [2026-09-02 `ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](./sessions/2026-09-02-opencode-omo-refresh.md)
  - Reconcile Linux and macOS feature work, integrate `v1.18.27`, rebuild both
    hosts, and refresh OMO assignments.
- [2026-09-04 `ses_fb9a784deffe7zkW0r8oo25Nkg`](./sessions/2026-09-04-opencode-omo-refresh.md)
  - Integrate `v1.18.29`, rebuild the macOS fork, and migrate OMO overrides to
    canonical reasoning without changing effective assignments.
- [2026-09-08 `ses_fb9a784deffe7zkW0r8oo25Nkg`](./sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - Integrate upstream `dev` past `v1.18.29` for the Astra prompt, rebuild the
    macOS fork, and report OMO assignments read-only around an OMO reinstall.
- [2026-09-09 `ses_f76ce0cf6ffejNGTCJyk7ooYc5`](./sessions/2026-09-09-watcher-emfile-wedge.md)
  - Stop a refused inotify instance from parking the JS main thread and wedging
    every turn, authored on upstream `a9a6fad0f` and cherry-picked in.
- [2026-09-10 `ses_f76ce0cf6ffejNGTCJyk7ooYc5`](./sessions/2026-09-10-watcher-emfile-acceptance.md)
  - Establish whole-turn acceptance for the inotify preflight on throwaway
    Linux VMs, including Arch's packaged `opencode-bin` reproducing the wedge
    and a compiled patched binary surviving it.
- [2026-09-22 `ses_fb9a784deffe7zkW0r8oo25Nkg`](./sessions/2026-09-22-dev-nowaker-rebuild.md)
  - Replay every customization onto upstream `dev` as the linear `dev-nowaker`,
    retire `master-nowaker`, and stamp builds with the contained release.

Historical session evidence remains in each feature timeline. A historical
session does not get a fabricated file when its full narrative was not found.

## Upstream integration history

Upstream integration is a session activity, not a durable customization. Full
evidence and no-match searches are preserved in the applicable linked session
records.

- `0ac3fad6f` (2026-07-28) - merge `github/dev`.
- `421923926` (2026-08-04) - merge upstream `v1.18.13`.
- `8617f1049` (2026-08-11) - merge upstream `v1.18.16`.
- `9d78ca8c6` (2026-08-15) - merge upstream `v1.18.18`.
- `0a12138e8` (2026-08-29) - merge upstream `v1.18.25`.
- `ca4200381` (2026-08-29) - join patch-equivalent remote ancestry; the tree
  stays unchanged.
- `5b80c26d6` (2026-09-02) - merge upstream `v1.18.27` after reconciling the
  Linux prompt-latency and macOS native-command work.
- `a438486ba` (2026-09-04) - merge upstream `v1.18.28` after reversing and
  reapplying the canonical retry-header delay cap.
- `9f8f2b0b5` (2026-09-04) - merge exact upstream tag `v1.18.29` while
  preserving the canonical retry-header delay cap.
- `2e900eb2b` (2026-09-08) - merge upstream `dev` head `5cd8e68fd`. Upstream
  published no release tag after `v1.18.29`, so this integrates 29 untagged
  commits, including the Astra system prompt.
- `7946757514` (2026-09-22) - start `dev-nowaker` at upstream `dev` head
  `2406400f0` (contains `v1.18.32`) and cherry-pick the 37 first-parent fork
  commits. The tree equals merging `dev` into `master-nowaker`; later bumps
  rebase `dev-nowaker` onto upstream `dev` instead of merging.
- `6636d662fa` (2026-10-04) - rebase `dev-nowaker` onto upstream `dev` head
  `907b3bc518` (contains `v1.18.34`); 61 commits, all patch-identical.

## Update workflow

1. Merge or rebase source work before editing the forklog.
2. Create one session record for the current session and user workday.
3. Update every applicable feature and link its timeline entry to that session.
4. Link the session back to every feature it changed or re-verified.
5. Preserve `TBD`, confidence labels, and explicit failed searches verbatim.
6. Commit all forklog edits together, unsquashed and above the source head.
7. Include `AI-Session-ID: <full-session-id>` with the standard AI trailers.

Work continuing after midnight belongs to the evening's workday. A feature
starts on its first user workday; a session record uses that session's workday.

## Audit and upstream lifecycle

- Record every fork-only source commit, including work on retired
  `master-nowaker`, and classify documentation/build/integration commits
  separately from behavior changes.
- Inspect local branches, both fork remotes, and linked worktrees. Distinguish
  patch-equivalent landed content from unique unlanded work; ancestry alone
  does not establish whether a rebased or cherry-picked change landed.
- Link the originating source-work session by full ID. Flag a source-editing
  session without a fork trace separately from a no-edit investigation or an
  OpenCode-tools plugin change. Preserve failed searches and `TBD` values.
- Record upstream PR URL, state, head, base, merge commit, and check time in
  the Vibeterm inventory. A closed PR is not necessarily merged; a merged PR
  is not necessarily present in the upstream base the fork currently runs.
- For each bug/performance fix, keep a test that exercises its actual seam.
  Run the same test with only the behavior patch disabled and enabled. Record
  both commands, tree identities, exit codes, and the behavioral failure.
  Missing imports or compilation failures do not prove the original defect.
- Add a missing regression test before declaring a fix verified. Do not weaken
  or delete tests to make either run pass. Keep unavailable checks explicit.
- Reassess every carried change against current upstream source and its
  user-visible purpose. Remove an upstream-equivalent patch only after its
  regression passes without that patch; retain the supersession record.
- Perform removal through the normal linear `dev-nowaker` integration,
  preserving unrelated commits and the deliberate retry-header divergence.
  Push fork changes to both remotes and follow the host build/restart contract.
- Submit an upstream bug fix only after a clean day live. Keep upstream
  commits free of AI trailers; put required attribution in the PR's final
  body line per `/home/nowaker/projekty/forks/AGENTS.md`. Keep full AI trailers
  on forklog commits on `dev-nowaker`.
- Check all inventoried upstream PRs weekly through the coordinator's durable
  schedule, update the Vibeterm inventory, and record source-backed upstream
  supersession here. Coordinate with an existing feature owner before edits.
