# Run the shown agent, model, variant, hints, title and MCPs on click

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-click-controls` (fork); `tui-click-controls-pr` (`9f00816eeb` on upstream `dev` `663fbd7573`, the upstream PR head, without the instant-screen part)
- First local commit: `feaf2e5468`
- Current local commit(s): `feaf2e5468`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `663fbd7573` (upstream `dev`)
- Upstream: PR [#53871](https://github.com/anomalyco/opencode/pull/53871) against v1 `dev`, closing issue #48563. opencode-agent[bot] closed it within a minute (v1 takes critical fixes only); it stays open for linking. Comments with the PR link on #48563, #40521 and #13242. **Needs a v2 port later.**

## Original request

Item 25 relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the
user:

> new tui features:
> - clicking on agent, model, variant on the prompt bottom - equivlent to /model or its shortcut etc.
> - clicking on ctrl+p commands - opens command palette
> - clicking on session name - rename
> - clicking on specific mcp on the list in sidebar - toggling it, without bringing up /mcps list
> altogether as one patch/PR.
> - any other ideas? static elements that do nothing but have a clear, reasonable action that it should perform in tui?
> - + equivlent on new session prompt screen

## Goals

- A plain left click runs the command the element's keybind or slash command
  runs:
  - the agent name below the prompt opens `agent.list`;
  - the model and provider open `model.list`;
  - the variant opens `variant.list`;
  - `tab agents` runs `agent.cycle`;
  - `ctrl+p commands` runs `command.palette.show`;
  - the sidebar session title runs `session.rename`.
- A sidebar MCP row connects or disconnects that server with no dialog; its
  dot shows `⋯` until the server answers.
- Two more elements whose action is an existing command: the home footer's
  MCP count and `/status` open `opencode.status`, and the sidebar's
  "Getting started" "Connect provider" row opens `provider.connect`.
- The home and session prompts get the clicks wherever they render,
  including the instant startup screens (`opencode`, `-s`, `-c`).

## Non-goals

- No configurable click actions. The plan in opencode-tools
  `docs/research/2026-10-07-click-actions/README.md` (span grid, bindings,
  per-kind actions) is separate. This patch keeps its rules: selection wins,
  one gesture fires at most one action, nothing runs on hover, and prompt
  caret clicks are untouched.
- No hover feedback: the TUI's other click targets (`/status`, the
  subagent footer buttons, the retry message) have none either.
- Other candidates, which have no unambiguous existing command, are listed in
  the session record for the user to decide.

## Rationale and constraints

- Each click calls `keymap.dispatchCommand`, so the element runs the
  registered command and its enabled/hidden logic; no handler is duplicated.
- The MCP toggle, its status refresh and its in-flight guard move from
  `DialogMcp` into `local.mcp` so the dialog and the sidebar row share one
  implementation. The sidebar section reads `LocalContext` with
  `useContext`, so the slot test harness (which has no local state) still
  renders it.
- Click guard (`ui/click.ts`): a left press and release on the same cell
  that leaves no text selected. It generalizes the sidebar header guard
  (`feature-plugins/sidebar/click.ts` now re-exports it), so drag-to-copy and
  section drag-reorder keep working on the same elements.
- Instant screens: a click is queued, as an early Enter is. The frame
  records the cells of the agent, model, variant, both hints and the session
  title as targets. A same-cell press and release on one stores its command
  in the instant session state and draws it pressed (inverse). The latest
  click wins, and Escape drops it, as it drops a queued submit. The prompt
  claims it with the rest of the handoff and dispatches it once `sync`, the
  model and (for a session) its messages are ready, so the picker shows the
  same values the screen did. Ignoring it would lose an explicit intent the
  user already sees answered by the pressed look.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `feaf2e5468` | 2026-10-07 | Click actions, MCP row toggle, instant-screen click queue, docs | `onClick` in `packages/tui/src/ui/click.ts`; `onClick(...)` spreads in the prompt meta row and status hints of `packages/tui/src/component/prompt/index.tsx`; `startupAction` effect there; `local.mcp.toggle`/`pending` in `packages/tui/src/context/local.tsx`; MCP row in `packages/tui/src/feature-plugins/sidebar/mcp.tsx`; title in `packages/tui/src/routes/session/sidebar.tsx`; `targets`/`targetAt`/`SHORTCUT_COMMANDS` in `packages/tui/src/instant/frame.ts`; `action` in `InstantSession.State` and `Handoff`; "Clickable elements" in `packages/web/src/content/docs/tui.mdx`; `test/ui/click.test.ts`, `test/instant/session.test.ts` |

## Verification

- `bun typecheck` and `bun test --timeout 60000` in `packages/tui` after the
  rebase onto `1ca196f2b2`: 354 pass, 1 skip, 0 fail. PR branch: 197 pass,
  1 skip, 0 fail.
- Manual surface: isolated `XDG_*`, `OPENCODE_DB`, tool/plugin data dirs,
  throwaway tmux socket `oc-tui-click-qa`, an OpenAI-compatible provider
  `qa` with `high`/`low` variants, two local MCP servers (`echo`, and
  `spare` with `enabled: false`), SGR press/release pairs:
  - vanilla `github/dev` `663fbd7573`: clicks on the agent, model, both hints,
    the home MCP count, the sidebar title and both MCP rows opened nothing
    and changed nothing;
  - fork build: Select agent, Select model, Select variant (`high` -> picked
    `low`), Commands, Status, Rename Session (renamed to "Clickable title");
    `tab agents` turned Build into Plan; clicking `spare Disabled` showed
    `⋯ spare` then `spare Connected`, clicking `echo` disconnected it, and
    `/mcps` showed the same states;
  - drags over the model label, the sidebar title, the session ID and an MCP
    row showed "Copied to clipboard" and ran nothing; clicking prompt text
    still placed the caret (`Xhello world`);
  - instant home (`src/boot.ts`): a click on the model during "Loading…" drew
    it inverse and opened Select model ~11 s later, once loaded; instant
    `-s`: a click on the title drew it inverse and opened Rename Session ~16 s
    later.
  - The first drag after startup copies nothing on both vanilla and patched
    builds; later drags copy. On upstream `dev` dragging the sidebar title
    copies nothing at all (only the session ID copies), with or without this
    change.

## Timeline

- 2026-10-07
  [`ses_ee68a7aceffeiGmNH03eS7PU61`](../sessions/2026-10-07-tui-click-controls.md)
  - `feaf2e5468`: land; build and install on desktop and m4max.
  - `9f00816eeb` on `tui-click-controls-pr` (upstream `dev` `663fbd7573`,
    no AI trailers, no instant-screen part); PR #53871.

## Current maintenance notes

- Port to v2 once Vibeterm core runs on v2. Drop the fork commit if PR
  #53871 (or an equivalent) reaches upstream `dev`; the instant-screen part
  stays fork-only with the instant prompt.
- When the click-actions plan is built, these handlers become its built-in
  `command` bindings for those spans.

### Upstream integration checklist

- Confirm the prompt meta row and status hints still spread `onClick`, and
  `local.mcp` still owns the toggle.
- Run `test/ui/click.test.ts`, `test/instant/session.test.ts`,
  `test/plugin/slots.test.tsx` and `bun typecheck` in `packages/tui`.
- Build through `.vibeterm/build.sh`; clicking the model opens Select model.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
