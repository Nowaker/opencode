# Holding - v2 plugin durable session messages

Status: FORK IMPLEMENTATION DELIVERED; HOLDING - not admitted to the ordered filing queue. Filing waits for Damian to clear it and for a free slot; the three-slot cap is full ([#54578](https://github.com/anomalyco/opencode/pull/54578), [#63062](https://github.com/anomalyco/opencode/pull/63062), [#63063](https://github.com/anomalyco/opencode/pull/63063)). No upstream branch has been cut or pushed for this entry, and no PR or issue was opened.

- Upstream target line: `dev`. Fork base: upstream `v2.2.7`, `fedc6f208aa2bd54c1019227214568083f6380ad`.
- Live target check: `dev` at `f91b88efac039856f284979984ac43cd93bce8f5`, `2026-11-13T19:38:20Z` (`git ls-remote`). No latest-base compatibility test or QA is claimed.
- Fork source on `v2-nowaker` (tip `72527fce0c218c39619fd93d8ef78a975529bccb`, both mirrors): `457cab7c5e20795e6b03b9f0b132989fba16adea`. Development branch: `plugin-messages`. The next commit, `398e98d11caadbf20ba9544fcf251a15805e77a0`, is a fork-only database guard fix and is not part of this entry.
- API: Promise and Effect plugins gain `ctx.session.messages(input)`, a projection of the existing message-list pager (`client.message.list` semantics: descending order, limit 50, cursor paging, durable successful tool metadata from before compaction). `context()` stays the compacted model view. Capability `sessionMessages` on `GET /api/info` and `ctx.app.capabilities`. Core owner: `session/message-page.ts`, shared with HTTP.
- Upstream head: none. The commit sits on fork-only commits (`93f790182d`, `84e23092d9`, `d90d41a907`, `691b33c0b3`, `116b7b3b0d`) and the entry 01, 02 and 90 sources; an upstream port must be cut from the live `dev` without them.
- Verification on the fork (owner records): parent native/messages/WAL run 173 pass, 0 fail; installed desktop vt-11 proof recovered todo metadata through durable paging after compaction, with the source message absent from compacted context. Retained in vt-14 and vt-15 (desktop and m4max) after 12/12 gates.
- Evidence: [delivery session record](../sessions/2026-11-13-v2-plugin-controls.md), [feature record](../features/2026-11-10-v2-plugin-controls.md).
- Implementation owner: [W1 ses_e3832b1b0ffe6q98OeUzhgqhjQ](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ), under [v2 coordinator ses_e383ee7faffe6JX8m2EP26dXUC](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC). Holding recorded at the request of [ses_ef8235798ffejGr4sa22eXmVNv](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv).
- Filing order: unassigned; entries 01-05 keep their order.
- Next step, once cleared: cut an upstream-only branch from the live `dev`, port the commit, rerun its focused tests there, check upstream overlap, find or request an issue, and write the full PR body and filing command before admitting the entry.

This file authorizes no implementation changes, upstream writes or route decision.
