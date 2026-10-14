# New-session spawn hang: TUI worker requests lost under Bun 1.4

## Identity

- Workday: 2026-10-13 (continued past midnight)
- Session: `ses_eebf9a83fffeIQQwW9gVFo5jaO`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant max) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `spawn-hang-debug` (throwaway startup-trace
  instrumentation off `dev-nowaker` `02b48fd34d`; never landed)
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`); unchanged
- Source result commit(s): none authored. Integrated and pushed `95113b27bc`
  and `ed5f43340c` from `ses_ec6ba061bffesQBkvfMn0aKona`.
- Forklog commit: this file's introducing commit

## User requests

The coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> Coordinator ses_ef8235798ffejGr4sa22eXmVNv: a LIVE new-session startup hang
> on vt-271, which already contains your 091e060773 fix. Please investigate it
> while the process is still alive.

> 2. Find the cause, and fix it on the branch that introduced it (fork
> regression policy) or as an upstreamable fix on a fresh v1 branch. Reproduce
> through a real new-session start under contention in isolation.

> 4. Usual delivery: dev-nowaker on both remotes, install on desktop and m4max
> with the v2 gate. Report the cause, the commits and try-steps to me.

## Goals

- Explain why a spawned new-session tab (`opencode --agent … --model …
  --prompt <brief> <dir>`) sometimes stays blank forever, and make it start.

## Constraints and non-goals

- Live processes were inspected read-only; the coordinator closed them.
- Isolation: scratch `XDG_*`, `OPENCODE_TOOLS_DATA_DIR`,
  `OPENCODE_PLUGINS_DATA_DIR`, throwaway tmux sockets `spawnhang`,
  `spawnhang2` and `spawnlat`, providers pointed at a closed port.
- No TUI tab, service or Vibeterm tmux server restarted.

## Cause

- The TUI sends its startup requests (`validateSession` for `-s`, the sync
  bootstrap, `checkUpgrade`) to its server worker over `Rpc`, and waits for
  the answers before it draws.
- The worker's static module graph awaits at top level: the data directory
  `mkdir` in `packages/core/src/global.ts`, the migrations' `import()`s and
  `@ff-labs/fff-bun`'s library lookup.
- Bun 1.4.2 and 1.4.3 dispatch a message that reaches a worker during such an
  await before the worker's `Rpc.listen` installs `onmessage`, and drop it.
  Bun 1.3.14 delivers it. The lost request is never answered: a new session
  stays blank, `-s` stays on "Loading session…".
- Fork builds compile with the system Bun: 1.4.2 since 2026-09-29, 1.4.0
  from 2026-08-31. Upstream's release job (`publish.yml` `build-cli`, Ubuntu)
  compiles every target with its pinned Bun 1.3.14, so upstream's v1 binaries
  do not lose these requests.
- `95113b27bc` (`ses_ec6ba061bffesQBkvfMn0aKona`) is the fix: the worker
  announces `rpc.ready` after `Rpc.listen`, and the client queues requests
  until then.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `95113b27bc` (desktop), `1a0c646e37` (remotes) | `ed5f43340c` + this forklog commit | fast-forward to m4max's `ed5f43340c`; pushed to `origin` and `nowaker-github` |
| `opencode` | `spawn-hang-debug` | - | uncommitted instrumentation | throwaway worktree, retired |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Deliver and settle TUI worker requests without startup races](../features/2026-10-12-tui-worker-error-reply.md) | re-verified; cause of the startup race established | live specimens; Bun probes; installed-binary red/green below |

## Other delivered work

- No upstream issue or PR: upstream's release binaries use Bun 1.3.14 and
  are unaffected, upstream `v1` takes critical fixes only (the upstream bot
  closed #54934 as not planned on 2026-10-13), and the forklog submits an
  upstream fix only after a clean day live.
- The `tui.ts` worker-lifetime hunk of `95113b27bc` has no user-visible effect
  upstream: `opencode -s` with a missing or malformed session ID exits 1
  promptly on `vt-275` and `vt-285` alike.
- An interim note to the coordinator wrongly said upstream's Windows builds
  use Bun 1.4.2; only Windows CI jobs do, and the report corrects it.

## Verification

- Live specimens, all `1.19.0-vt-275-dfb56f76c7` (inode `49961877`):
  - new sessions pid `3673949` (`@10028`, 2026-10-13 23:41Z) and `4142227`
    (`@10276`, 2026-10-14 00:00Z): alternate screen on and blank, main thread
    idle in epoll, no route identity, App never mounted. The worker served the
    instance (its log stops at `shell tool using shell`).
  - `-s` pid `160876` (the coordinator's tab, 2026-10-14 07:00Z): "Loading
    session…" for 2.5 h; the worker thread had run 9.5 s of CPU but never
    opened `opencode.db`, so it never handled the TUI's one request.
- Archive scan for the same log signature: 2026-10-04 (run `35113398`),
  2026-10-12 (`22f89ffd`, `725a624f`), 2026-10-13 (`63f25f00`, `2a1d130c`).
- Bun probes in isolation (`tmp/spawn-hang/bunq/`): 5 messages posted right
  after `new Worker()`, then one every 100 ms, to a worker whose dependency
  awaits at top level. Three runs per variant:

  | Dependency await | Bun 1.3.14 | Bun 1.4.2 | Bun 1.4.3 |
  |---|---|---|---|
  | none | 0 lost | 0 lost | 0 lost |
  | 1.5 s timer | 0 lost | 19 of 25 lost, 3/3 runs | 19 of 25 lost, 3/3 runs |
  | `fs.mkdir` | 0 lost | first 5 lost, 2/3 runs | first 5 lost, 3/3 runs |
  | `import()` | 0 lost | first 5 lost, 2/3 runs | first 5 lost, 3/3 runs |

- Static graph scan of the bundled workers: the TUI worker (36 chunks) has
  the three top-level awaits above; the instant-prompt worker has none.
- Natural contention: 277 traced starts of the saved hung argvs with the
  user's sanitized plugin set, Vibeterm's tmux options on the forked tmux, the
  spawn environment and a scratch database write lock held 0.2-3 s at a time,
  at load 37-86: no hang. On a fresh scratch database, 3 of the first 4
  concurrent starts exited with `database is locked` (not investigated).
- Installed binaries with the data directory's `mkdir` delayed by `strace`
  (`tmp/spawn-hang/lat.sh`), state 50-60 s after launch:

  | Start | Delay | `vt-275` | `vt-285` |
  |---|---|---|---|
  | new session (saved hung argv) | 0-300 ms | 9/9 drawn | - |
  | new session | 1000 ms | 1 drawn, 2 blank | - |
  | new session | 3000 ms | 3/3 blank, no database opened | 3/3 drawn |
  | `-s <existing session>` | 0 ms | 3/3 loaded | - |
  | `-s <existing session>` | 100-300 ms | 6/6 on "Loading session…" | 2/2 loaded at 300 ms |

- `bun test test/util/rpc.test.ts` in `packages/opencode` on `ed5f43340c`
  under Bun 1.4.2: 7 pass.
- Pre-push hooks for both remotes: 30 of 30 typecheck tasks.

## Build and install

- Build command: not run by this session.
- Installed artifact: `1.19.0-vt-285-dfb56f76c7`, built and installed by
  `ses_ec6ba061bffesQBkvfMn0aKona` with the v1 database guard gate; checked
  here: desktop inode `49964682` with the `rpc.ready` marker, m4max inode
  `33142512`.
- Running services: not touched.

## Commit provenance

- `95113b27bc`, `ed5f43340c` - authored by `ses_ec6ba061bffesQBkvfMn0aKona`
  on m4max; pushed to both remotes by this session.
- Required trailer: `AI-Session-ID: ses_eebf9a83fffeIQQwW9gVFo5jaO`

## Unknowns and blocked verification

- Which request each live specimen lost is not recoverable after the fact:
  none ran with the startup trace.
- No natural (uninjected) reproduction was obtained.
- Bun 1.4.0, which built the fork's binaries from 2026-08-31 to 2026-09-29,
  was not tested.
- The watcher's "never identified a session" spawns on 2026-08-25 and
  2026-08-26 predate Bun 1.4 and remain unexplained.
- `ses_ec6ba061bffesQBkvfMn0aKona` has no session record of its own: TBD.
