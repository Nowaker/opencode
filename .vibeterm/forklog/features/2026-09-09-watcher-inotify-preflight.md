# Watcher inotify preflight

## Identity

- Status: active
- Integration branch: `dev-nowaker` (`master-nowaker` until 2026-09-22)
- Development branch(es): `watcher-emfile-degrade`
- First local commit: `34aa414cf`
- Current local commit(s): `34aa414cf`
- Upstream base when introduced: `a9a6fad0f` (upstream `dev`, past `v1.18.29`)
- Last checked against upstream: `2406400f0` (upstream `dev`, contains `v1.18.32`)

Authored upstream-first as `84b8fcdfe` on `watcher-emfile-degrade`, based
directly on `a9a6fad0f`, so it can be offered upstream unchanged.
`packages/core/src/filesystem/watcher.ts` was byte-identical between
`a9a6fad0f` and `master-nowaker`, so the cherry-pick was clean.

## Original request

> TASK: Fix a proven opencode defect where an `inotify_init1` EMFILE silently
> wedges every prompt turn forever. Author it as an upstream-quality patch
> against upstream's default branch, then integrate it into `master-nowaker`.

## Goals

- A turn still runs when the kernel refuses an inotify instance.
- The refusal is visible: a warning naming the errno, instead of silence.

## Non-goals

- Narrowing `SystemPrompt.environment` so it stops building a second location
  scope merely to list references. It may be worth doing on its own evidence,
  but it does not protect the first scope and does not belong in this change.
- Eliminating the probe-to-subscribe race. See the constraint below.

## Rationale and constraints

- `@parcel/watcher` builds its shared inotify backend inside the synchronous
  constructor of the N-API `SubscribeRunner`, on whichever thread called
  `subscribe()`. A failing `inotify_init1` throws in
  `InotifyBackend::start()` before `notifyStarted()`, and
  `Backend::handleError()` only notifies watchers already in `mSubscriptions` -
  this one is not registered until `execute()` runs. `Backend::run()` therefore
  waits on `mStartedSignal` forever.
- On opencode that thread is the JS main thread, so the event loop itself
  stops. This is why the pre-existing `Effect.timeout(SUBSCRIBE_TIMEOUT_MS)`,
  the `Effect.catchCause` around the subscription, and the layer-wide
  `Effect.catchCause` never fired, and why double-escape could not interrupt
  the turn.
- `fs.inotify.max_user_instances` is a per-uid ceiling, defaults to 1024, is
  shared with every process the user runs, and cannot be raised without root.
  Exhaustion is therefore not opencode's fault and cannot be designed away.
- Rejected: running `subscribe()` on a worker thread. A thread blocked inside a
  C++ condition-variable wait has no cooperative termination point, so
  `worker.terminate()` cannot be assumed to reclaim it; only a killable
  subprocess would, which is a materially larger architecture.
- Rejected: failing closed when the probe cannot run. That would disable file
  watching for any Node or Electron consumer of `packages/core`, which is a
  functional regression; keeping the previous behaviour there is merely no
  improvement.
- Accepted limitation: another process can still take the last instance between
  the probe and the call. Both live in one synchronous thunk with nothing
  between them, which is as narrow as this side can make the window. Closing it
  needs a fix in `@parcel/watcher` or subprocess isolation.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `34aa414cf` | 2026-09-09 | Probe for an inotify instance before `subscribe()`; skip the watcher with a logged warning when refused | `Watcher.layerWith`, `WatcherInotify.probe` |

Stable seams an upstream bump must inspect:

- `packages/core/src/filesystem/watcher.ts` - the `subscribe` helper must keep
  the probe and `w.subscribe(...)` inside one `Effect.sync` thunk with nothing
  between them, and must keep returning a boolean so the `.git` watcher is
  skipped once the first one is refused.
- `packages/core/src/filesystem/watcher-inotify.ts` - the `bun:ffi` probe.
- `packages/core/test/filesystem/watcher-preflight.test.ts` - the regression.
- `Watcher.node` must remain `nodeWith()`; `layerWith`/`nodeWith` exist only as
  the injection seam the test uses.

## Verification

- `bun typecheck` in `packages/core` - exit 0.
- `bun typecheck` in `packages/opencode` - exit 0.
- `bun test test/filesystem/watcher.test.ts test/filesystem/watcher-preflight.test.ts`
  in `packages/core` - 8 pass, 0 fail. The six pre-existing tests exercise the
  real native binding on macOS fs-events, so the refactor is covered for the
  working path as well as the degraded one.
- Red state confirmed: replacing `const failure = probe?.()` with
  `const failure = undefined` makes the regression fail, reporting that the
  watcher subscribed to both the root and `.git` and logged no warning.
- Manual surface, on nwkr-desktop under real exhaustion (841 inotify instances
  held until `inotify_init1` returned `EMFILE`), against the real
  `@parcel/watcher-linux-x64-glibc` binding: the probe returned `undefined`
  before, `{"errno":24,"code":"EMFILE"}` during, and `undefined` after release;
  an unguarded `subscribe()` printed its "calling" line and never executed the
  next statement, killed at 20s; the guarded path logged the errno and exited 0
  in 0s.
- Whole turn, on a throwaway Linux VM under real exhaustion (124 of that
  image's 128 instances held), driving a mock provider so a turn could complete
  without credentials. Two runs each way:

  | Tree | RC | Elapsed | Turn output | Watcher log |
  |---|---|---|---|---|
  | patched | 0 | 7s / 8s | `MOCK-OK` | `WARN watcher unavailable, continuing without it ... errno=24 code=EMFILE` |
  | pristine `a9a6fad0f` | 137 | 120s, never returned | none | `INFO watcher backend`, then silence |

  The wedged run's last log line is `project copy refresh started`, matching the
  original incident on nwkr-desktop.
- Whole turn, compiled, on Arch Linux under real exhaustion (1020 of that host's
  1024 instances held). This covers the artifact a user installs, which the
  source-tree run above does not:

  | Binary | Pressure | RC | Turn output | Watcher log |
  |---|---|---|---|---|
  | packaged `opencode-bin` 1.18.30 | exhausted | 137 at 120s | none | silence after `INFO watcher backend` |
  | self-compiled patched | exhausted | 0 in 5s | `MOCK-OK` | `WARN watcher unavailable ... errno=24 code=EMFILE` |
  | self-compiled unpatched | exhausted | 137 at 120s | none | silence after `INFO watcher backend` |

  Patched and unpatched binaries came from the same build command on the same
  host, so the delta is the patch rather than the build method, and the warning
  proves the `bun:ffi` probe runs inside `bun build --compile` output.
- `bun test` for both watcher files on Linux - 8 pass, 0 fail, this time against
  the real inotify backend rather than macOS fs-events.

## Timeline

- 2026-09-09 [`ses_f76ce0cf6ffejNGTCJyk7ooYc5`](../sessions/2026-09-09-watcher-emfile-wedge.md) -
  initial build against upstream `a9a6fad0f`, cherry-picked to `master-nowaker`.
  Evidence: `84b8fcdfe`, `34aa414cf`, and the native-boundary table above.
- 2026-09-10 [`ses_f76ce0cf6ffejNGTCJyk7ooYc5`](../sessions/2026-09-10-watcher-emfile-acceptance.md) -
  re-verified, unchanged, on throwaway Linux VMs: whole-turn acceptance under
  real exhaustion from source on Ubuntu, then compiled on Arch, where Arch's
  packaged `opencode-bin` reproduced the wedge and a self-compiled patched
  binary did not. Evidence: both whole-turn tables above, and that session's
  results.
- 2026-09-22 [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-22-dev-nowaker-rebuild.md) -
  replayed unchanged onto upstream `dev` `2406400f0` as `dev-nowaker`; tree equals
  the `master-nowaker` + `dev` merge tree. Evidence: that session's gates.

## Current maintenance notes

- Canonical patch: `docs/opencode-patches/watcher-inotify-preflight.patch` in
  the `opencode-tools` repository, recorded in `e668ee37`. Unlike the
  retry-header cap this customization is committed, so an upstream merge keeps
  it without re-application; the patch exists for replay onto a clean upstream
  branch.
- If upstream accepts the change, mark this feature superseded rather than
  reverting it locally.
- The probe depends on `bun:ffi`. An upstream bump that moves `packages/core`
  off Bun would silently disable the probe - the import failure is swallowed by
  design - so check that `watcher-inotify.ts` still loads if the runtime
  changes. Verified on 2026-09-10 that both `bun:ffi` and the dynamic
  `import()` survive `bun build --compile`, which is the form opencode ships;
  re-check that after a Bun major bump, since a silent loss looks exactly like
  a healthy machine until the kernel refuses an instance.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Confirm the probe and `w.subscribe(...)` still share one synchronous thunk.
- Run the feature's focused tests and affected package typechecks.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.
