# Preserve original HEIF attachments in v1 sessions

## Identity

- Workday: 2026-11-21 (source and verification); record backfilled on 2026-11-25.
- Source session: [`ses_e0208d167ffesjNgTxIMc3jQmb`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e0208d167ffesjNgTxIMc3jQmb), GPT-6.2 Sol / Linux desktop. Parent and record session: [`ses_e034a7c8cffehcL8ctEWV3XVfr`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e034a7c8cffehcL8ctEWV3XVfr).
- Repository: `Nowaker/opencode`; integration branch: `dev-nowaker`.
- Development branches: `preserve-heic` from upstream v1 `c618499abc` (version sync for v1.19.6); cherry-picks via `integrate-heic` from fork `5f86d0f260`. The installed fork build's upstream merge-base was `006d837c50` (version sync for v1.19.5).
- Source result: `67040ca8c6`, `2404423cda`; forklog commit: this file's introducing commit.

## User request

> Lol fix it. Heic should be passed as is to the session.
>
> After fixed, tell me how jpgs get submitted. What happens to them at each stage.

## What changed and why

Portal already sent the original HEIC. OpenCode's v1 admission tried to decode it with Photon before saving the message, rejected a valid file, and stored no user message. ImageMagick decoded the same archived bytes, and Photon accepted a JPEG derived from them.

| Commit | Behavior |
|---|---|
| [`67040ca8c6`](https://gitlab.com/Nowaker/opencode/-/commit/67040ca8c667fbbb99f8117cc05b96154089f207) | `packages/opencode/src/image/heif.ts` and `packages/opencode/src/session/message-v2.ts` project a separate bounded JPEG for image-capable models when ImageMagick can convert HEIC/HEIF. User and tool attachments fall back to an explicit no-pixels notice if conversion is unavailable or fails. Raw HEIF does not go to the provider as an image. |
| [`2404423cda`](https://gitlab.com/Nowaker/opencode/-/commit/2404423cdaa52e9aa3c79cb712350490bf579c89) | `packages/opencode/src/image/image.ts` keeps the original HEIC/HEIF data URL, MIME and filename at session admission instead of passing it through Photon. Model projection does not replace the stored original. Ordinary JPEG normalization and corrupt-JPEG rejection are unchanged. |

The [Portal submission trace](https://gitlab.com/vibeterm/portal/-/blob/fc5141bc/ai-analysis-requests/PROMPT_SUBMISSION_STATE_MACHINE.md#image-attachments-on-the-keyed-v1-path) records the separate JPEG stages and measured original versus persisted bytes.

## Verification and original delivery

- Focused `packages/opencode` session prompt and model-projection tests: 3 passed, 11 assertions. Package `bun typecheck` and all 30 workspace push-hook tasks passed at source delivery.
- Isolated v1 HTTP and loopback provider checks, repeated on the installed binary: `POST /session/:id/prompt_async` returned 204; `GET /session/:id/message/:messageID` returned the exact synthetic HEIC bytes, MIME and filename. The provider received a distinct JPEG and the unchanged ordinary JPEG, with no raw HEIC. Corrupt JPEG returned 400 before a message was written. The tool-result test covered the explicit no-pixels fallback.
- Desktop installed `1.19.5-vt-583-006d837c50` from `2404423cda` through the tracked builder; the v1 database guard, retry marker and installed smoke checks passed. Vibeterm confirmed the affected Cronometer tab had loaded that executable after an idle restart. The original failed diary prompt was not replayed; no live provider acceptance claim is made.
- The November 25 backfill changed only forklog documentation; it did not rerun the source tests, rebuild, install or restart any runtime.
