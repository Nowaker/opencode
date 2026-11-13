# W12 awaited plugin configuration stage

## Identity and scope

- Workday: 2026-11-11.
- Session: [W12](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e35a0c9d8ffeV0Ic4uhdjveeAc). Coordinator: [v2 coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC). Compat peer: [W10](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e36044b83ffebBXOF2k2Mkmxj1).
- Agent: Hephaestus, `openai/gpt-6.1-sol`, xhigh, Linux. Source: `/home/nowaker/projekty/webapps/opencode`.
- Source worktree: `config-stage`, initially `8c859a94ca013bb2c26782e0f41dc0acaa17b89a`; upstream `v2.2.7` (`fedc6f208a`). Source integration is `v2-nowaker`; records use `config-stage-record` onto `dev-nowaker`.
- Source candidate: `1ab8f38bb4fa707653fb31d55e810d2b582b8f16`, committed November 13. Rebased publication commit and both independently checked mirror tips: `72527fce0c218c39619fd93d8ef78a975529bccb`. Forklog commit: this record's introducing commit.

> GOAL: one fork patch on branch v2-nowaker (currently 8c859a94ca on both remotes; base upstream v2.2.7). Add an activation-owned, AWAITED configuration stage for plugins.

The assignment requires agreement with W10 before coding, capability advertisement, faithful precedence, deterministic reactivation, source checks, both remote pushes, one coordinated desktop native build with the mandatory probe gate, an isolated v1-controller demo, a verdict and exact m4max commands. It initially held m4max builds for a later assigned slot; the coordinator explicitly assigns W12 that slot on November 13 after its desktop install and demo. V2 never uses live state. The primary checkout's retry divergence and `.gitignore` edit are deliberate and remain untouched.

## Feature and API agreement

- [Awaited plugin configuration](../features/2026-11-11-plugin-configuration.md) is the durable customization; its timeline links back here.
- The [native v2 plugin controls](../features/2026-11-10-v2-plugin-controls.md) and [guarded foundation](../features/2026-11-10-v2-foundation.md) remain present in the combined source and both host installations; their timelines link this verification without replacing W1's direct API evidence.
- W10 explicitly accepted `ctx.config.configure(callback)` with mutable native `Config.Info`, Promise/Effect registration variants and capability `pluginConfiguration`, before implementation.
- W10's v1 adapter owns native projection, disabled-tool removal through `tool.transform`, and command execute callbacks through `command.transform`. Unsupported v1 fields remain explicit errors. Command deletions in the native draft must survive post-consumer source expansion.
- Oracle's architecture review required preserving layered source semantics, canonical Config ownership, an explicit activation boundary, awaited native refresh and owner-scoped failure handling. The first source gate rejected managed Console caching, provider alias projection and Promise RPC scope; all three were reproduced with regressions and corrected. The [narrow re-review](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2b329d1affeZ4eITIi5MJzNBm) approves the corrected source with high confidence and an upstreamable verdict.

## Verification already observed

- Unchanged baseline with a clean environment: 53 pass, 0 fail, 172 assertions. The initial invocation inherited a repository-nested `TMPDIR`, discovered ancestor skills/references and failed nine tests; changing the invocation to `env -i` with `TMPDIR` absent restores isolation without editing tests.
- Focused stage/projection plus activation/config/supervisor run: 76 pass, 0 fail, 242 assertions. The first implementation run exposed four existing reload regressions; explicit public config events and raw plugin-admission policy reads were restored in source.
- Follow-up stage, setup-admission, config-reload and supervisor-reload after preserving awaited observers' service context: 27 pass, 0 fail, 95 assertions.
- Canonical root `bun run check` passes all 34 workspace typecheck tasks, with 554 existing lint warnings and no errors. Diagnostics are clean in core, plugin, protocol, server and client. Two client generator runs produce identical artifact hashes.
- `check-test-junk` reports no findings. The auxiliary no-excuse AST checker cannot load the required `typescript/unstable/async` and `typescript/unstable/ast` APIs from this repository's installed compiler packages; no dependency was changed to accommodate it.
- Source CLI proof: `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/w12-proof-YimAoP/result.json`. The plugin observes the loaded provider, renames it to `Configured provider`, adds `added` as `Added by configuration plugin`, creates an isolated session and stops the engine with exit 0.
- Mutation preloads alter only the loaded module in a test subprocess. Projection no-op yields 11 failures; flattening source documents yields four failures including alias and path-origin assertions; accepting late registration fails its sole regression; omitting pass cleanup leaves the old command present and fails one of five cases. Discarding the configured commit gives two assertion failures and one timeout; the timeout is excluded from behavioral proof.
- November 13 resumed-source check: 74 pass, 0 fail, 240 assertions across 10 focused files, including Console configuration, RPC lifetime and alias endpoint preservation. Core typechecking reports no errors in 2,034 files; targeted lint reports no warnings/errors. No broad check ran under the resource limit. Evidence: `/home/nowaker/.local/share/opencode/tool-output/tool_1d4ce12a30012Q7lcYbs41x7Oe`, `tool_1d4cefeb70010st8sJ6rPrFFeV`, `tool_1d4cfb424001bXbSX1354WZWLr`.
- W10 config/provider/model/header/disabled-tool/command acceptance is not run; the coordinator explicitly accepts `source approved, consumer acceptance pending W10` while the parent's re-fire queue owns its adapter completion.

## Delivery, build and demo

- Feature-only rebase onto W1's published `ea2e468b5376f41ec58762b2d12d2cd07fcf35cc` produces `72527fce0c`; `v2-nowaker` advances by local fast-forward and normal pushes to both mirrors. Independent `ls-remote` confirms both tips. The conflicts are capability blocks and generated client types; all W1 keys remain, clients are regenerated and a second generation is a no-op. Integration branches are never rebased or force-pushed.
- Rebased focused integration: 59 pass, 0 fail, 221 assertions across 13 files; core typecheck has zero errors in 2,061 files. Each source push runs the normal lint and all 34 workspace typecheck tasks successfully.
- Damian paused all OMO/v2 work on November 11 at 13:55 UTC because desktop was overloaded. The parent explicitly resumed W12 on November 13. Its queue assigns W1's two source publications and one gated installation first, then W12's feature-only rebase/publication and gated installation. W12 holds no build slot before W1's direct release.
- Desktop: one canonical `GIT_MASTER=1 OPENCODE_SRC=<config-stage> VIBETERM_V2_PROBE=<tools>/vibeterm-v2-probe bash .vibeterm/build.sh --v2` exits 0, including the embedded app and mandatory gate: 12 passed, 0 failed, 0 skipped. Installed `opencode v2.2.7-vt-15-5f76acb125`, inode `49971756`, 240229488 bytes, matches the tested Linux artifact. Gate `/home/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-xsDWXZ`; full build `/home/nowaker/.local/share/opencode/tool-output/tool_1d5054d98001Ie0vCfTtUGq5OI`.
- Desktop before/after preserves v1 inode `49972526`, 198921328 bytes. Protected serve-unit MainPID and monotonic start/active timestamps are identical; the tailnet unit remains inactive and the LAN unit absent/inactive. No runtime restart occurs. Receipts: `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/w12-runtime-{before,after}.json`.
- The [single v1-controller demonstration](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2af0f920ffehJ2FaMuPluSLlb) runs the installed proof exactly once. Its labelled result has `Configured provider`, `Added by configuration plugin`, all six advertised sibling/stage capabilities true, scratch session [ses_e2af06e76ffe2qQLrT282HOIa7](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2af06e76ffe2qQLrT282HOIa7), `passed: true` and `engineExitCode: 0`. That scratch ID belongs to an isolated database; Portal displays the controller. Evidence: `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/w12-proof-HTB41k/result.json`. The controller is closed; no extra socket or child is started.
- W10's November 13 read-only handoff explicitly says its nine-file config bridge remains uncommitted and unverified, with positive config/command runtime rows still `test.todo`; the old mapping command is not acceptance evidence. Its existing checkout is preserved. The coordinator routes its re-fire through the parent's queue and permits the final installed verdict `source approved, consumer acceptance pending W10` if it has not run by then. The frozen-green wrapper remains available until W10 reports.

## m4max assigned installation

After the desktop installation and demo, the coordinator assigns W12 one m4max build from published `72527fce0c`, covering W1's native patches as well. Fresh SSH uses `-o ControlMaster=no -o ControlPath=none`; preflight verifies Bun 1.4.4, Node, Git, Command Line Tools and roughly 163 GiB free. Tools starts on clean `master` and is pulled fast-forward first. Only the `v2-nowaker` source worktree advances; the primary remains on its existing v1 source. The executed source/build steps are:

```sh
export PATH="/opt/homebrew/bin:$PATH"
repo="$HOME/projects/webapps/opencode"
tools_repo="$HOME/projects/nowaker/opencode-tools"
tools="$tools_repo/vibeterm-opencode-client/bin"
test "$(GIT_MASTER=1 git -C "$tools_repo" symbolic-ref --short HEAD)" = master && GIT_MASTER=1 git -C "$tools_repo" pull --ff-only origin master
test "$(GIT_MASTER=1 git -C "$repo" symbolic-ref --short HEAD)" = dev-nowaker && GIT_MASTER=1 git -C "$repo" fetch origin v2-nowaker
tree="$repo/.vibeterm/worktrees/v2-nowaker"
test "$(GIT_MASTER=1 git -C "$tree" symbolic-ref --short HEAD)" = v2-nowaker && GIT_MASTER=1 git -C "$tree" merge --ff-only origin/v2-nowaker
test "$(GIT_MASTER=1 git -C "$tree" rev-parse HEAD)" = 72527fce0c218c39619fd93d8ef78a975529bccb
GIT_MASTER=1 OPENCODE_SRC="$tree" VIBETERM_V2_PROBE="$tools/vibeterm-v2-probe" bash "$repo/.vibeterm/build.sh" --v2
```

The one canonical host-native build exits 0 and installs `opencode v2.2.7-vt-15-5f76acb125`, inode `72631193`, 231521826 bytes. The unchanged mandatory gate passes 12/12 with no skips; report `/Users/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-HpED8M`. Installed bytes equal `cli-darwin-arm64/bin/opencode`; a separate scratch HOME/XDG/config/database/tool/plugin environment returns the installed version. The known stale `Data migration failed` reconnect toast remains on Mac while reconnect and live tab-strip removal pass; this is outside the configuration-stage scope.

V1 retains inode `72414755`, 182209968 bytes. Both deliberate retry edits, `.gitignore`, and the pre-existing `.vibeterm/tmp-build-event-order.log` remain unchanged in the primary checkout; the v2 source status is clean. No deletions, ENOSPC, SSH drops, copied binaries or service restarts occur. Full desktop-side SSH/build/verification output: `/home/nowaker/.local/share/opencode/tool-output/tool_1d514b6f7001nLSbpi5OZ6thQS`; scratch version root `/Users/nowaker/projects/webapps/opencode/.vibeterm/tmp/w12-installed.znRVQD`.
