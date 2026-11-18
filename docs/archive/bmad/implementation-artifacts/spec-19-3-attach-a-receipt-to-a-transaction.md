---
title: 'Story 19.3: Attach a receipt to a transaction'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '1bd4c6ddb1cfabfd969802ae6a01556ff7522586'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A receipt or an invoice lives in a mailbox or a drawer, never beside the transaction it proves, so finding it for a warranty, a refund or a tax return means searching elsewhere.

**Approach:** As Sure's `Transaction has_many_attached :attachments` (`validate_attachments`, `TransactionAttachmentsController`, `transactions/_attachments.html.erb`, `Family::DataExporter#generate_attachments_manifest`, at `14638a7`): up to ten files of 10 MB per transaction, stored as blobs in SQLite, uploaded and deleted from the sheet, served sandboxed, listed in the export without their content. Story 19.3 of `epics.md` is the acceptance contract; the owner delegated every decision, the ones taken alone are marked « Decided ».

## Boundaries & Constraints

**Always:**
- Schema `transaction_attachments` exactly as the story names it; `transaction_id` references `transactions.entry_id` `ON DELETE restrict` (AD-2), indexed; `content_type` checked against `ATTACHMENT_CONTENT_TYPES` (`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`), declared with `MAX_ATTACHMENTS_PER_TRANSACTION = 10` and `MAX_ATTACHMENT_BYTES = 10 MiB` in a new `@archant/data/attachments`.
- Writer (Decided, AD-2): `services/ledger/attachments.ts` alone writes the table, and `.oxlintrc.json` restricts its schema as the other ledger tables. Why: the count and the transaction's existence must be checked in the immediate transaction that inserts, which reads `transactions`; and every ledger delete must delete attachments first. `services/attachments.ts` holds what is not the ledger's: reading the type, cleaning the name. The ledger functions take `{ origin }` as every ledger writer; no balance moves.
- Deletes: `deleteSplitChildren`, `deleteTransactionRows` (so `deleteTransaction`, `editSplit` dropping a child, `unsplitTransaction`, `countMissedSyncs`), `bulkDeleteTransactions`, `revertImport`, `deleteAccount` delete the attachments first in the same transaction, as Sure purges a destroyed child's. `mergeDuplicate` moves the absorbed row's attachments to the survivor, as its taggings (Decided: a merge must never lose a receipt; the cap is checked at upload only).
- Type from the first bytes (Decided: five fixed signatures in a pure `domain/attachment-files.ts`, no dependency): JPEG `FF D8 FF`, PNG's eight bytes, `GIF87a`/`GIF89a`, `RIFF....WEBP`, `%PDF-`. The client's declared type is ignored; the stored type is the one read.
- Name cleaned as Active Storage's `Filename#sanitized`: NFC, `‮ % $ | : ; / < > ? * " \ ` and control characters to `-`, trimmed, at most 255 characters keeping the extension; empty becomes `attachment` (Decided).
- Routes in `routes/attachments.ts`, mounted at `/api/transactions/:id/attachments`: `GET` the list (bounded, unpaginated: `{ id, transactionId, filename, contentType, byteSize, createdAt }[]`, oldest first), `POST` one `file` per request (multipart, Decided: the sheet sends several one after the other), `GET /:attachmentId` the bytes, `DELETE /:attachmentId`. The upload path leaves the 64 KB default in `app.ts` through `except`, and has its own `bodyLimit` of `MAX_ATTACHMENT_BYTES` plus 64 KB.
- Refusals are `VALIDATION_ERROR` on `file`: `attachment_too_large` (body limit or parsed size), `attachment_limit` (an eleventh), `attachment_type` (unknown signature, empty file). An unknown transaction or attachment is `NOT_FOUND`.
- Served with its stored type, `Content-Disposition: inline` with an ASCII `filename` and an RFC 5987 `filename*`, `nosniff`, `Cache-Control: private, no-store`, and `attachmentContentSecurityPolicy` from `lib/content-security-policy.ts`: the app's policy plus `sandbox`, applied by a second `secureHeaders` on that path (the first is `except`ed, since it overwrites a route's headers). Every allowed type is an image or a PDF, so every file opens inline; the « rest download » clause has nothing to apply to (Decided). Chromium shows a PDF under this policy (checked while planning).
- Sheet: « Pièces jointes » section at the end of the form for any saved transaction, parent and child included; each file a link (`target="_blank" rel="noreferrer"`) with its size (`formatFileSize`, base 1024, `fr-FR`), « Ajouter » opening a hidden multiple file input, a delete per file with `ConfirmDialog`. « Ajouter » is disabled at ten. A refusal shows its field message under the list naming the file; other errors a toast. Buttons are `type="button"`; nothing is disabled by a dirty form, since attachments never touch it. The transaction's delete confirmation counts the attachments that go with it (EXPERIENCE.md: state what will be lost).
- Export: `attachments.json` between `rules.csv` and `all.ndjson`, one line of JSON as Sure's: `{ version: 1, binary_included: false, attachments }`, each item `id`, `record_type: "Transaction"`, `record_id` and `entry_id` (both the transaction id, as `sureSplitLine`), `account_id`, `name: "attachments"`, `filename`, `content_type`, `byte_size`, `checksum: null` (Decided: Sure's is Active Storage's MD5, which Archant does not store), `binary_included: false`, `created_at`; sorted by `record_id`, `filename`, `id`. `content` in `LEFT_OUT`.
- Logs never carry a file name.

**Never:** no MCP tool; no thumbnail, preview or drag-and-drop; no attachment moved by split or unsplit; no file content in the export; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Upload | `ticket.png`, PNG bytes, declared `text/plain` | 201, `image/png`, listed with its size |
| Eleventh | ten attached, one more | 400 `file` `attachment_limit` |
| Too large | 12 MB body; 10 MiB + 1 byte file | 400 `file` `attachment_too_large` |
| Wrong type | HTML renamed `.pdf`; empty file | 400 `file` `attachment_type` |
| Name | `../a<b>.pdf` | stored `..-a-b-.pdf` |
| Open | `GET` the file | type, `inline; filename=…`, `nosniff`, CSP with `sandbox` |
| Delete paths | transaction, bulk, revert, account, split edit, unsplit, missed pending | attachments gone in the same transaction |
| Merge | absorbed duplicate with a receipt | receipt on the survivor |
| Export | two attachments | `attachments.json` lists both, no content |

</frozen-after-approval>

## Code Map

- `packages/data/schema/taggings.ts` -- model for the new `schema/transaction-attachments.ts`; `imports.ts:82` `blob("content", { mode: "buffer" })`; `entries.ts` `check`/`inList`; add both modules to `package.json` `exports` and `types.ts`. `pnpm data generate` writes `0043`; `migrate.spec.ts` gets a describe (restrict, check).
- `.oxlintrc.json` -- add `@archant/data/schema/transaction-attachments` to the five `no-restricted-imports` overrides (`api/src/**`, `domain/**`, `connectors/**`, `mcp/**`, `services/imports.ts`).
- `services/ledger/shared.ts:126` `deleteSplitChildren`, `:147` `deleteTransactionRows`; `edits.ts:397` bulk; `import-revert.ts:215` ; `accounts.ts:94` by account subquery before `:128`; `duplicates.ts:45` `absorbEntry` (beside taggings).
- `services/ledger/patch.ts:85` `transactionRow` (existence) or a lighter select; `testing/ledger.ts` helpers (`add`, `importStatement`, `revert`, `openChecking`).
- `app.ts:101` `MAX_BODY_BYTES`, `:339` `secureHeaders`, `:350` body limit `except`; `routes/accounts.ts:69` route-level `bodyLimit` pattern; `lib/validated.ts`; `schemas/imports.ts` (`z.instanceof(File)`), new `schemas/attachments.ts`.
- `lib/content-security-policy.ts` -- `attachmentContentSecurityPolicy`; its spec. New `lib/content-disposition.ts`.
- `lib/errors.ts` -- no new code. `services/transactions.ts:208` hand-built `fields` pattern.
- `services/ledger/export.ts:32` `EXPORTED_COLUMNS`, `:182` `LEFT_OUT`; `services/export.ts:931` `partsOf`, `timestamp`; specs `services/export.spec.ts`, `services/ledger/export.spec.ts`, `routes/export.spec.ts` (file list).
- `testing/app.ts` `useSignedInApp`, `upload` (multipart model), `testing/auth.ts` `encodeForm`.
- App: `components/TransactionForm.tsx` (form 206-377, delete dialog 403-421, `inSplit`), `components/TransactionSplit.tsx` (block pattern), `hooks/useImports.ts:63` (`form: { file }`), `hooks/useTransactions.ts:310` (`useSplit` query pattern), `lib/query-keys.ts:90`, `components/ConfirmDialog.tsx`, `lib/error-toast.ts`, `lib/form-errors.ts` `fieldErrorCode`, `locales/fr.json` `transactions.*`, `errors.fields`.
- E2E: `e2e/fixtures.ts:170` `apiHelpers` (multipart at 263 with `sameOrigin`), `e2e/splits.spec.ts` (`rowButton`, `sheet`), `import-ofx.spec.ts:57` `setInputFiles`.
- Docs: `docs/architecture.md` AD-2, AD-23, map; `docs/sure-parity.md:139,223`; `docs/security-model.md`; `docs/deployment.md` (proxy body size, backups); `AGENTS.md` Deployment CSP sentence.

## Tasks & Acceptance

**Execution:**
- [x] `domain/attachment-files.spec.ts` -- first: each signature, near misses, empty; name cleaning cases. Then `domain/attachment-files.ts`.
- [x] `@archant/data/attachments`, schema, migration, `types.ts`, exports, `migrate.spec.ts`, `.oxlintrc.json`.
- [x] `services/ledger/attachments.spec.ts` -- first: add, list, read, delete, cap, `NOT_FOUND`s, every delete path of the matrix, the merge. Then `services/ledger/attachments.ts` and the delete paths.
- [x] `routes/attachments.spec.ts` -- first: every matrix row over HTTP, headers, CSP of another route unchanged, file name absent from logs. Then `schemas/attachments.ts`, `services/attachments.ts`, `lib/content-disposition.ts`, CSP, `routes/attachments.ts`, `app.ts`.
- [x] Export: `services/export.spec.ts` manifest, `routes/export.spec.ts` file list; then `ledger/export.ts`, `services/export.ts`.
- [x] `e2e/attachments.spec.ts` -- upload and list with size, open in a new tab, delete with confirmation, eleventh and 12 MB refusals shown, a child's own attachments, the delete confirmation's count; fixture `attachFile`.
- [x] App: `lib/file-size.ts` and spec, query key, `hooks/useAttachments.ts`, `components/TransactionAttachments.tsx`, `TransactionForm.tsx`, `fr.json`.
- [x] Docs listed above.

**Acceptance Criteria:**
- Given Story 19.3 of `epics.md`, when it ships, then each criterion holds with this spec's decisions: Playwright for what the interface shows, Vitest for the rest.
- Given `pnpm test`, when it runs, then `services/ledger/**` and `domain/**` stay at 100 % of branches.

## Design Notes

The upload is one file per request so the route's body limit stays one file's size: Sure's multi-file post would need ten times the limit. The ledger checks the cap inside `behavior: "immediate"`, so two concurrent uploads at nine cannot both pass.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, ledger and domain coverage at 100 %
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green

## Implementation Notes

- `services/ledger/attachments.ts` exports `deleteAttachmentsOf` and `moveAttachments`, which every ledger delete path and `absorbEntry` call, so the table keeps one writer; it imports only types from `shared.ts`, and `import/no-cycle` stays quiet.
- No Vitest case races two uploads at nine: the synchronous libSQL driver holds the thread while a second immediate transaction waits on the first's lock, so in-process concurrency deadlocks until the busy timeout. The cap is read inside the immediate transaction that inserts, as the Design Notes say.
- File names are cut at 255 graphemes (`Intl.Segmenter`), so a cut never splits an emoji.
- `attachments.json` keeps the key order of Sure's `attachment_manifest_item`, `entry_id` and `account_id` last, with no trailing newline, as Sure's `to_json`.
- The delete confirmation of a split's parent counts its lines' attachments too, read when the dialog opens.
- `docs/deployment.md` asks a reverse proxy to pass 11 MB bodies: nginx refuses anything over 1 MB by default, which the interface would show as a network error.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| thermo | `content` before `created_at` makes every list and the export walk each blob's overflow chain | medium | SQLite stores a record's columns in order; the reviewer measured 12.4 ms against 0.011 ms for a list of ten 10 MB files | patch: `content` last, `0043` regenerated |
| thermo | A file near 10 MiB may not be served from Turso, whose responses stop at 10 MB | maybe-false | Needs a Turso database to try; libsql-client-ts issue 191 | defer (medium, unverified) |
| blind, edge, thermo | Undoing a split deletes its lines' receipts while the confirmation never says so | medium | `unsplitTransaction` calls `deleteTransactionRows` on the lines; `transactions.split.undoDescription` mentions no file | patch: the confirmation counts them |
| blind, edge, thermo | Removing a line in the split dialog deletes its receipts silently | low | Same path through `editSplit`; counting per removed line in the dialog adds queries and state for a rare, deliberate action | rejected |
| blind, edge, thermo | A pending line the bank never confirms is deleted with its receipts by `countMissedSyncs` | medium | Frozen decision lists that path; the user is never told | patch: a note in the section of a pending transaction |
| blind, edge | Bulk delete, account delete and import revert confirmations do not count attachments | low | Real, but counting needs a new API read per selection; rare actions on transactions holding receipts | rejected |
| blind, edge, thermo | The delete confirmation can be confirmed before its count arrives, and undercounts a parent whose lines are not loaded | low | `goingAttachments` is `null` while loading and the button stays active | patch: pending while unknown, renamed |
| blind, standards, spec | `deleteAttachment` writes outside an immediate transaction | low | AD-2's rule, which the change extends to the table | patch |
| blind | `listAttachments` reads existence and rows in two statements | low | A delete in between answers `[]` or `NOT_FOUND`, both correct | rejected |
| blind, edge, thermo | Bidi controls other than U+202E survive name cleaning | low | `REPLACED` names U+202E only; `security-model.md` claims more | patch |
| edge | `security-model.md` says no shell character survives | low | Backtick, `&`, `!` survive, as in Active Storage | patch: wording |
| blind, thermo | The 255 cap counts graphemes, so combining marks make a header of tens of kilobytes | low | `"a" + "\u0301".repeat(5000)` is 5 graphemes and 10 KB | patch: 255 UTF-8 bytes on grapheme boundaries |
| blind | The « Attachments » section of `security-model.md` captures the next paragraph | low | It sits before the `ENABLE_BANKING_API_URL` paragraph | patch |
| spec | AD-2 lists the table but not why the ledger writes it | medium | The launch brief asked for the reason | patch |
| blind, verification-gap | Nothing proves the route's body limit refuses before reading | medium | Removing `bodyLimit` leaves every test green: the service refuses the same way after reading | patch: a streamed body test |
| verification-gap | The `attachment_type` message is never asserted in the interface | low | No e2e step uploads a wrong type | patch |
| blind, verification-gap, spec, edge, thermo | No automated check opens a PDF under the sandbox; Firefox and Safari unchecked | maybe-false | Chromium shows it (checked by hand); headless shell downloads PDFs; headless Firefox would not start here | defer (medium, unverified) |
| blind | No client check of a file's size before sending it | low | The server refuses with the same message; a second source of truth for one network round | rejected |
| blind | No progress sign while files upload | low | Only a disabled button; ten files over Tailscale take seconds | patch |
| blind, standards | `full` and `attachment_limit` show the same sentence twice; numbers written in the strings | low | Both render after an eleventh refusal; the constants are Sure's and fixed | patch: `full` reworded; numbers kept |
| standards | The confirm button borrows `transactions.delete.action` | low | Keys are by page | patch |
| blind | No troubleshooting section for a proxy cutting an upload | low | AGENTS.md: one section per symptom | patch |
| blind | Backups do not say each pre-migration copy holds every attachment | low | Five copies kept in `backups/` | patch |
| blind | The export's log counts nothing for the manifest | low | A log nicety; no harm named | rejected |
| blind | Spec and sprint status disagree | false | Both reach `done` together before the pull request | rejected |
| blind, thermo | The served bytes are copied once more | low | `new Uint8Array(file.content)`; a direct removal | patch |
| edge | `Content-Length` from `byte_size` may disagree with the blob | false | Both are written from the same bytes in one insert | rejected |
| edge | The manifest is read whole rather than by pages | low | Metadata only, ten per transaction at most; `exportedTransfers` reads whole too | rejected |
| edge | A malformed multipart body answers without a field | low | Only a hand-crafted request reaches it; `app.onError` maps it to `VALIDATION_ERROR` | rejected |
| edge | A merge may leave more than ten files | false | Frozen decision: a merge never loses a receipt, the cap is checked at upload | rejected |
| standards | The refusal is built in two files; the route imports `refusedFile` beside its service call | low | No harm named; the import route throws directly too | rejected |
| standards | `c.req.param("id") ?? ""` four times; `attachmentUrl` built by hand | low | The separate mount loses the param's type; `/api/export` is a plain link too | rejected |
| standards | « Ajouter » has no object | false | The story names the button « Ajouter » | rejected |
