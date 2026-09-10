# Watcher EMFILE whole-turn acceptance

## Identity

- Workday: 2026-09-10
- Session: `ses_f76ce0cf6ffejNGTCJyk7ooYc5` (continuation of the 2026-09-09
  workday recorded in [Watcher EMFILE wedge](./2026-09-09-watcher-emfile-wedge.md))
- Agent/platform: `Sisyphus - ultraworker` / `darwin`
- Repository: `/Volumes/projects/webapps/opencode` (macOS checkout of the fork)
- Integration branch: `master-nowaker`
- Development branch(es): none; no source change was made this workday
- Upstream base: `a9a6fad0f` (unchanged)
- Source result commit(s): none. The fix is unchanged at `34aa414cf`.
- Forklog commit: this file's introducing commit

## User requests

> also with fixes on increased number of files opened or whatever that
> mitigates it but i'm sure this can be tested somehow? is that setting maybe
> per user or something, and you could spawn opencode for a test against a user
> with limited resources, to trigger this error? if not, why not provision a vm
> in digitalocean for tests?

> you can't interrupt other opencodes running under ~nowaker

> you should run everything in tmux on that vps. otherwise the most stupidest
> network error here can destroy your work.

> if it was failing every time, how good, or shit, of a test is it? did you
> actually prove anything if you couldn't test the change? be real

> try arch linux if digitalocean has it. then opencode from pacman, and our
> self compile. pacman confirms the issue. self compile with patch confirms the
> fix.

> on my arch i use opencode-bin for precompiled. fyi.

## Goals

- Establish the whole-turn acceptance the previous workday recorded as blocked:
  under real inotify exhaustion, a turn completes and the refusal is logged.
- Establish the same against a compiled binary, and against the
  distribution-packaged binary a user actually installs, rather than inferring
  compiled behaviour from focused harnesses.

## Constraints and non-goals

- nwkr-desktop was unusable as the test host. Exhausting the per-uid budget
  there would wedge the user's own concurrent sessions, which run the unfixed
  binary; the user confirmed those must not be interrupted. That box had also
  since raised `fs.inotify.max_user_instances` to 65536, so exhausting it would
  need tens of thousands of descriptors.
- No credential was copied anywhere. The turn was driven by a local mock
  provider, so nothing on the throwaway host could authenticate to anything.
- All long-running work ran inside a `tmux` session on the VM, at the user's
  instruction, so an ssh interruption could not destroy it.

## Method

Two throwaway DigitalOcean droplets, each provisioned with `doctl` and
destroyed afterwards.

| Host | Image | Kernel | libc | `max_user_instances` | Purpose |
|---|---|---|---|---|---|
| first | `ubuntu-24-04-x64` | 6.8 | 2.39 | 128 | source-tree acceptance |
| second | `digitaloceanai-omarchy` (Arch Linux) | 7.2.3 | 2.44 | 1024 | packaged and compiled acceptance |

Ubuntu was used first and proved insufficient: every compiled binary built
there failed before reaching the watcher, so the compiled path could only be
inferred. Arch was then used because it packages opencode, which supplies a
binary nobody in this session built.

Neither image permits a usable root login - Ubuntu forces an expired-password
change that a non-interactive ssh session cannot perform, and the Arch image
refuses root passwords outright - so cloud-init created an ordinary `runner`
user with `NOPASSWD` sudo on both. The Arch image also requires a registered
SSH key at create time; one was imported as `tmp-opencode-inotify-test` and
deleted at teardown, leaving the pre-existing team key untouched.

Exhausting the budget needed no root and no sysctl change on either host: a
Python loop held instances until `inotify_init1` returned `EMFILE` (124 on
Ubuntu, 1020 on Arch) and released them when the run finished.

A turn needs a provider. A 60-line OpenAI-compatible SSE endpoint on
`127.0.0.1:9099` replies `MOCK-OK` to any request and logs every request it
receives, so "the provider was reached" and "the model replied" are both facts
rather than inferences.

## Results: source tree, Ubuntu

Same host, same pressure, same config, same command; the only variable is
whether `watcher-inotify-preflight.patch` is applied. Run from source at
`a9a6fad0f`, `bun run ./src/index.ts run --pure`, in a fresh git repository:

| Tree | RC | Elapsed | Turn output | Watcher log |
|---|---|---|---|---|
| patched | 0 | 7s / 8s | `MOCK-OK` | `WARN watcher unavailable, continuing without it ... backend=inotify errno=24 code=EMFILE` |
| pristine `a9a6fad0f` | 137 (SIGKILL) | 120s, never returned | none | `INFO watcher backend`, then silence |

Two runs each, both directions reproduced. The wedged run's final log line is
`project copy refresh started`, which is the same last line the reporting
session observed on nwkr-desktop, so the reproduction matches the original
incident rather than merely resembling it.

The warning names `.git`: with `OPENCODE_EXPERIMENTAL_FILEWATCHER` off, the
`.git` subscription is the only one attempted, and it is the one that wedges.

## Results: compiled binaries, Arch

The source-tree result above does not cover what a user installs. On Arch,
`opencode-bin` supplies a precompiled binary built by the package maintainer,
and `bun ./script/build.ts --single` supplies patched and unpatched binaries
built identically to each other. All four runs used the same host, the same
mock provider, the same isolated XDG directories and the same
`opencode run --pure 'say ok'` in a fresh git repository:

| Binary | Pressure | RC | Elapsed | Turn output | Watcher log |
|---|---|---|---|---|---|
| `opencode-bin` 1.18.30, `/usr/bin/opencode` | none | 0 | 7s | `MOCK-OK` | `INFO watcher backend` |
| `opencode-bin` 1.18.30, `/usr/bin/opencode` | exhausted | 137 (SIGKILL) | 120s, never returned | none | `INFO watcher backend`, then silence |
| self-compiled **patched** | none | 0 | 5s | `MOCK-OK` | `INFO watcher backend` |
| self-compiled **patched** | exhausted | 0 | 5s | `MOCK-OK` | `WARN watcher unavailable, continuing without it ... errno=24 code=EMFILE` |
| self-compiled **unpatched** | exhausted | 137 (SIGKILL) | 120s, never returned | none | `INFO watcher backend`, then silence |

Three things follow, each from a measurement rather than an inference:

- The defect is present in the artifact users install. The packaged binary
  wedged, and its last log line is again `project copy refresh started`.
- The fix works in a compiled single-file binary. The `bun:ffi` probe, reached
  through a dynamic `import()`, ran inside `bun build --compile` output and
  emitted the warning that names the errno.
- The difference is the patch, not the build method. Patched and unpatched
  binaries were produced by the same command on the same host minutes apart,
  and only the unpatched one wedged.

Supporting harnesses compiled with `bun build --compile` had already shown the
probe returning `null` with headroom and `{"errno":24,"code":"EMFILE"}` under
exhaustion, both for a static import and for the dynamic import the layer
actually uses. Those are now corroboration rather than the primary evidence.

## Verification

- `bun test test/filesystem/watcher.test.ts test/filesystem/watcher-preflight.test.ts`
  in `packages/core` on Linux - 8 pass, 0 fail. This is the first time the six
  pre-existing watcher tests ran against the real inotify backend; the previous
  workday could only exercise macOS fs-events.
- `bun typecheck` in `packages/core` on Linux - exit 0.
- `git apply` and `git apply -R` of the canonical patch against pristine
  `a9a6fad0f`, twice each, leaving an empty `git status` every time. The patch
  applies and reverses cleanly on a tree that has never carried it.

## Build and install

- Build command: `bun ./script/build.ts --single` on the throwaway VMs only, at
  `OPENCODE_VERSION=1.18.30`, producing patched and unpatched Linux binaries
  used solely for the compiled-binary results above. On Arch this needs
  `nodejs`, `npm` and `node-gyp` installed first: without them `bun install`
  fails on `tree-sitter-powershell`'s `node-gyp-build` preinstall and leaves an
  incomplete `node_modules` that a later `bun install` considers cached, so the
  tree must be wiped and reinstalled rather than repaired in place.
- Installed artifact: unchanged on both real hosts. Nothing was built or
  installed on nwkr-desktop or the macOS checkout.
- Running services: untouched. No unit was restarted.

## Commit provenance

- No source commit. `34aa414cf` and `84b8fcdfe` are unchanged.
- Required trailer: `AI-Session-ID: ses_f76ce0cf6ffejNGTCJyk7ooYc5`

The record cannot contain its own eventual commit hash. Resolve it with:

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-09-10-watcher-emfile-acceptance.md
```

## Resolved during this workday

- Compiled binaries built from `a9a6fad0f` on the Ubuntu 24.04 host failed
  every turn with `TypeError: undefined is not an object (evaluating 'a.name')`,
  raised inside `SystemPrompt.environment` before the watcher was reached, on
  the pristine upstream tree as well as the patched one. That made the Ubuntu
  host useless for compiled-binary acceptance and left the compiled path
  inferred rather than measured. It is an artifact of that host: on Arch, the
  same `bun ./script/build.ts --single` at the same commit produced binaries
  that complete turns normally, and the packaged `opencode-bin` does too. Not
  diagnosed beyond establishing that it does not reproduce elsewhere.

## Unknowns and blocked verification

- Why the Ubuntu 24.04 build produces that `TypeError` is unknown. It was not
  pursued once a host existed where it does not occur, and it affects neither
  the fix nor any artifact in use: `opencode-build/build.sh` output on
  nwkr-desktop runs turns normally.
- The probe-to-subscribe race remains open by design, as recorded in the
  feature. Nothing this workday narrowed or measured it.
- The packaged `opencode-bin` 1.18.30 wedge was observed once. The
  self-compiled unpatched wedge, which is the controlled counterpart, was
  observed once on Arch and twice from source on Ubuntu.
