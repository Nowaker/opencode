# Let a plugin take a click on the home footer's directory

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/home-directory-click` (cut from `dev-nowaker`; generic, upstreamable candidate, no PR)
- First local commit: `56d05e171b`
- Current local commit(s): `56d05e171b`, merge `b8933da0d6`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

> in opencode new session prompt, as well as in vt prompt draft, allow a click on the project directory, and to open directory finder/switcher, to switch to a different project.

## Goals

- `api.click.onDirectory(handler)`: a plain click on the home screen footer's directory is offered to TUI plugins, newest first, with `{ directory, location: "home_footer" }`; `true` takes it.
- A click no plugin takes copies the path, as before; a host without such a plugin is unchanged.

## Non-goals

- No in-process directory switch: a running TUI stays bound to the directory it started in. Vibeterm replaces the tab (opencode-tools `opencode-vibeterm-route-plugin/project-switch.ts`).
- Only the home footer; the session footer and sidebar directories still only copy.

## Rationale and constraints

- A registration of its own rather than another `kind` on `api.click.on`: the route plugin follows any ID kind it does not recognise, so a new kind there would have been taken by handlers that never asked for it.
- ID and directory handlers share one newest-first list (`createClickHandlers` in `ui/id-click.ts`); the footer reaches the directory handlers through a context provided around the home route.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `56d05e171b` | 2026-11-09 | `onDirectory`, `TuiDirectoryClickEvent` | `TuiClick` in `packages/plugin/src/tui.ts`; `ui/directory-click.ts`; `Directory` in `feature-plugins/home/footer.tsx`; scoped in `plugin/tui/runtime.ts` |
| `56d05e171b` | 2026-11-09 | Tests | `test/ui/directory-click.test.ts`, `test/feature-plugins/home-footer-directory.test.tsx` |
| `56d05e171b` | 2026-11-09 | Docs | `tui.mdx` clickable elements and the plugin paragraph |
| `b8933da0d6` | 2026-11-09 | Fork merge, no conflicts | - |

## Verification

- `bun test` of the two new tests, `test/ui/id-click.test.ts` and `test/routes/home-layout.test.tsx`: 35 pass. `bun run typecheck` in `packages/tui`, `packages/opencode`, `packages/plugin`: clean.
- opencode-tools `project-switch-runtime.test.ts` against the installed `1.19.5-vt-413-006d837c50`: a real click on the footer opens the route plugin's chooser, a query over 1,200 projects reaches the screen at 11.5 ms median, Enter opens a tab in the chosen project holding the prompt and closes the old one.
