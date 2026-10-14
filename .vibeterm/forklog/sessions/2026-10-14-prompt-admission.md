# Durable async prompt acknowledgement

## Identity

- Workday: 2026-10-14
- Session: `ses_ec6f8faa7ffeQU4hWGG3qv7cSp`
- Parent: `ses_ec701a689ffefMByszLnD0qGry` in opencode-tools
- Agent/platform: Hephaestus / `openai/gpt-6.1-sol`, high / linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch: managed `prompt-admission` from `02b48fd34d`
- Typecheck prerequisite branch: managed `cli-parser-types` from `313bc88cfe`
- Upstream base: `dfb56f76c763` (`github/v1`, `v1.19.0`)
- Source result: `313bc88cfecdec7c862b1006414230a4e5ea9793`
- Forklog commit: this file's introducing commit, unsquashed

## Request and constraints

Parent assignment:

> async prompt endpoint acknowledges only durable user admission and exposes pre-admission errors without waiting for assistant completion, preserving busy-session queueing, noReply and explicit messageID/idempotency semantics.

Parent's final native/Tools/Portal contract:

> {name:"PromptAdmissionError",data:{message:actualcause,possiblyAccepted:false}}

- No Tools or Portal source edits, model-specific validation, original prompt
  replay, unrelated tab restart, global tmux restart or Meridian restart.
- The parent owns recovery of live `ses_fe8a27c6effe6KEx3TRNvOLgUo`.
- Preserve the deliberate uncommitted retry cap and unrelated `.gitignore`.

## Cause and delivered behavior

The handler forked the entire prompt effect and returned 204 before the
`chat.message` hook or user persistence. The reported hook rejection was
`HephaestusRequiresGptError` for a non-GPT profile, with no new user row.
Isolated real HTTP fixtures reproduced false acknowledgement independently.

- Internal admission Deferred is separate from full-turn completion. Normal
  admission succeeds after the user and all parts are saved, before model work.
- Retain the existing owner-scoped worker and full-turn message-ID latch.
- Confirm absence with a scoped raw user-row lookup before returning the
  explicit 400. Preserve the underlying Error message, not a pretty stack.
- A committed user followed by failure remains accepted and reports an async
  session error. Failed reconciliation remains indeterminate, not rejection.
- Rejected concurrent async duplicates stop; no hidden second hook attempt.
- `noReply`, busy different-ID admission, successful duplicate joins and
  synchronous callers retain their existing contracts.

## Commits and review

| Commit | Scope |
|---|---|
| `c8356e7900` | Admission signal and service regressions |
| `a27f434803` | Await admission in HTTP; explicit error and real server tests |
| `423914987f` | Generated SDK error contract |
| `78f558ead8` | Stop rejected duplicate workers; concurrent real HTTP proof |
| `313bc88cfe` | Literal `possiblyAccepted: false` for native Portal safety |
| `cadd78c167` | Include existing TUI parser declarations in CLI typechecks; no runtime change |

Oracle independently found the duplicate retry defect in `423914987f`.
Real HTTP reproduced both callers receiving 400 followed by one stored user.
Oracle cleared `78f558ead8`, then cleared the final seven-line marker delta
at `313bc88cfe`. Review was source-only; main ran all stated validation.
Rebase onto local integration was a no-op; both landings were fast-forward.

## Verification

- Pre-fix `bun test --timeout 60000 test/server/prompt-admission.test.ts`:
  0 pass, 3 fail. Hook rejection received 204, noReply saw `[]`, and a held
  hook was acknowledged while blocked. These were behavioral failures.
- Final source and installed binary: same HTTP suite 5 pass, 0 fail,
  12 assertions: rejection, durable parts, held hook, partial persistence and
  concurrent rejection with zero users after workers become idle.
- `bun test --timeout 60000 test/session/prompt.test.ts
  test/server/httpapi-session.test.ts test/server/httpapi-promptasync-context.test.ts
  test/server/owner-quiescence.test.ts`: 104 pass, 1 existing skip, 0 fail.
- `bun typecheck` in opencode, client and sdk/js: exit 0. Changed source-file
  LSP errors: none; some refreshes timed out before clean results were obtained.
  Markdown diagnostics were unavailable because the daemon timed out;
  forklog links were inspected and `git diff --check` passed.
- SDK generator ran twice; second run left no changes. Client generator had
  no generated delta, since this change is in the legacy instance HttpApi.
- The mandatory pre-push gate exposed pre-existing CLI missing wasm/scm
  declarations. A one-line tsconfig include reuses the TUI declarations;
  CLI typecheck then passed. Both normal push hooks passed all 30 workspace
  typecheck tasks. No hooks were skipped.
- Source through `cadd78c167` pushed to `origin` and `nowaker-github`.
  GitLab reported the repository moved to `vibeterm/opencode`; the existing
  remote still redirects successfully and no git configuration was changed.
- Main personally drove isolated source and installed HTTP servers: exact
  marked 400 with original cause and zero users, then 204 with one stored user.
  Local fake-model execution returned `admission-fixture-ok`, with no spend.
- Parent reported real SDK/control/Tools API acceptance/rejection and keyed
  replay; Portal owner reported source bridge browser QA. These are peer
  reports, not this session's own browser observations.
- Parent reported final installed native HTTP rejection with 400 and zero
  users, and valid headerless 204 with one user. Native browser verdict is
  separate evidence, not inferred from these HTTP results.
- Portal owner `ses_ec70656beffer3CeqFLMk1zx5G` reported final native browser
  QA PASS at `2026-10-14T07:46:46Z`: rejected prompt retained with actual cause
  and Resend/Dismiss controls; valid persisted user plus
  `admission-fixture-ok` assistant; zero runtime exceptions, no mocks or
  browser submissions. The owner released the fixture explicitly.

## Build and install

- Canonical `/home/nowaker/projekty/webapps/opencode-build/build.sh`, with
  `VIBETERM_V2_GUARD` pointing to opencode-tools' installed guard wrapper.
- First build found the guard absent from PATH and installed nothing. The
  explicit guard path fixed invocation; the guard was never skipped.
- Final guard PASSED at `2026-10-14T07:28:57.922Z`, testing built v1 and
  `opencode-ai@1.19.0` against `@opencode/cli@2.0.28`; logical dumps unchanged.
- Desktop binary: `1.19.0-vt-282-dfb56f76c7`, inode `49964673`, 163834992 bytes.
  Source is `313bc88cfe` plus the deliberately uncommitted retry cap.
- Canonical retry patch reverse-check passed; binary contains
  `OPENCODE_RETRY_MAX_HEADER_DELAY_MS`. No retry-cap files committed.
- Protected serve PIDs `1195554` / `1195614` and both start timestamps
  `2026-10-13 17:00:08 CDT` unchanged. Existing processes retain old code.

## Feature and remaining ownership

- [Failed prompt admission and duplicate safety](../features/2026-10-07-tui-prompt-admission.md)
  links back to this session.
- Installed fixture `http://127.0.0.1:40563` was released after native QA;
  task-owned driver `1135352` was gracefully stopped, releasing engine
  `1135783` and fake-model listener. Earlier source and interim installed
  fixtures were stopped as well. No production state was used.
- Installed fixture DB was `run-tJWgVj/data/opencode/opencode.db`; the first
  handoff incorrectly carried the source fixture's `opencode-local.db`
  basename. Parent caught it and main verified the correct directory.
- Live target pickup/recovery belongs to the parent. No live replay claimed.
- Parent reported the original target owner picked up installed vt-282:
  owner PID `1587070`, pane `%17542`, authenticated control status 200.
  This is parent evidence; the pending original prompt was not replayed.
- No m4max installation claimed; the existing authorized-transport blocker
  remains recorded by `qst_13411df28001mxjyIukRVnblcv`.
- No upstream PR opened; the fork's clean-day-live contribution gate remains.
- Required trailer: `AI-Session-ID: ses_ec6f8faa7ffeQU4hWGG3qv7cSp`.
- Provenance correction: source commits recorded `AI-Harness: Vibeterm 30342c4`;
  this session's startup context identifies `Vibeterm 269ff8d`. The forklog
  records the startup value; already-integrated source history is not rewritten.
