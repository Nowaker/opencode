# 13 - Keep a submit pressed while model catalogs load

Status: READY TO FILE, NOT FILED. Damian approved queuing it on [2026-11-26 CST](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1f17844ba001uVrVonrX41LQ9i). The daily PR drain files it after entries 10, 11 and 12 when one of the [three author slots](00-open-slots.md) frees. Recheck upstream `dev` and rerun the regression if the base has moved.

- Target: `anomalyco/opencode:dev`. Branch cut from tag `v2.2.7` (`fedc6f208a`): [`Nowaker:cold-submit-upstream`](https://github.com/Nowaker/opencode/tree/cold-submit-upstream), `34c8882550`, on both fork mirrors. Not merged into `v2-nowaker`.
- Live target check 2026-11-19: `dev` at `88ca792e02` changed `packages/tui/src/component/prompt/index.tsx` since the tag (#63605, #63265, #63262, #63275); the commit applies onto it without conflicts (`git merge-tree --merge-base fedc6f208a github/dev 34c8882550`, clean). Tests have not been rerun on that base.
- Fork source: `24042aa0df` on `v2-nowaker` (cold-submit retention), which builds on fork-only composer pieces; this branch re-derives the fix on the tag's own submit path in two files.
- Owner: [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ), writer [`ses_e13dd719effeDdZZ2WKkYCPE2l`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e13dd719effeDdZZ2WKkYCPE2l), under [v2 coordinator `ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC).

## Title

`fix(tui): keep a submit pressed while model catalogs load`

## Upstream body

<!-- BEGIN PR BODY -->
### Issue for this PR

None filed. Found while starting the TUI on a slow connection.

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

If you type a prompt and press Enter while the TUI is still loading the agent list or the model catalog (a cold start, a slow network or a large provider list), nothing happens: the text stays in the composer, nothing is sent, and nothing says why. You have to notice and press Enter again later.

With this change that Enter is kept. The composer holds it as one pending submit, shows "Waiting for model list..." in the footer, and sends it once everything it needs has loaded, through the normal submit path, after the agent and model it will use are on screen. Pressing Enter again while it waits does not send twice.

The pending submit is dropped, and your text stays in the composer, if you edit the text, pick another agent, model or variant, switch session or location, or the location fails to load (with an error toast). A failed send restores the text as before.

### How did you verify your code works?

New `packages/tui/test/prompt-catalog-enter.test.tsx` drives the real renderer against a loopback server whose catalogs are held until the test releases them, and counts the prompt requests the server receives:

- Before this change: Enter during the load leaves the text in the composer and sends nothing, and after release the prompt is still never sent (red).
- With this change: during the load nothing is sent yet; after release the composer clears and exactly one prompt request arrives (1 pass, 0 fail).

The existing TUI prompt, footer, session-submit, lifecycle and command-selection suites pass (18 files, 134 pass, 0 fail), `bun run typecheck` in `packages/tui` passes, and workspace `bun turbo typecheck` passes (34/34).

### Visual

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="72" viewBox="0 0 240 72" fill="none" stroke="currentColor">
  <style>
    .wait { animation: wait 4s infinite; opacity: .5 }
    .sent { animation: sent 4s infinite; opacity: 0 }
    .text { animation: text 4s infinite; opacity: .9 }
    @keyframes wait { 0%, 55% { opacity: .5 } 65%, 100% { opacity: 0 } }
    @keyframes sent { 0%, 60% { opacity: 0 } 70%, 100% { opacity: .9 } }
    @keyframes text { 0%, 60% { opacity: .9 } 70%, 100% { opacity: 0 } }
    @media (prefers-reduced-motion: reduce) { .wait, .text { animation: none; opacity: .9 } .sent { animation: none; opacity: 0 } }
  </style>
  <rect x="12" y="34" width="216" height="26" rx="4" opacity=".6"/>
  <rect class="text" x="22" y="43" width="110" height="8" rx="2" fill="currentColor" stroke="none"/>
  <text class="wait" x="22" y="26" font-family="monospace" font-size="10" fill="currentColor" stroke="none">Waiting for model list...</text>
  <rect class="sent" x="12" y="8" width="150" height="18" rx="4" fill="currentColor" stroke="none" opacity=".6"/>
</svg>
```

The prompt stays in the composer while the footer says it is waiting, then it is sent once and the composer clears.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR

This PR is AI generated, but under direct supervision and on request of @Nowaker.
<!-- END PR BODY -->

## Evidence

- Red: baseline packet `w22/baseline-packet.json` (`54c54a2d`) on the unfixed tag with the same test bytes (`5b0aa682`, fixture `cbb60ca5`), run by W15 on desktop and accepted by the coordinator 2026-11-19T01:08Z: Enter pressed while the catalogs load leaves the intent in the composer and never admits it.
- Green: fix-port packet `w22/fix-packet.json` (`06bd9c8c`) on desktop: frozen install exit 0, `packages/tui` typecheck exit 0, the test 1/0, the 18 existing TUI suites 134/0, `bun turbo typecheck` 34/34. Read by the coordinator 2026-11-19T01:44Z.

## Before filing

Rebase the branch onto the live `dev`, rerun the new test and the 18 suites there, and update the numbers if they differ. Decide whether the upstream commit keeps its AI trailers: the forklog README says upstream commits stay free of them, while the last filed head (#63897, `d8087e0352`) kept them. Check that a slot is free.
