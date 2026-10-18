---
title: "Story 31.4: Download an attachment"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: '465d4987329254fd27664902a51b8d20cc9f08b2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) lists each attached file with two outline icon buttons, an eye that opens it in a new tab (`disposition: :inline`) and a download arrow (`disposition: :attachment`), then the delete button for those allowed to delete (`app/views/transactions/_attachments.html.erb`); `TransactionAttachmentsController#show` serves `attachment` when the parameter says so and `inline` otherwise. Archant's sheet makes the file name a link that opens it, and its route always answers `Content-Disposition: inline`: a receipt cannot be saved in one click.

**Approach:** `GET /api/transactions/:id/attachments/:attachmentId` takes an optional `disposition` query, `inline` or `attachment`, parsed by Zod; `attachment` sends `Content-Disposition: attachment` with the stored, already cleaned name, through one `contentDisposition(type, filename)` helper that replaces `inlineDisposition`. The sheet's row shows the name as text and, as Sure, an open link (eye, new tab), a download link (arrow, `download` attribute) and, for an administrator, the delete button.

## Boundaries & Constraints

**Always:**
- Both dispositions keep every header the inline file has today: stored type, `Content-Length`, `nosniff`, `Cache-Control: private, no-store`, `X-Frame-Options: DENY` and `attachmentContentSecurityPolicy` (the policy is set by path in `app.ts`, so the query changes nothing there).
- The header's name is the stored one, which `attachmentFileName` cleaned at upload; quotes, backslashes and non-ASCII characters go through the existing ASCII `filename` plus RFC 5987 `filename*` pair.
- A viewer sees and uses open and download, both reads (`GET`), and never the delete button.
- Each icon link has an accessible name naming the file, as the delete button: « Ouvrir « name » », « Télécharger « name » ».

**Never:** no change to upload, deletion, the export route's own header, or the policies; no new dependency; no text label on the buttons beyond their accessible name, as Sure's are icons only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | `GET …/:attachmentId` | 200, `inline; filename=…` | none |
| Open, explicit | `?disposition=inline` | 200, `inline; filename=…` | none |
| Download | `?disposition=attachment` | 200, `attachment; filename="Re_u caf_.pdf"; filename*=UTF-8''Re%C3%A7u%20caf%C3%A9.pdf`, same type, policy and cache headers | none |
| Quotes and accents | stored `l'été "2026".pdf` cleaned to `l'été -2026-.pdf` | ASCII `filename` with `_` for each accent, exact name percent-encoded in `filename*` | none |
| Unknown value | `?disposition=download` | nothing served | `400 VALIDATION_ERROR` |
| Viewer | viewer session, `?disposition=attachment` | 200, the file | none |
| Unknown attachment | `?disposition=attachment` on another transaction's file | nothing served | `404 NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/views/transactions/_attachments.html.erb` (eye link `target: "_blank"`, download link `data: { turbo: false }`, delete `outline_destructive` when `can_delete`), `app/controllers/transaction_attachments_controller.rb#show`.
- `packages/api/src/lib/content-disposition.ts` -- `inlineDisposition(filename)` becomes `contentDisposition(type: "inline" | "attachment", filename)`; spec follows, with an `attachment` case.
- `packages/api/src/schemas/attachments.ts` -- `attachmentFileQuerySchema = z.object({ disposition: z.enum(["inline", "attachment"]).optional() })`.
- `packages/api/src/routes/attachments.ts` -- `GET /:attachmentId` takes `validated("query", attachmentFileQuerySchema)` and passes `disposition ?? "inline"`.
- `packages/api/src/routes/attachments.spec.ts` -- both dispositions with every header, a name with quotes and accents, the refused value, a viewer's download.
- `packages/app/src/hooks/useAttachments.ts` -- `attachmentUrl(transactionId, attachmentId, disposition?)` appends `?disposition=attachment` for the download.
- `packages/app/src/components/TransactionAttachments.tsx` -- `AttachmentItem`: name as text; `Button asChild variant="outline" size="icon-sm"` around an `<a>` with `EyeIcon` (`target="_blank" rel="noreferrer"`) and one with `DownloadIcon` (`download`); delete becomes `outline` with the destructive colour, as Sure's `outline_destructive`.
- `packages/app/src/locales/fr.json` -- `transactions.attachments.open` « Ouvrir « {{name}} » », `transactions.attachments.download` « Télécharger « {{name}} » ».
- `packages/app/e2e/attachments.spec.ts` -- open through « Ouvrir « ticket.png » », download a PDF through « Télécharger « facture.pdf » » and check `suggestedFilename()` and its bytes; `packages/app/e2e/viewer.spec.ts` -- the viewer downloads `ticket.png` and sees no delete.
- Docs: `docs/sure-parity.md` « Attachments » drops « Later. Story 31.4 … download button »; `docs/security-model.md` « Attachments » says a file is served inline or as a download, under the same headers.

## Tasks & Acceptance

**Execution:**
- [x] `lib/content-disposition.spec.ts`, `routes/attachments.spec.ts` -- tests first: the matrix.
- [x] `content-disposition.ts`, `schemas/attachments.ts`, `routes/attachments.ts` -- the disposition.
- [x] `useAttachments.ts`, `TransactionAttachments.tsx`, `fr.json` -- the two buttons.
- [x] `e2e/attachments.spec.ts`, `e2e/viewer.spec.ts` -- open, download a PDF and its name, a viewer's download.
- [x] Docs, story and sprint status to done.

**Acceptance Criteria:**
- Given a transaction with files under « Pièces jointes », when the sheet lists them, then each file shows an open button that opens a new tab and a download button, and the administrator alone a delete button.
- Given the download button, when it is clicked, then the browser saves the file under its cleaned name and the sheet stays open.
- Given `?disposition=attachment`, when the file is requested, then the answer carries `Content-Disposition: attachment` and the same sandboxed policy as the inline answer.

## Spec Change Log

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap, which found no gap).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The e2e downloads would pass without `?disposition=attachment`, since `download` alone saves the file | medium | patch | Both e2e tests check the link's `href` ends with `?disposition=attachment`; Vitest covers the header. |
| 2 | `docs/security-model.md` implies the sandbox still guards a downloaded file | low | patch | The section says a saved file leaves the sandbox and is guarded by the type read from its bytes alone. |
| 3 | Spec `in-review` while sprint status reads `in-progress`, last task unticked | low | reject | Both move to done when the story is finalised, after review. |
| 4 | The refused unknown `disposition` sits in the parity row's « Parity » clause | low | patch | Moved to a « Different. » clause with its reason. |
| 5 | `"inline" \| "attachment"` is written in three places | low | reject | Two packages; the API's schema refuses any third value before `contentDisposition` is reached. |
| 6 | A repeated `disposition` parameter is untested | low | reject | Hono's validator hands a repeated key as an array, which the enum refuses with `400`; no client sends one. |
| 7 | The explicit `?disposition=inline` answer's other headers are not compared | low | patch | `sharedHeaders(explicit)` is compared with the default answer's. |
| 8 | A download after the session expired or the file went elsewhere saves or fails silently (two layers) | low | reject | Rare; the fix would fetch the file into memory, which Sure's plain link does not either; the sheet never navigates away. |
| 9 | « Ouvrir » does not say it opens a new tab; the icons have no tooltip | low | reject | Sure's buttons have neither; each link names its action and file for a screen reader, as the delete button. |
| 10 | No screenshots planned | low | reject | Visual QA runs before the pull request, light and dark, desktop and phone. |
| 11 | An unknown `disposition` on a missing attachment answers `400`, not `404` | false | reject | Validation before lookup is how every Archant route orders it; neither answer serves anything. |

Second pass, `bmad-code-review`: its four layers stopped on a usage limit before reporting, so the diff since the baseline was read once more by hand against the story's acceptance criteria and the matrix.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Every matrix row has a passing test | false | reject | `routes/attachments.spec.ts` covers open, explicit inline, download, quotes and accents, the refused value, another transaction's file and a viewer; `lib/content-disposition.spec.ts` the header. |
| 2 | `attachmentUrl` has a caller that still opens without the parameter | false | reject | Its two callers are the open link, inline by default as the story asks, and the download link. |
| 3 | The story asks Vitest for « the headers » of both dispositions | false | reject | `sharedHeaders` compares type, length, `nosniff`, `X-Frame-Options`, cache and policy across the three answers. |

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure or Archant's conventions:

- The name is plain text, no longer a link, as Sure's `<p>`: the eye button is the one way to open a file, so the row offers each action once.
- An unknown `disposition` is refused with `400 VALIDATION_ERROR` where Sure falls back to inline: every input crossing a boundary is parsed by Zod (`AGENTS.md`), and the interface never sends one.
- The download link carries `download`, the role Sure's `data: { turbo: false }` plays: whatever the answer, the browser saves it and never leaves the sheet and its unsaved edits.
- Sure's buttons have no text; each link gets an accessible name naming the file, as Archant's delete button already has, for a screen reader.
- The delete button takes Sure's outline look with the destructive colour, so the three sit as one group.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
