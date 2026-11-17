# A pause notice that cannot be written never fails its action

## Identity

- Workday: 2026-11-17
- Session: [`ses_e1d8f706fffePfigPdqMDaPxVT`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e1d8f706fffePfigPdqMDaPxVT), for the Meridian coordinator [`ses_fe8a27c6effe6KEx3TRNvOLgUo`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_fe8a27c6effe6KEx3TRNvOLgUo), reported by [`ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC)
- Agent/platform: opencode Sisyphus, `anthropic/claude-opus-5-5` / linux (desktop)
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch: `fix/pause-notice-never-blocks-resume`
- Source result commit: `fix(session): a pause notice that cannot be written never fails its action`
- Feature record: [2026-11-14 session pause](../features/2026-11-14-session-pause.md)
- Vibeterm side: opencode-tools `daf960f` (the restart workers check the turn resumed)

## Defect

The desktop `vibeterm-meridian@dev` restart of 2026-11-17 (`mrr_mwk0zt4o_08cac533`) unpaused 17 sessions; three never went on: [`ses_e295e6a5bffe26sVuR2I7T5GhC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e295e6a5bffe26sVuR2I7T5GhC), [`ses_e2845e4cbffeAqWDJyjuBaYnox`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2845e4cbffeAqWDJyjuBaYnox), [`ses_e2eb0e4deffeqePSkQ0VvG7526`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2eb0e4deffeqePSkQ0VvG7526). Each had stopped at its step boundary at 01:41Z with one deferred tool call. Their tabs had been parked; the restart worker's unpause woke them (processes started 01:57:20Z and 01:57:57Z) and then unpaused through the new process. `SessionPrompt.unpause` held the write lock 15-28s (1180 statements for one), cleared the pause, and then wrote its notice through `prompt()`, whose `chat.message` hook in the Vibeterm spawn plugin (origin stamp, `writeRetiredSessions`) threw `SQLiteError: database is locked` (`err_c8f32ac2`). `notice()` ran under `Effect.orDie`, so the unpause died after the commit: no notice row, no loop, the deferred calls unrun until manual re-prompts at 02:28-02:36Z. The caller's 10s control timeout had read the cleared record back as success.

## Change

- `notice()` logs a failure (`pause notice not written`) and lets pause, unpause and discard finish; an interruption still propagates. A pause whose notice failed is reported as taken, so its caller knows to lift it.

## Validation

- `test/session/pause.test.ts`: new "an unpause whose notice cannot be written still resumes the turn and runs its deferred calls" and "a pause whose notice cannot be written is still reported as taken" fail without the change and pass with it; whole file 37/37.
- `bun typecheck` in `packages/opencode`: exit 0.
