# TUI transcript text clicks

## Scope

- Workday: 2026-11-21; session: [`ses_dfed6cbf8ffeMc348W81QcJloM`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_dfed6cbf8ffeMc348W81QcJloM).
- Make local `ile:///` references usable in Vibeterm's live OpenCode transcript without teaching the fork to parse or open file URIs. No upstream PR was requested. The [feature record](../features/2026-11-21-tui-transcript-text-clicks.md) owns the six exact source SHAs and changes. v1 landed from `chat-text-click-v1` on `dev-nowaker`; native v2 landed from `chat-text-click-v2` on `v2-nowaker`. The Vibeterm consumer landed separately at [`3acd528f149`](https://gitlab.com/Nowaker/opencode-tools/-/commit/3acd528f149).

## Verification

- Renderer regressions: 30/30 repeated runs on each engine; adjacent suites 20/20 v1 and 12/12 v2. Removing logical-line recovery broke the wrapped bare-link test; removing cell validation reproduced the incorrect fallback column. The explicit href, drag, modifier, and unclaimed row paths were also exercised. TUI/plugin typechecks passed on both lines, and `packages/opencode` passed on v1.
- Desktop installed-binary evidence: `1.19.5-vt-586-006d837c50` passed the mandatory v1 migration guard; `2.2.7-vt-55-5f76acb125` passed all 13 native install probes. The [stabilized tmux fixture](https://gitlab.com/Nowaker/opencode-tools/-/commit/c97c0719fa8) passed 8/8 runs on those binaries, four per engine, opening an isolated file preview at its requested line. The early PTY fixture could click a stale row during startup; wrapped-hit coverage comes from the renderer regression, not a claim of repeated narrow-width PTY success. Existing v1 ID-click behavior passed on the before/after binaries after one initial timeout.
- m4max follow-through: the retained `1.19.5-vt-597-006d837c50` matched the [original guarded install receipt](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e03bdb239ffeB4Vkb8SrksAHjA) for `936fbe45d2`, contains the v1 fix, and passed the isolated tmux witness. The canonical build log records v2 `2.2.7-vt-55-5f76acb125` installed from `2c000ae41b` at inode `160748415` after 13/13 native probes; no separate post-install Mac v2 file-preview receipt was recorded. Pre-install managed `cli.json` inspection found the handler present, current and not hand-edited, with v2 opt-in off. No live tab or protected service was restarted by this rollout.
- November 25 audit coverage was a record transfer and source ancestry check only; no new runtime test, build, deployment or config change was performed.
