# Predefined Vibeterm spawn titles

- Workday: 2026-11-26 (America/Los_Angeles).
- Source session: [`ses_de4a61d12ffeqAR5jJl0uOu0Je`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_de4a61d12ffeqAR5jJl0uOu0Je). Review: [OpenCode & OMO fork coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv).
- OpenCode branch: `dev-nowaker`, source commits [`52dc7bbc5e2`](https://gitlab.com/vibeterm/opencode/-/commit/52dc7bbc5e2) and [`fcca792c16c`](https://gitlab.com/vibeterm/opencode/-/commit/fcca792c16c), fork base `bac5fbe3db4`. Tools companion: [`c94f9e6`](https://gitlab.com/Nowaker/opencode-tools/-/commit/c94f9e6) on `master`.

## User request

> when vtss submits a prompt with predefined title, make opencode fork not use its own generator to rewrite it.
> before starting, ask opencode & omo fork coordinator on desktop about guidelines you should obey.

## Behavior and verification

- The v1 TUI reads `VIBETERM_INITIAL_SESSION_TITLE` at CLI startup and supplies it only when creating the session for the initial prompt. A named session skips automatic generation. The generated-title write rechecks the current title inside `Session.patch`'s immediate transaction so a newer rename wins without publishing a stale update. Existing default-title recognition is unchanged.
- Tools supplies the title only to the fresh prompted child. Its watcher treats a matching `session.created.1` as proof the title was stored, without rewriting a later rename. Older engines keep the deferred fallback. Vibeterm API already inserts the title before opening a tab, and native v2's independent title pipeline was left unchanged.
- Engine regression: 2 pass and 1 fail before the fix (`E2E Title` overwrote `Manual rename`); 14 pass and 0 fail across the title/session slices with the fix. The source TUI PTY test failed on the default title before the change and passed on the exact title at birth, no title request, and no carryover on new or resumed sessions. TUI suite: 977 pass, 1 skip, 0 fail. `bun typecheck` passed in `packages/opencode` and `packages/tui`.
- Tools: 256 focused tests passed; `bun run typecheck` reported 0 errors across 4 projects. Existing Vibeterm API create and router checks passed 9/9.
- Real `vt-spawn-session` on m2pro, with the candidate source CLI, the companion Tools branch and a loopback provider: exact requested title in the creation event and final session row, 1 chat call and 0 title calls, watcher skipped the fallback. Untitled control made 1 title call. Installed older engine `1.19.5-vt-627-006d837c50`: the titled spawn generated 1 title, then the watcher applied the requested name. Both witnesses removed their owned sockets and processes.
- Upstream adaptation: [queue entry 16](../pr-queue/16-automatic-title-race.md). No upstream PR was filed. The coordinator owns the desktop build/install; the worker verifies a titled spawn afterward. Nothing was installed for these source checks.
