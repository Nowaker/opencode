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

- [Per-run abort provenance](#per-run-abort-provenance)
- [On-demand search outside repositories](#on-demand-search-outside-repositories)
- [Inactive HTTP Directory Instances](#inactive-http-directory-instances)

- [Cooperative owner retirement](./features/2026-10-11-owner-retirement.md)

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
- [v1 database guard gate before install](./features/2026-10-08-v1-db-guard-gate.md)
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
- [Show the turn's variant in assistant message footers](./features/2026-10-06-tui-footer-variant.md)
- [Answer prompts queued around /compact and resume the turn it cut](./features/2026-10-07-compaction-queued-resume.md)
- [Act on clicks on the shown agent, model, IDs, usage, files and todos](./features/2026-10-07-tui-click-controls.md)
- [Choose every message footer detail the same way, message ID included](./features/2026-10-07-tui-footer-elements.md)
- [Choose how much tool output shows before "Click to expand"](./features/2026-10-08-tui-tool-output-collapse.md)
- [Pass messageID to the shell.env hook](./features/2026-10-08-shell-env-message-id.md)
- [Editor-standard Home and End defaults](./features/2026-10-09-editor-home-end.md)
- [Revert messages without reverting files, shown at once](./features/2026-10-10-tui-revert-messages.md)
- [Unqueue a prompt waiting behind the running turn](./features/2026-10-10-tui-unqueue-prompt.md)
- [Delete a paste placeholder whole on word and line deletes](./features/2026-10-10-paste-placeholder-delete.md)
- [Configure when a paste is summarized and what its placeholder says](./features/2026-10-10-paste-summary-config.md)
- [Paste without a placeholder](./features/2026-10-10-paste-raw-key.md)
- [Grouped prompt undo and redo on ctrl+z / ctrl+shift+z](./features/2026-10-10-prompt-undo-history.md)
- [Open a paste placeholder's text by clicking it](./features/2026-10-10-paste-edit-dialog.md)
- [End every tool call that runs past a time limit](./features/2026-10-11-tool-call-time-limit.md)
- [Never delete a file whose earlier content the snapshot store lost](./features/2026-10-11-revert-keep-missing.md)
- [Log which process holds the SQLite write lock too long](./features/2026-10-11-sqlite-write-hold-log.md)
- [Machine provenance on messages and session execution](./features/2026-10-10-machine-provenance.md)
- [Syntax coloring in tool calls: bash, heredocs, file languages, tool input](./features/2026-10-11-tool-syntax-coloring.md)
- [Prompt start height, percentage sizes and home screen layout](./features/2026-10-12-home-screen-layout.md)
- [Deliver and settle TUI worker requests without startup races](./features/2026-10-12-tui-worker-error-reply.md)
- [tui.json decides over remembered runtime toggles](./features/2026-10-12-tui-config-toggle-precedence.md)
- [Markdown in submitted user messages and plugin-defined message blocks](./features/2026-10-14-user-message-markdown.md)
- [Read project config above the git root (v2 backport, fork-only)](./features/2026-10-15-config-walk-root.md)
- [Prompt history scoped to the session](./features/2026-10-15-prompt-history-scope.md)
- [ctrl+u deletes back to the line start, or the whole line](./features/2026-10-16-input-line-discard.md)
- [A paste dialog with cleanup and wrap options on every paste](./features/2026-10-16-paste-dialog-mode.md)
- [Transcript filter: choose which kinds of entries the transcript shows](./features/2026-10-16-transcript-filter.md)
- [Send a turn past the composer from a TUI plugin](./features/2026-10-16-tui-prompt-deliver.md)
- [Record who requested a cancel on the aborted row](./features/2026-10-16-abort-requester.md)
- [Concurrent first open of a fresh database](./features/2026-10-16-fresh-db-concurrent-init.md)

## Session records

- [2026-10-18 `ses_eae68f338ffepUkW4TfyEKqFCp`](./sessions/2026-10-18-compaction-log-path.md) - Keep always-on compaction diagnostics under the canonical XDG/runtime log directory; real prompt-loop regression and isolated installed HTTP compaction proof.

- [2026-10-17 `ses_eebf9a83fffeIQQwW9gVFo5jaO`](./sessions/2026-10-17-spawn-prompt-recheck.md)
  - The 2026-10-13 "4.3 KB `--prompt` hangs a new-session spawn" report does
    not reproduce on `vt-343`, bare or through `vt-spawn-session`; on `vt-275`
    a one-line prompt hangs the same way, so it was the Bun worker-request
    loss fixed in `vt-285`, not the text. No source change.

- [2026-10-16 `ses_eb83d5fd6ffe2F4YAv9F3pW2IU`](./sessions/2026-10-16-abort-requester.md)
  - `POST /session/{id}/abort?requester=` (`tui`, `tui-revert`, `api`;
    default `api`, others `400`); the TUI sends `tui` for its interrupt and
    `tui-revert` for undo; vt-343 on both hosts; fork-only.

- [2026-10-16 `ses_eb8582f68ffeUwFYhDGSv6jx7B`](./sessions/2026-10-16-fresh-db-concurrent-init.md)
  - Fix concurrent first opens of a fresh database (WAL switch before the
    busy timeout, WAL upgrade deadlock-avoidance BUSY, double schema
    creation); isolated builds on desktop and m4max, nothing installed.

- [2026-10-16 `ses_ed24b7cfbffe5YyKo7piBEsLF6`](./sessions/2026-10-16-tui-prompt-deliver.md)
  - Add `api.prompt.deliver`, so vibeterm deliveries reach a session while a
    dialog is open over its composer, without closing it or touching the
    draft; build and install on both hosts.

- [2026-10-16 `ses_eb93ce62fffekug2rIeYIQFnpF`](./sessions/2026-10-16-transcript-filter.md)
  - `/filter` (ctrl+x f) dialog shows or hides 13 entry kinds, with tool calls
    and file actions narrowed by name; `transcript.show` defaults; vt-327 on
    both hosts; no v1 PR (needs #56007, #53871, #53660).

- [2026-10-16 `ses_eec5b71ddffe4A47jCysfkQh6l`](./sessions/2026-10-16-history-bar.md)
  - Benchmark load all on ten long sessions (+1.3-4.3 GB, 15-164 s); three-row
    hidden-messages bar with 100-message pages and a `load all (slow / memory
    heavy)` label from measured per-message cost; vt-326 on both hosts; v1
    issue #56279 and PR #56280.

- [2026-10-16 `ses_ed7634c31ffeH84yR0S99Ty8Nd`](./sessions/2026-10-16-paste-dialog-mode.md)
  - `prompt.paste_mode: "dialog"` opens a paste dialog with remembered
    options and a live editable preview; v1 PR #56268 on #54463; vt-322 on
    both hosts; enforced through Vibeterm (opencode-tools `33022c63`).

- [2026-10-16 `ses_eb98d3216ffe2113Brjvcvlgcr`](./sessions/2026-10-16-input-line-discard.md)
  - `input.line_discard` (`bash` | `zsh`) decides ctrl+u in every text field;
    issue #56242, v1 PR #56246; vt-321 on both hosts; opencode-tools
    `5f9ef2bf` makes Vibeterm's fields follow the same value.

- [2026-10-15 `ses_ebbf8304effeyn1vwapV0HP1Bm`](./sessions/2026-10-15-file-tool-limit.md)
  - read, write, edit, grep and glob end after 10 minutes (a lower
    `tool_timeout.default` applies); ripgrep aborted with the call; added to
    PR #54503; installed `vt-310` on both hosts, FIFO-read proof.

- [2026-10-15 `ses_ed1e2b932ffe6tTqhsOiGuYXRE`](./sessions/2026-10-15-file-output-syntax.md)
  - Tool history screened (bash reads/searches, read, grep, grep_app, context7);
    `syntax.file_output` colors file contents in tool output by language; v1 PR
    #56007 on #54968; installed `vt-308` on both hosts.

- [2026-10-15 `ses_ebdb29581ffeD6A9dXs1sZAis2`](./sessions/2026-10-15-config-walk-root.md)
  - Backport of v2: `opencode.json`/`.opencode/` found up to the filesystem
    root, past the git root, nearest wins, global guards; no upstream PR;
    vt-305 on both hosts, `debug config` proof.

- [2026-10-15 `ses_ebdf069dbffeooZAqUSORaYd5z`](./sessions/2026-10-15-prompt-history-scope.md)
  - `prompt.history_scope` (`global` | `session`) scopes up / down to the
    session's own prompts; v1 PR #55902; vt-304 on both hosts;
    opencode-tools `7bc57a3d` enforces Vibeterm's tui.json defaults while
    unset, `session` among them.

- [2026-10-14 `ses_ee6a1ab65ffeoR9UKM5RnpfCzC`](./sessions/2026-10-14-click-any-id.md)
  - A click on any other ID in the transcript (`prt_`, a plugin's `sch_`, a
    `callID:` value) is handed to `api.click.on` as kind `id` with the text
    before it, else copied; build and install on both hosts.

- [2026-10-14 `ses_ed1e2b932ffe6tTqhsOiGuYXRE`](./sessions/2026-10-14-shell-command-collapse.md)
  - `tool_input.collapse` cuts long bash commands, `tool_output.tail` shows
    output's last lines with v2's `collapseTail`, and `tool_output.head` keeps
    first lines above a `(N more lines)` marker; v1 PR #55421, v2 PR #55444;
    opencode-tools `a42e4c6` stops a new TUI knob dropping the shared layer.
  - `browser` calls: plugin input capped per tool, JSON output drawn as YAML
    rows (`json-as-yaml`, `tool_output.collapse_yaml`); opencode-tools
    `bb40e38`/`591ade8` make per-tool tui.json values Vibeterm knobs.

- [2026-10-14 `ses_ec57be11affe3kxXJ4WyM3OwOY`](./sessions/2026-10-14-user-message-markdown.md)
  - `syntax.user_messages` colors markdown in submitted messages; `syntax.blocks`
    and `api.blocks.register` draw delimited blocks, `[vibeterm_*]` as YAML via
    the route plugin; issues #55439/#55440, PRs #55441/#55442; vt-292 on both
    hosts, enforced on both.

- [2026-10-14 `ses_eebf9a83fffeIQQwW9gVFo5jaO`](./sessions/2026-10-14-instant-drag-copy.md)
  - A drag anywhere on opencode's instant home and "Loading session…" screens
    copies the drawn text (OSC 52 plus native clipboard), not only inside the
    prompt; PTY drags in both startup phases; build and install on both hosts.

- [2026-10-14 `ses_ec549ca11ffeaEknagLhxmfpFp`](./sessions/native-fork-lineage.md) - Exact native-fork source lineage in the initial creation event; isolated native runtime and installed desktop/m4max HTTP proof, with both migration guard gates passing.

- [2026-10-14 `ses_ec6f8faa7ffeQU4hWGG3qv7cSp`](./sessions/2026-10-14-prompt-admission.md)
  - `prompt_async` acknowledges durable admission, returns a marked
    `PromptAdmissionError` for confirmed rejection, and stops rejected
    concurrent duplicates; real HTTP regressions and desktop installed proof.

- [2026-10-13 `ses_eebf9a83fffeIQQwW9gVFo5jaO`](./sessions/2026-10-13-tui-spawn-hang.md)
  - A spawned new-session tab stayed blank because Bun 1.4.x drops worker
    messages sent during the worker's top-level awaits; red/green on the
    installed binaries for `95113b27bc`'s `rpc.ready` handshake, pushed with
    m4max's forklog to both remotes; no upstream PR (upstream builds with Bun
    1.3.14).

- [2026-10-12 `ses_ecd4cb9a4ffexYnAMRzHjPZDUp`](./sessions/2026-10-12-tui-config-precedence.md)
  - Audit every fork tui.json key against kv.json toggles: a set key now
    decides over a remembered toggle (sidebar context, pin title, session ID,
    keep scroll, turn timing, sidebar order), `tool_output.collapse` shows
    generic output, toggles toast; carried onto nine owning branches;
    opencode-tools `KV_TOGGLES`; build and install on both hosts.

- [2026-10-12 `ses_ece4671adffe4Y4d8Yv35NSjXh`](./sessions/2026-10-12-v1-v2-patch-rig.md)
  - opencode-tools `opencode-patch-rig.ts` tests every TUI patch on v1 and v2
    in a real terminal; the [matrix](#tui-patches-on-v1-and-v2); nine v2
    ports with PRs #54958-#54966 and #54978 against `dev`.

- [2026-10-12 `ses_ece469f46ffeIkbDfxO1jJY6D6`](./sessions/2026-10-12-home-screen-layout.md)
  - The prompt never grows past the screen; `prompt.min_height`, percentage
    sizes, `home.logo`/`tips`/`prompt_position`, logo gap one row; upstream
    issues #54946/#54947, PRs #54948/#54949; opencode-tools seeds Vibeterm's
    defaults; build and install on both hosts.

- [2026-10-12 `ses_eebf9a83fffeIQQwW9gVFo5jaO`](./sessions/2026-10-12-tui-worker-hang.md)
  - `opencode -s` hung forever when a busy database failed session
    maintenance at startup: maintenance now retries the lock for up to 60 s,
    and a failed TUI worker request is answered (issue #54934, PR #54936
    against `v1`); build and install on both hosts.

- [2026-10-12 `ses_ed1e2b932ffe6tTqhsOiGuYXRE`](./sessions/2026-10-12-tool-input-compact.md)
  - Tool input block: one row per value while collapsed, compact YAML lists;
    PR #54707 amended; opencode `*.scm` typecheck fix; tool output colored
    by `syntax.tool_output` (PR #54968); build and install on both hosts.

- [2026-10-11 `ses_ed1e2b932ffe6tTqhsOiGuYXRE`](./sessions/2026-10-11-tool-syntax-coloring.md)
  - Syntax coloring in tool calls: bash command, heredocs by consumer, file
    languages with bundled grammars, opt-in tool input block; upstream PRs
    #54704-#54707; build and install on both hosts.

- [2026-10-11 `ses_ee68aab01ffei41gwUGJ5ESj6W`](./sessions/2026-10-11-tui-footer-midnight.md)
  - On-screen footers and timestamps switch to the date-and-time form at
    local midnight from one shared timer; PR #53877 branch and body
    updated; build and install on both hosts.

- [2026-10-11 `ses_ed2434bbbffelX96qcp5XqFLNw`](./sessions/2026-10-11-fork-test-regressions.md)
  - Fix three fork-owned test regressions: unpaged session messages skip
    the response schema, metadata updates lost to the provenance merge,
    OpenAI OAuth dropped for the default baseURL; PR #53660 head amended;
    build and install on both hosts.

- [2026-10-11 `ses_ed759a0b4ffeCubC9xxc8hYgHY`](./sessions/2026-10-11-revert-keep-missing.md)
  - A file revert deleted every file whose earlier content the snapshot store
    had pruned; it now keeps them and names them in a notice. Issue #54577,
    PR #54578 against `v1`; build and install on both hosts.

- [2026-10-11 `ses_ee0ceb1aaffeh6u0RxoARcBsk1`](./sessions/2026-10-11-owner-retirement.md)
  - Idle-safe engine and native composer retirement for Vibeterm's durable,
    fenced whole-server restart scheduler; source and real-surface verification.

- [2026-10-11 `ses_ed5bde150ffepnn3xqxHaucDLN`](./sessions/2026-10-11-tool-call-time-limit.md)
  - A hard time limit on every tool call (`tool_timeout`, plugin
    `tool({ timeout })`, MCP `tool_timeout`), upstream PR #54503; build and
    install on both hosts, desktop serve units restarted.
- [2026-10-11 `ses_ed5f9f826ffeno6fI51rL96d5Q`](./sessions/2026-10-11-upstream-v1-19.md)
  - Upstream `dev` became the v2 line: repoint the fork, `build.sh` and
    opencode-tools from `github/dev` to `github/v1`, rebase `dev-nowaker`
    onto `v1.19.0`, retarget the open and closed upstream PRs to `v1`;
    build and install on both hosts.
- [2026-10-10 `ses_ed759a0b4ffeCubC9xxc8hYgHY`](./sessions/2026-10-10-revert-unqueue.md)
  - "Revert messages" vs "Revert messages and files" (`files` on the revert
    route, `revert.files`, fork default messages only), reverts shown at once,
    and "Unqueue" for a queued prompt with a race-safe server guard; PRs
    #54436 and #54437; build and install on both hosts.
- [2026-10-10 `ses_ef46f1775ffe29MtElYF4DQySL`](./sessions/2026-10-10-home-end-regression.md)
  - Fix the editor-standard Home/End regression seen from m4max: repeated
    home/end stay on the line (`gotoLineEdge`), and the Terminal.app VibeTerm
    profile sends ctrl and ctrl+option Home/End (dotfiles `f201350`); build
    and install on both hosts.

- [2026-10-09 `ses_ef46f1775ffe29MtElYF4DQySL`](./sessions/2026-10-09-editor-home-end.md)
  - Default Home/End to the editor-standard scheme (`home`/`end` line,
    `ctrl+home`/`ctrl+end` prompt, `ctrl+alt+home`/`ctrl+alt+end`
    conversation), fork-only; opencode-tools composer fallback `ctrl+end`;
    build and install on both hosts.

- [2026-10-08 `ses_ee26f677effe6fzY9wzepyBf13`](./sessions/2026-10-08-shell-env-message-id.md)
  - `messageID` in the `shell.env` hook input; upstream PR #54032; build
    and install on both hosts.

- [2026-10-08 `ses_ee2d6b316ffeQ4Lr6J5QvW225u`](./sessions/2026-10-08-v1-db-guard-gate.md)
  - `.vibeterm/build.sh` refuses to install a binary the v1 database guard
    gate has not passed.

- [2026-10-08 `ses_ee68aab01ffei41gwUGJ5ESj6W`](./sessions/2026-10-08-tui-footer-datetime-format.md)
  - `datetime_format` for every time the TUI writes, each message ID once,
    the footer on a block tool's expand hint line, a stopwatch on running
    tool calls, a blank line before a prompt's footer, and
    `tool_output.collapse` (PR #54039); PR #53877 branch and
    body updated; build and install on both hosts, `YYYY-MM-DD` /
    `HH:mm:ss` in their `tui.json`.

- [2026-10-07 `ses_ee68aab01ffei41gwUGJ5ESj6W`](./sessions/2026-10-07-tui-footer-elements.md)
  - One `footer` setting with the same value (all, none, important, type
    list) for agent, model, variant, time, duration, total and the new
    message ID, on every tool call too; PR #53877 (bot-closed, v1); build
    and install on both hosts, every key `"all"` in their `tui.json`.

- [2026-10-07 `ses_ee68a7aceffeiGmNH03eS7PU61`](./sessions/2026-10-07-tui-click-controls.md)
  - Click the prompt's agent, model, variant and hints, the sidebar title and
    an MCP row to run their command or toggle the server, also queued from
    the instant startup screens; then ID clicks (copy, or a plugin through
    `api.click.on`), esc interrupt, usage, directory, footer model, Modified
    Files and todo clicks; PR #53871 (bot-closed, v1); build and install on
    both hosts.

- [2026-10-07 `ses_ee69f1639ffeFBENk91r80bAJB`](./sessions/2026-10-07-compaction-queued-resume.md)
  - A `/compact` during a running turn no longer swallows a prompt queued
    around it and no longer ends the turn: the prompt is answered after the
    summary, or the turn continues; proved live in a TUI tab; upstream issue
    #53862 and PR #53863; build and install on both hosts.

- [2026-10-07 `ses_eec44cf7effeFCqQefM0NkWLaW`](./sessions/2026-10-07-tui-footer-variant.md)
  - Add `footer_variant` so assistant message footers show the turn's
    variant (`high`, `max`); upstream issue #53846 and PR #53848, needs a v2
    port later; build and install on both hosts, `true` set in their
    `tui.json`.

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

## tui.json settings and runtime toggles

Rule for every tui.json key that also has a runtime toggle (palette command,
slash command, click or drag): **set in tui.json, it decides on every start
and the toggle lasts until opencode exits, with a toast saying so; unset, the
toggle is remembered in `kv.json`.** A new key must not duplicate an upstream
kv toggle; give that toggle a tui.json default under this rule instead. Read
such a key as `sessionOverride() ?? config ?? kv.get(key, default)`, never
`kv.get(key, config)`. List it in tui.mdx "Settings with a toggle" and in
opencode-tools `KV_TOGGLES`. Inventory and history:
[feature record](./features/2026-10-12-tui-config-toggle-precedence.md).

## TUI patches on v1 and v2

Upstream `dev` is v2; v1 (`github/v1`) gets maintenance only. Each TUI patch
keeps its v1 PR and branch; a v2 port is a separate `v2-<name>` branch cut
from `github/dev` with its own PR against `dev`. The opencode-tools rig
[`opencode-patch-rig.ts`](https://gitlab.com/Nowaker/opencode-tools/-/blob/master/_lib/opencode-patch-rig/README.md)
produces this table: `bun opencode-patch-rig.ts --all` (about 35 minutes;
`--levels apply` alone takes 40 seconds). `proved` means the scenario passes
with the patch and fails on the vanilla base; `pass` without a scenario means
the stack applies, typechecks and its own tests pass.

v2 cost: `ported` (PR open), `S`/`M`/`L` (estimated port size; M and L wait
for a decision), `not applicable` (v2 has no such surface), `superseded` (v2
already behaves so).

Run 2026-10-12, v1 `dfb56f76c7` (`v1.19.0`), v2 `039eb85ba1`;
[session record](./sessions/2026-10-12-v1-v2-patch-rig.md).

| Patch | v1 PR | v1 | v2 | v2 PR |
|---|---|---|---|---|
| `tui-lsp-oneline` | #53185 | proved | not applicable: v2 sidebar has no LSP section | - |
| `tui-submit-scroll` | #53187 | proved | ported `v2-keep-scroll` (`session.keep_scroll_on_submit`), proved | [#54963](https://github.com/anomalyco/opencode/pull/54963) |
| `tui-sidebar-pin-title` | #53194 | pass | superseded: v2 draws the title above the sidebar scroll box | - |
| `tui-turn-timing` | #53195 | proved | M: v2 footer already shows duration; time of day, the total and `/turn-times` need porting | - |
| `tui-sidebar-order` | #53201 | proved | L: v2 rewrote the plugin slot host | - |
| `tui-context-display` | #53205 | proved | ported `v2-context-compact` (`session.context`), proved | [#54966](https://github.com/anomalyco/opencode/pull/54966) |
| `tui-sidebar-drag` | #53217 | pass | L, after sidebar order | - |
| `fix-scroll-follow` | #53219 | pass | likely superseded: v2 pins its mounted span when the reader leaves the bottom (`routes/session/index.tsx`); no scenario yet | - |
| `tui-todo-summary` | #53259 | pass | not applicable: v2 sidebar has no Todo section | - |
| `tui-mcp-summary` | #53261 | proved | ported `v2-mcp-summary` (`session.mcp_summary`), proved | [#54960](https://github.com/anomalyco/opencode/pull/54960) |
| `tui-context-colors` | #53264 | proved | ported `v2-context-colors` (`usage`), proved, stacked on #54966 | [#54978](https://github.com/anomalyco/opencode/pull/54978) |
| `tui-todo-completed` | - | pass | not applicable: no Todo section | - |
| `tui-mcp-list` | #53322 | proved | ported `v2-mcp-list` (`session.mcp_list`), proved | [#54965](https://github.com/anomalyco/opencode/pull/54965) |
| `tui-block-nav` | #53333 | pass | L: v2 has its own message navigation and anchors; compare first | - |
| `tui-home-return` | #53630 | pass | L, after block navigation | - |
| `tui-model-id` | #53639 | proved | ported `v2-model-label` (`session.model_label`), proved | [#54962](https://github.com/anomalyco/opencode/pull/54962) |
| `tui-part-timestamps` | #53654 | proved | M, after turn timing | - |
| `abort-feedback` | #53655 | proved | ported `v2-abort-feedback`, proved | [#54961](https://github.com/anomalyco/opencode/pull/54961) |
| `abort-keybind-feedback` | #53656 | proved | M: command, keybind and Escape-burst resolver in v2's keymap | - |
| `tui-history-crop` | #53660 | proved | L: needs v2 server paging and sync | - |
| `sidebar-session-id` | #53663 | proved | ported `v2-sidebar-id` (`session.sidebar_id`, no `/session-id`), proved | [#54964](https://github.com/anomalyco/opencode/pull/54964) |
| `tui-lazy-provider-list` | #53680 | pass | superseded: v2 starts the location catalog load without awaiting it (`context/location.tsx`); only `--prompt` auto-submit waits for it | - |
| `provisional-prompt` | #53698 | conflict: PR head predates `v1.19.0` (`dev-nowaker` carries it rebased) | L: v2 plan phase 2 | - |
| `tui-footer-variant` | #53848 | proved | ported `v2-footer-variant` (`session.variant`), proved | [#54958](https://github.com/anomalyco/opencode/pull/54958) |
| `tui-click-controls-pr` | #53871 | conflict: PR head predates `v1.19.0` | L: 15 files | - |
| `tui-footer-elements` | #53877 | proved | L: v2 footer rewritten | - |
| `tui-tool-collapse` | #54039 | proved | M: v2 tool views and verbosity differ | - |
| `tui-command-collapse` | #55421 | not in the rig yet | v2 already cuts the command to 2 rows and tails output; `v2-shell-collapse` makes both limits configurable (`session.shell_lines`, `session.shell_command_lines`); `tool_output.head` needs porting (S) | [#55444](https://github.com/anomalyco/opencode/pull/55444) |
| `v1-revert-messages` | #54436 | pass | L: v2 revert is server-side and different | - |
| `v1-unqueue-prompt` | #54437 | pass | superseded: v2's Queued prompts dialog has "undo" (`queued_prompt.undo`), which cancels the prompt and puts it back in the prompt box | - |
| `paste-placeholder-delete` | #54457 | proved | M: the `@opentui/core` 0.4.5 patch needs redoing for 0.5.17 | - |
| `paste-summary-config` | #54458 | proved | ported `v2-paste-summary` (`prompt.paste_summary`), proved | [#54959](https://github.com/anomalyco/opencode/pull/54959) |
| `paste-raw-key` | #54459 | proved | M | - |
| `prompt-undo-history` | #54460 | pass | L | - |
| `paste-edit-dialog` | #54463 | pass | L | - |
| `paste-dialog-mode` | #56268 | not in the rig yet | L, after `paste-edit-dialog` | - |
| `transcript-filter` | - (needs #56007, #53871, #53660) | not in the rig yet | L: v2 transcript rewritten | - |
| `bash-syntax` | #54704 | proved | M: v2 tool views rewritten | - |
| `heredoc-syntax` | #54705 | proved | M, after bash syntax | - |
| `file-languages` | #54706 | proved | M | - |
| `tool-input-block` | #54707 | pass | M | - |
| `prompt-fit-screen` | #54948 | proved | superseded: v2 has no `prompt.max_height`, and a 30-line prompt stays on screen | - |
| `home-layout-options` | #54949 | proved | L: v2 home screen differs; needs design | - |

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

A bump installs only through `.vibeterm/build.sh`, whose v1 database guard
gate (`vibeterm-v2-guard gate`) must pass. A red gate means a new v1 or v2
release defeats the guard that keeps a stray opencode v2 from migrating the
live v1 database: fix `_lib/v2-migration-guard` in opencode-tools first, and
never set `OPENCODE_SKIP_V2_GUARD_GATE` to get past it.

Work continuing after midnight belongs to the evening's workday. A feature
starts on its first user workday; a session record uses that session's workday.

## On-demand search outside repositories

Source: `packages/core/src/filesystem/search.ts`. A Location without `vcs`
uses ripgrep rather than creating fff's permanent recursive watcher. Its
`find` waits for a fresh scan per request, keeping the existing 100,000-file
scan bound, fuzzy matching, directory path suffixes and default 50-result
limit. Empty/whitespace queries list entries. Git roots and Git worktrees
keep the existing fff path, including the explicit disable/unavailable
fallback. No extra Git probe or timer is added.

`glob` and `grep` retain the existing on-demand ripgrep adapter, including
scoped paths, limits and nested ignore rules. Discovery skips hidden files;
explicit glob patterns and grep can match hidden files. Directory discovery
derives parents of discovered files, as the existing ripgrep fallback does.

Worktree evidence from `ses_ecc45c623ffecHtWFB24tFBP1n`, base `a100f85998`,
branch `container-search`:

- With only search.ts restored byte-identically to `a100f85998`, the final
  eight-case suite in a clean environment has 1 pass, 7 fail (exit 1):
  first results, creation/rename/directory freshness, scoped grep, empty
  query and ignored-tree discovery. Restoring the committed fix gives
  8 pass, 0 fail. Empty-query listing also has its own pre-fix failure.
- After changes: filesystem, location-filesystem, location and location-layer
  tests 54 pass, 0 fail;
  `bun typecheck` in `packages/core` exits 0.
- Retained Linux driver: `packages/core/script/search-watch-proof.ts`;
  worker: `packages/core/script/search-watch-worker.ts`. Run from
  `packages/core` with a clean environment and an empty scratch HOME:
  `env -i PATH="$PATH" HOME="$scratch" bun script/search-watch-proof.ts "$output"`.
  The JSON output retains each measured thread's CPU and watch counts;
  stdout reports aggregates only. The driver isolates child HOME, XDG and
  tool/plugin stores, kills only its children and removes only its fixture.
- Three repeats, 16 nested Git repositories, 20 directories per each of
  `src`, ignored `build` and ignored `node_modules`; 352 churn files,
  approximately 25 ms between batches, 3 s idle then 3 s churn per process.
- Watched non-repository baseline: 353 watches, 11.31-11.99% of one core
  during churn, busiest thread 9.98-10.66%. Candidate: zero watches,
  0-0.33% total/thread CPU. Repository control: 355 watches, 12.31-14.29%
  total CPU. This is a small synthetic mechanism proof, not a measurement
  of the reported customer tree or its 48,000-watch processes.
- Startup samples include module initialization, searches and the explicit
  one-second settling period. Candidate readiness additionally includes
  mutation assertions; these samples are not a startup-speed comparison.
- Candidate driver also asserts immediate creation, rename, deletion,
  content mutation, directory filtering, scoped glob/grep and empty-query
  listing through the actual service. No customer tree or live tab is used.

Delivery verified by coordinator `ses_eeda1d251ffel81U5Y42j4kb33` on
2026-10-13:

- Oracle approved exact candidate `169d7a138d` with no blocking findings.
  Main independently reran the Linux proof: baseline 353 watches,
  7.93-8.98% churn CPU; candidate zero watches, 0.33% churn CPU.
  These windows contain no search requests and measure background work,
  not request latency or a search-performance SLA.
- Rebased onto local `dev-nowaker` (already current), fast-forward merged,
  and pushed `169d7a138d` to both fork mirrors; remote tips verified.
  Normal push hooks passed all 30 workspace typecheck tasks.
- Desktop built independently from the clean candidate with tracked
  `.vibeterm/build.sh`. The mandatory v1 migration guard gate passed against
  built v1, `opencode-ai@1.19.0` and `@opencode/cli@2.0.27`; installed version
  `1.19.0-vt-275-dfb56f76c7`.
- An isolated installed-binary HTTP server verified immediate initial
  discovery, creation, rename, deletion and empty-query listing through
  `/find/file`. Scratch was outside every repository so upward Git discovery
  selected the non-repository path. No production state was used.
- m4max independent build/install/QA remains blocked on an available
  authorized remote execution transport; question
  `qst_13411df28001mxjyIukRVnblcv` records the unblock choices.
- No active DreamHost tab, default Vibeterm server or Meridian was restarted.
  Existing tabs retain their loaded code until their owners arrange graceful
  pickup. No live-tree CPU or watch reduction is claimed.

## Per-run abort provenance

Requested by `ses_ebc7292d6ffe0m5W6cH7M4vIPv`, coordinated with TUI owner `ses_ef8235798ffejGr4sa22eXmVNv`; server delivery owned by `ses_eeda1d251ffel81U5Y42j4kb33`. Implementation session `ses_eb88b23e0ffel0OTb0SfRWcxFq`, branch `abort-cause`, base `931f3a854a`, upstream v1 base `dfb56f76c7`. Existing assistant errors could not distinguish explicit cancellation from instance teardown. Server commits `b3b8e00fe1`, `ae7260485d`, `d96ede7572` and `17dd5f13b8` add optional metadata without changing `error.name = "MessageAbortedError"` or `error.data.message`; `2755c68f92` mechanically refreshes the previously stale OpenAPI snapshot, including existing non-abort contracts.

- `error.data.cause`: `cancel` for explicit cancellation, `dispose` for instance teardown. Schemas also accept `killed` for Vibeterm-written rows; OpenCode does not emit it. Legacy rows may omit all new fields.
- `error.data.dispose`: optional `exit`, `reload`, `config` or `api`, only with `cause = "dispose"` when the caller knows the source. Other teardown omits the detail.
- `error.data.requester`: optional `tui`, `tui-revert` or `api`, only with `cause = "cancel"` when supplied. Server plumbing accepts `SessionPrompt.cancel(sessionID, { requester })`; HTTP input/defaulting and SDK/TUI callers are the TUI owner's separate follow-on, not part of this server delivery; delivered in [Record who requested a cancel on the aborted row](./features/2026-10-16-abort-requester.md).
- Stable seams: canonical `packages/schema/src/v1/session.ts` AbortedError fields, Core's shared schema fields, `Runner.make` admission `prepare` and serialized `cancelWith`, `SessionAbort.Current`, `SessionRunState` disposal observer, both processor and prompt interruption finalizers, and the worker/global/API disposal call sites. Metadata belongs to one admitted run; the first cancellation/disposal claim wins and replacement work gets a fresh cell.
- Generated artifacts: `packages/sdk/js/src/v2/gen/types.gen.ts` and `packages/sdk/openapi.json`; `packages/client` generation produced no changes. Regenerate rather than hand-edit them on future schema changes.

Oracle `ses_eb857fecfffePYcIRK3Ddw47ht` approved exact candidate `2755c68f9299884bfaa8910f5968e18ac4d30c67`. Main independently ran 31 runner/run-state/real-HTTP tests and 86 prompt tests (one existing skip), plus package typechecking. The initial prompt run exceeded a 180-second outer command limit; its complete rerun passed in 169 seconds. Known baseline broad-suite `OwnerBusy`, event-manifest and public OpenAPI `SessionBusyError | OwnerSealed` assertion failures are not claimed fixed. Source tests cover supplied requesters, early interruption, cancel/dispose races, legacy and reserved `killed` decoding; actual worker exit/reload was source-reviewed, not interactively exercised.

Source was fast-forward integrated and pushed to both fork mirrors at `2755c68f92`. Both hosts' own tracked builders installed `1.19.0-vt-340-dfb56f76c7`. Mandatory v1 migration guard passed: desktop tested npm v1 `1.19.3` and v2 `2.0.32`; m4max used sanctioned cached v1 `1.19.0` and v2 `2.0.29` because its disk-reserve policy refused fresh downloads. No guard was skipped. The Mac build emitted pre-existing shell-completion warnings but installed successfully.

Main exercised both installed binaries through isolated loopback HTTP with synthetic LLM/MCP and scratch HOME/XDG/tool/plugin stores. Five successive turns on one session persisted `cancel`, `dispose/api` via instance disposal, `dispose/api` via global disposal, `dispose/config`, then `cancel` with no stale disposal/requester fields. Initial/create/rename/delete/empty-query search and idle MCP release/recreation also passed. Reports: desktop tool scratch `abort-installed-qa/run-vDx099/result.json`; m4max `abort-installed-qa/run-ssK9hc/result.json`. The earlier m4max container-search proof passed on installed vt333 (`run-3ynfZG/result.json`), closing its historical transport blocker. No live TUI, serve unit, default Vibeterm server or Meridian was restarted; running processes need owner-arranged pickup.

## Inactive HTTP Directory Instances

Source work: `ses_eba1f3afeffe4Y0zOhc01XWVQx`, delegated by `ses_eeda1d251ffel81U5Y42j4kb33`, branch `serve-idle-instances`, base `5b0adef4ce`. This is worktree verification, not an installed-binary or live-server claim; integration, mirror pushes and installation belong to the coordinator.

Source commits: `824049964c` (directory lifecycle and owner reservations), `0f9253818a` (HTTP request-scope leases), `2baaec5ec5` (MCP activity), `4cc239a005` (serve/web setting, schema, SDK and web documentation). The retained proof and this provenance record are committed separately above those source changes.

Attribution correction: `824049964c`, `0f9253818a`, `2baaec5ec5`, `4cc239a005`, `99e5c00a1f` (retained proof) and `72762bc500` (pending OAuth cleanup ownership) mistakenly carry `AI-Harness: Vibeterm cc30ffb3`. The authoritative session context requires `AI-Harness: Vibeterm 606568b7`; that is the correct harness provenance for all six commits. Their human identity, model, tool version, platform and session trailers are unchanged. History is preserved under the assignment's explicit no-amend constraint; this canonical record corrects the attribution without rewriting those commits.

`opencode serve` and `opencode web` read global `server.instanceIdleTimeout` at startup: milliseconds, default `900000` (15 minutes), `0` disables. A directory is disposed after that interval without activity and recreated on its next request. Session/project/message data is retained. TUI/private HTTP handlers do not opt in; an ordinary `InstanceStore.load` pins its entry even if HTTP opened it first. In-process listeners must explicitly pass `instanceIdleTimeout`.

Stable seams:

- `packages/core/src/v1/config/server.ts`: schema, units and default documentation; regenerated SDK `ServerConfig` carries the optional field.
- `packages/opencode/src/cli/network.ts`, `cli/cmd/serve.ts`, `cli/cmd/web.ts`, `server/server.ts`: global-only configuration and explicit listener opt-in, without changing TUI/ACP/private defaults.
- `packages/opencode/src/server/routes/instance/httpapi/middleware/instance-context.ts`: scoped HTTP acquisition. Effect's request scope spans the Node response writer and WebSocket handler; its Web handler transfers that scope to streamed body exit. Lease release is not tied to handler-return time.
- `packages/opencode/src/project/instance-store.ts`: deduplicated boot, per-entry generation identity, admission/disposal barrier and the existing registered finalizers. Disposal commits synchronously only with the same idle revision and zero active holds; new loads wait for finalizers before creating a replacement. A failed boot finalizes partial state before allowing retry.
- `packages/opencode/src/project/instance-activity.ts`: per-context activity, revision and scoped idle wait, with no process-wide idle scan. Persistent/private entries are outside activity fencing. `owner/quiescence.ts` reuses existing activity/fork/promise reservations, so async session runners, shells, tools, background work and interrupted promise preparation keep their directory alive independently of request completion.
- `packages/opencode/src/mcp/index.ts` and `mcp/catalog.ts`: actual MCP operations and notification-triggered catalog refreshes hold activity; tracked network promises retain it until settlement. Existing `InstanceState`/`ScopedCache` invalidation closes transports and descendants. No second process killer is added to production.

Retained regressions:

- `test/project/instance-idle.test.ts`: deterministic clock expiry/renewal, overlapping request scopes, detached work and independent idle directories, interrupted promises, both private/HTTP load orders, disposal settlement, pending/failed boot, failed cleanup and explicit reload.
- `test/server/httpapi-instance-idle.test.ts`: real dynamic-port Node HTTP requests, open responses, complete/cancelled streams, detached work, WebSocket close, failed handlers, absent/disabled policy.
- `test/cli/serve/instance-idle-timeout.test.ts`: global timeout default, override, disable and rejected invalid values.
- Original focused HTTP test failed before implementation: `0 pass, 1 fail`, `completed HTTP instance retained past idle timeout`; the implemented lifecycle passes the same case.

Linux runtime proof, from `packages/opencode`: `bun script/serve-idle-proof.ts <report.json>`, with `--retained-control` for the disabled-policy control. `serve-idle-probe.ts` reads only PID/start identity, liveness and RSS, never environment or raw argv. The driver launches the source CLI on a dynamic loopback port with an allowlisted environment, private HOME/XDG/tool stores, two directories with a real stdio MCP and descendant each, and an actual `prompt_async` turn held by a local mock LLM. All owned children are identity-checked and cleaned; scratch is removed.

- Exact base `5b0adef4ce`, archived source plus the same driver and PID/descendant fixture instrumentation only: identical proof fails `idle MCP scope was retained`, `2 !== 0`. After 2.5 seconds the idle pair still consumes `98299904` RSS bytes; the active pair remains alive too. The configured one-second limit is not implemented on that base.
- Candidate, one-second window: five processes and `823562240` aggregate RSS bytes at load. During the held turn the active MCP pair remains two processes/`100102144` bytes while the idle pair is zero. After the turn settles both MCP pairs are zero, with only the source server left (`699662336` RSS bytes). Another request creates a different MCP PID.
- Disabled-policy control: both pairs remain alive through the idle window and after turn completion; five total processes remain until driver cleanup. These are small synthetic mechanism measurements, not a projection of the reported 47 live directory sets or a source-server heap bound.
- Inherited `TMPDIR` on this host points inside another Git repository. Use `env -u TMPDIR bun test ...` for non-Git fixture tests. The existing `httpapi-public-openapi.test.ts` busy-error assertion fails identically on archived base and candidate (`SessionBusyError` expected, empty reference returned); it is unrelated to this change and remains untouched.
- Broad root-lifetime run: `env -u TMPDIR bun test --timeout 30000 test/server test/project test/mcp test/session/owner-quiescence.test.ts test/lsp/quiescence.test.ts test/cli/serve`: `497 pass, 3 skip, 1 fail`, with only that baseline-confirmed OpenAPI assertion failing. Session prompt/runner/background regression run: `115 pass, 1 skip, 0 fail`. Core and opencode `bun typecheck` pass; SDK regeneration and its TypeScript build pass; changed TypeScript files have no LSP errors.
- A repeat of the final source process proof again kept the active pair and expired the idle pair, then expired the completed turn's pair and recreated a different PID on demand. Both candidate runs and the retained-control run report successful owned-process cleanup. No live API, configuration, database, serve unit, TUI, default Vibeterm server or Meridian instance was modified or restarted.
- Finalizer safety follow-up: the existing process-global pending OAuth map must not be cleared wholesale when one directory expires. Records carry their directory, and `mcp/pending-auth.ts` removes/closes only that directory's captured transports, preserving a replacement record during close. The unchanged global-clear behavior failed both ownership regressions (`0 pass, 2 fail`); selective cleanup passes all three ownership/failure/replacement cases. Full MCP plus idle/config regression run after this follow-up: `98 pass, 0 fail`; opencode typecheck and the actual source-process proof pass again. This narrows cleanup ownership, not the existing OAuth server-name lookup or credential architecture.
- Oracle review of `425240ff80` found a native-promise lease gap in codemode's raced-out MCP calls and OAuth exchanges. `tool/code-mode.ts` holds the actual SDK promise through native settlement; `mcp/index.ts` holds the complete `startAuth` connect-plus-commit and `finishAuth` exchange-plus-commit continuations, including after a waiting Effect fiber is interrupted. The existing exchange error response is preserved. `test/tool/code-mode-idle.test.ts` and `test/mcp/native-idle.test.ts` exercise actual CodeModeTool/MCP methods over real SDK HTTP transports: all five cases fail before the fix (`0 pass, 5 fail`, disposal count `1` expected `0`), then pass with the same held race/connect/exchange/commit inputs. Each case releases native work, waits for settlement, verifies no disposal at 99 ms, and observes expiry at the full 100 ms idle interval. Interrupted token exchange still commits its fixture credentials. The commit hook in the OAuth tests only gates and delegates to the real provider method; token exchange and credential persistence are real. Command from `packages/opencode`: `env -u TMPDIR bun test --timeout 30000 test/mcp test/tool/code-mode-idle.test.ts test/tool/code-mode.test.ts test/tool/code-mode-integration.test.ts test/project/instance-idle.test.ts test/server/httpapi-instance-idle.test.ts test/cli/serve/instance-idle-timeout.test.ts` gives `154 pass, 0 fail`; `bun typecheck` passes. The seven earlier commits remain unchanged; this correction is a focused new commit for re-review, with no build/install or live-state action.

## Audit and upstream lifecycle

Serve lifetime delivery by `ses_eeda1d251ffel81U5Y42j4kb33`, 2026-10-16:

- Oracle approved runtime `b1eafad48a` after native code-mode/OAuth cancellation
  regressions closed its initial finding. Main independently ran 31 focused
  idle/HTTP/OAuth/config tests and five native-settlement cases; all passed.
  Package types and all 30 workspace push-hook tasks passed.
- The runtime was rebased onto local primary, fast-forward integrated and
  pushed to both mirrors. The tracked builder installed
  `1.19.0-vt-319-dfb56f76c7`; mandatory v1 guard passed against the built
  binary, npm `opencode-ai@1.19.3` and `@opencode/cli@2.0.31`.
- Installed-binary HTTP proof used four synthetic directories and a 1000 ms
  global idle window: warmed five processes / 665176 KiB aggregate RSS became
  one server / 538100 KiB after five seconds; MCP descendants went from four
  / 267876 KiB to zero. Cleanup verified zero owned processes. Independent
  vt310 baseline retained all four children. Main source-process proof also
  retained an actual asynchronous turn's MCP pair while another pair expired,
  then expired that pair after the turn. Server heap RSS is not a cold-start
  baseline guarantee. Non-secret installed report is in tools scratch
  `serve-instance-proof/run-gyftn0/result.json`.
- Expiry applies to enrolled, unpinned HTTP contexts. Explicit persistent
  `load`/`provide` consumers, including worktree boot and plugin PTY environment
  helpers, remain pinned; no universal directory-expiry claim is made.
- Live `opencode-serve-tailscale.service` was not restarted and retains its
  vt305 inode. The CPU coordinator received installed version and operator
  restart requirements. No default Vibeterm server or Meridian restart occurred.

Weekly audit by `ses_eeda1d251ffel81U5Y42j4kb33`, 2026-10-14:

- The [canonical PR ledger](https://gitlab.com/Nowaker/opencode-tools/-/blob/master/docs/opencode-patches/README.md#upstream-pr-ledger)
  supersedes the older open-PR snapshot. All 19 previously inventoried PRs
  are closed unmerged at the 01:28:31Z-01:29:12Z REST check; 16 closed on
  October 10. Separate references #41247/#53303 remain closed unmerged;
  #46449 remains merged into upstream `v2`, not `dev`.
- Expanded author search at 01:45:27Z returned 62 unique PRs on one complete
  page: 27 open, 35 closed, none merged. All 43 additions have individual
  REST detail evidence; 17 target `v1`, 26 target `dev`. The canonical ledger
  now includes the new home/syntax/paste/runtime and v2 TUI contributions.
  This supersedes the old 19-PR scope, not the closed status of its members.
- Fetched upstream snapshots: `dev` `89e043b6813c` and v1 `dfb56f76c763`.
  No complete behavior equivalence was established for the old 19 PRs by
  bounded source review; newer PRs received state/merge checks, not a full
  behavior-equivalence audit;
  no carried patch was removed. Changed source paths and PR closure alone
  do not establish that a local behavior is redundant.
- Integration source at capture was `193f0da1da`; `e6abfddbcc..dev-nowaker`
  has 320 commits, 276 not reachable from current upstream v1, and upstream
  v1 has zero commits absent from integration. These are commit-set counts
  across rebased history, not counts of new features. The canonical inventory
  reconciles representative behavior groups with session provenance.
- Named recent local branches were checked by ancestry. Known ACP and
  plugin-error prototypes keep their owner-controlled unlanded/local-only
  dispositions. Upstream-specific home, provisional-prompt and click-control
  branch revisions are not classified as lost fork behavior or proven exact
  equivalents. The historical 420-commit appendix was not rewritten.
- This audit changes records only. No runtime patch, build, installed binary,
  active DreamHost tab, default Vibeterm server or Meridian was changed.
  Existing policy questions and the m4max container-search transport blocker
  remain open. The existing weekly snooze is retained without a duplicate.

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
