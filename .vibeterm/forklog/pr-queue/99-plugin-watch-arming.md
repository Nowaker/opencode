# Holding - v2 local plugin loads without waiting for source watches

Status: FORK IMPLEMENTATION DELIVERED; HOLDING - not admitted to the ordered filing queue. Queue position: behind cold-submit ([entry 13](13-cold-submit.md)), shift+left ([entry 14](14-prompt-keyboard-selection.md)), W23 (tool-input deltas) and W24 (engine stop), the last two without an entry yet; filed only when one of the three author slots on `anomalyco/opencode` frees and the coordinator clears it. No upstream branch has been cut or pushed, and no PR or issue was opened.

- Upstream target: `dev`. On `github/dev` `d412042beb` (2026-11-18), `packages/plugin/src/source.ts`, `packages/tui/src/plugin/context.tsx`, `packages/tui/test/plugin-source.test.ts` and `packages/core/test/plugin/module.test.ts` are byte-identical to the fork base `73bc224e3b`. `packages/core/src/plugin/module.ts` differs only by the fork's ManagedPolicy line, outside this change's hunk.
- Introduced upstream by `8da7526616` "fix(core): reload local plugin helpers without restarting".
- Fork source on `v2-nowaker`: [`ce18f847e1`](https://github.com/Nowaker/opencode/commit/ce18f847e1cf7dd772fc236aa13723214902b65e), 5 files +115/-16, from branch `plugin-watch-arming`. Gates packet `w25/packet.json` (sha256 `f71da23c…`) settled 2026-11-18T13:48Z; the measurement rows 7a/7b settled 2026-11-18T23:42Z. Installed on desktop as `opencode2` `v2.2.7-vt-44-5f76acb125` (probe 12/0/0), confirmed by the coordinator 2026-11-19T00:51Z; m4max install deferred while it travels.
- Follow-up: W26, one native watch per directory in core `PluginModule.watch` (packet `w26/packet.json` `1d7f847e…`, granted, not yet run).
- Owner: [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ), under [v2 coordinator `ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC).

## Title

`fix(plugin): load local plugins without waiting for their source watches`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

None filed. Found while measuring v2 startup with a large local plugin.

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

`createPluginSources().read` waits for every source watch of a local plugin before it returns, at both ends (`await Promise.all(watching)` before the fingerprint check and `loaded.finally(() => Promise.all(watching))` after the load). Core arms one native watch per file in the plugin's import graph, so the plugin's setup cannot start until every one of them is armed. For a local plugin with about 1,600 graph files on a macOS host with a slow fseventsd, setup started about 68 s after load began. Nothing bounds the wait: the 10 s subscribe timeout covers only the Parcel backend, and file watches go through `fs.watch`.

The wait exists for one reason: an edit made between fingerprinting a file and arming its watch produces no event and would be missed. This change keeps that guarantee without blocking the load:

- `read` returns the load attempt right away and arms watches in the background.
- Once the attempt settles and every watch that read requested has settled, the graph is fingerprinted again. If it no longer matches, and the read is still the entry's current snapshot, a new `changed` callback fires once.
- Core passes its existing `changes` PubSub as `changed`; the TUI passes its existing debounced reconcile.

Reload behavior is otherwise unchanged: unchanged graphs still reuse the cached attempt, and failing modules are still not re-evaluated on every notification.

### How did you verify your code works?

Two new tests in `packages/core/test/plugin/module.test.ts` use a `Watcher.Service` whose subscribe stays pending until the test releases a `Deferred`; neither sleeps or waits on time:

- "activates a local plugin while its source watches are still arming": the plugin loads, activates and runs setup while every watch is held. Before the change, the load never returns.
- "reloads an edit made while source watches were arming once they are armed": an edit made while the watches are held produces exactly one change after release, and the reload returns the new value.

Putting back only the blocking await makes both tests fail again.

Results on the fork: without the change both new tests fail (0/2, by the 30 s per-test timeout, because the load never returns); with it 2/0. Core `test/plugin/module.test.ts` plus `test/plugin/supervisor-reload.test.ts` 19/0, tui `test/plugin-source.test.ts` 61/0, workspace `bun turbo typecheck` 34/34. Restoring only the blocking await fails both new tests again (0/2).

Load of a large local plugin through the real native watcher on a Linux desktop: 4261.2 ms before, 2884.4 ms after, roughly 1.4 s saved. That is one sample each, with the new code run first on a cold file cache (which biases against it), so it is not a benchmark.

### Visual

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="72" viewBox="0 0 240 72" fill="none" stroke="currentColor">
  <style>
    .dot { animation: arm 3s infinite; opacity: .25 }
    .dot:nth-child(2) { animation-delay: .4s } .dot:nth-child(3) { animation-delay: .8s }
    .dot:nth-child(4) { animation-delay: 1.2s } .dot:nth-child(5) { animation-delay: 1.6s }
    .bar { transform-origin: 20px 24px; animation: grow 3s infinite }
    @keyframes arm { 0%, 20% { opacity: .25 } 40%, 100% { opacity: .9 } }
    @keyframes grow { 0% { transform: scaleX(.05) } 30%, 100% { transform: scaleX(1) } }
    @media (prefers-reduced-motion: reduce) { .dot, .bar { animation: none; opacity: .9; transform: none } }
  </style>
  <rect class="bar" x="20" y="18" width="200" height="12" rx="6" fill="currentColor" stroke="none" opacity=".6"/>
  <g fill="currentColor" stroke="none">
    <circle class="dot" cx="40" cy="52" r="5"/>
    <circle class="dot" cx="80" cy="52" r="5"/>
    <circle class="dot" cx="120" cy="52" r="5"/>
    <circle class="dot" cx="160" cy="52" r="5"/>
    <circle class="dot" cx="200" cy="52" r="5"/>
  </g>
</svg>
```

The plugin's setup (bar) runs at once while its source watches (dots) arm in the background.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Before filing

Cut an upstream-only branch from the live `dev`, apply the five-file change, rerun the focused tests there and update the results if they differ, and check that a slot is free and nobody has changed `source.ts` upstream meanwhile.
