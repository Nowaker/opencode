<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset=".github/assets/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/assets/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/assets/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@opencode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@opencode/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/release.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation

This fork's `opencode2` requires an explicit `OPENCODE_DB`, for example `export OPENCODE_DB="$HOME/.local/share/opencode/opencode-v2.db"`. It refuses the v1 default `opencode.db`, aliases of that path, databases with the v1 `session`, `message` and `part` tables, and Vibeterm's v1 migration poison before opening the file for writes or applying migrations. `OPENCODE_DB=:memory:` is supported for disposable runs. Use separate config and XDG directories while testing alongside v1.

The fork's servers retain durable event payloads by default, including `serve --stdio`. Set `OPENCODE_EVENTS_PERSIST=0` to keep upstream's sequence-only storage behavior; `1` or `true` explicitly enables persistence.

Derived data, snapshots, logs, cache, state, bin and temporary directories use the `opencode2` application namespace. Select configuration and database paths explicitly with `OPENCODE_CONFIG_DIR` and `OPENCODE_DB`. The one-shot credential import reads `auth.json` from the `opencode2` data directory, so it intentionally does not import v1's file.

`POST /api/session/:sessionID/synthetic` accepts `ignored: true` for a user-only note. It appends immediately without queuing input or waking execution, even with `resume: true`; provider requests and compaction exclude it. Clients display its nonempty description or its text. V1 imports preserve ignored text as these synthetic notes.

The authenticated experimental endpoint `POST /api/experimental/event/replay` accepts `{ event: { id, type, created?, seq, aggregateID, data }, ownerID?, strictOwner?, publish? }`. Use the serialized durable type, for example `session.renamed.1`; `strictOwner` and `publish` default to `true`. Success returns 204, invalid events return 400, and owner or sequence conflicts return 409. Persist events on both peers and copy project/workspace prerequisites before replay; imported history still needs a transfer baseline. This API may change without compatibility guarantees.

`PATCH /api/session/:sessionID` replaces the complete metadata record by default. Set `experimental.metadataMode: "merge"` with `metadata: { vibeterm: { note: "example" } }` to update that key atomically using RFC 7396: objects merge recursively, null deletes a member, and arrays/scalars replace member values. Omitted mode or `"replace"` preserves literal null values and complete replacement. `GET /api/info` advertises support with `capabilities.sessionMetadataMergePatch: true`. Merge reads and event projection share one immediate write transaction, and the existing `session.metadata.updated.1` event retains the complete resulting record for clients and replay. Child/fork inheritance is unchanged. The experimental selector may change without compatibility guarantees.

```bash
# YOLO
curl -fsSL https://opencode.ai/v2/install | bash

# Package managers
npm i -g @opencode/cli@latest      # or bun/pnpm/yarn
brew install anomalyco/tap/opencode-v2 # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-beta              # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run github:anomalyco/opencode  # Nix
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download it from [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-win-x64.exe`     |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
```

#### Installation Directory

The install script installs OpenCode to `$HOME/.opencode/bin`.

### Agents

The native `subagent` tool accepts `fork?: boolean`, `notice?: "each" | "none" | { group: { id: string, index: number, total: number } }`, and `foregroundHandoffMs?: number`. Servers advertise these options as `GET /api/info` -> `capabilities.subagentOptions: true`; server plugins read the same capability at `ctx.app.capabilities?.subagentOptions`.

- `fork: true` starts a new child with a frozen copy of the calling parent's current settled context. It excludes active assistant, shell and compaction messages, retains child ownership and the requested description, and returns only output produced after the child's new prompt. It cannot be combined with `sessionID`; resume that child with `sessionID` and omit `fork`. A fork may use its calling parent's own primary agent, including on resume; ordinary subagent launches still reject primary agents. Empty parent transcripts retain the Session API's empty-fork error.
- `notice: "each"` is the default and preserves ordinary background completion notices. `"none"` suppresses completion notices, including recovered completions after restart.
- A group uses a parent-scoped `id`, a zero-based `index`, and a fixed positive `total`. Every slot must be invoked once. Invocation persists before agent, model, depth and permission checks, so failed launches and cancellations settle their slots. The engine admits one parent notice only after all `total` slots are terminal, including when an earlier child finishes before later slots are invoked. Duplicate slots, changed totals and reuse of a completed group ID are rejected. Uninvoked slots remain pending; plugins receive outstanding groups in `experimental.idle.background` as `{ kind: "subagent-group", sessionID, id, total, pending }`.
- A positive `foregroundHandoffMs` returns a still-running foreground child to background execution after that duration without interrupting it. Zero or omission preserves the usual foreground wait. Completion uses the selected notice policy.

Group state uses transactionally updated native KV records and existing durable Job recovery. The group notification ID persists before launch. Completion first settles slots, then admits the synthetic input using that stable ID, then acknowledges the group. A crash between admission and acknowledgment reuses the same synthetic ID; Session admission deduplicates it. Completed group identities remain until the parent is removed, preventing later invocations from reopening a delivered group.

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
