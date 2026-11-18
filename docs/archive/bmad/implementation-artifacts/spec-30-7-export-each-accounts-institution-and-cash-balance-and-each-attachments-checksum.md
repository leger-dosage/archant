---
title: "Story 30.7: Export each account's institution and cash balance, and each attachment's checksum"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: 'dac8f598cdf3fa706d58d73853c22c636ecf186b'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) writes each account whole in `all.ndjson` (`Family::DataExporter`, `account.as_json`), `institution_name` and `cash_balance` among its columns, and lists each attachment in `attachments.json` with Active Storage's `blob.checksum`, the Base64 MD5 digest of its bytes. Story 28.15 (#229) already writes `institution_name`, `institution_domain` and `notes` on Archant's `Account` lines, the typed name falling back to the linked bank's as Sure's `Account#institution_name`. What is left: the `Account` line has no `cash_balance`, and every attachment's `checksum` is `null`.

**Approach:** `exportedAccounts` in `services/ledger/export.ts` reads the account's stored balance row of today, as it does for `balance`, and returns its `cash` beside it; the `Account` line writes it as `cash_balance`, the way the `Balance` lines write `cash`. `exportedAttachments` computes each attachment's checksum from its stored bytes, one file at a time inside the export's read snapshot, so a file saved before this story gets the same digest as one saved after; the bytes themselves still never leave.

## Boundaries & Constraints

**Always:**
- `cash_balance` is a decimal string in the account's currency, from the same balance row as the line's `balance`, so `balance` minus `cash_balance` is the holdings' value that day, as Sure's `update_account_info` takes both from one `Balance`. Before the account's first balance, both are `0.00`, Sure's fallback.
- `checksum` is `createHash("md5").update(bytes).digest("base64")`, Ruby's `Digest::MD5.base64digest`, which Active Storage's `compute_checksum_in_chunks` produces; never `null`.
- Bytes are read one attachment at a time, never all at once; `content` stays in `LEFT_OUT`.
- `institution_name` stays as Story 28.15 built it; no test or code duplicates it.

**Never:** no migration, no stored checksum column, no change to upload, no screen change, no new dependency, no Playwright change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cash account | checking at 1 700 € today | `balance: "1700.00"`, `cash_balance: "1700.00"` | none |
| Investment account with holdings | cash -339.90, holdings 425 | `balance: "85.10"`, `cash_balance: "-339.90"` | none |
| Account before its opening date | no balance row on or before today | `balance: "0.00"`, `cash_balance: "0.00"` | none |
| Known file | bytes `%PDF-1.7 SECRET-CONTENT` | `checksum: "0baBgm6/mF8zDAFCXCV4sw=="`, Sure's value | none |
| Attachment written before the story | row inserted directly, no upload path | same checksum as the uploaded copy of the same bytes | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/balances.ts` -- `balanceWithCashOn`.
- `packages/api/src/services/ledger/export.ts` -- `exportedAccounts` returns each balance with its `cash` through `balanceWithCashOn`; `exportedAttachments` adds `checksum` per row through a sequential read of `content`.
- `packages/api/src/services/export.ts` -- `Account` line `cash_balance`; `attachmentsJson` writes `checksum`; its doc comment.
- `packages/api/src/testing/sure-preflight.ts` -- `Account` accepts `cash_balance`, Sure's importer reading it.
- Tests: `services/ledger/export.spec.ts` (`exportedAccounts` cash, `exportedAttachments` checksum and its missing-row refusal), `services/export.spec.ts` (`Account` lines of a cash account, an investment account with holdings and an account not yet opened; manifest checksums against Ruby's values; an attachment inserted directly beside the same bytes uploaded).
- Docs: `docs/sure-parity.md` « Full data export », `docs/deployment.md` « Exporting your data », `docs/security-model.md` export paragraph, `docs/architecture.md` AD-23.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first: `Account` lines carry `cash_balance` for a cash account, an investment account with holdings and an account not yet opened; the manifest's checksums equal Ruby's `Digest::MD5.base64digest` of the files; an attachment inserted without the upload path has the same checksum.
- [x] `exportedAccounts`, `exportedAttachments`, the two writers, the preflight schema.
- [x] Docs; story and sprint status to done.

**Acceptance Criteria:**
- Given an account, when `all.ndjson` writes its `Account` line, then it carries `institution_name` (Story 28.15) and `cash_balance`, today's balance's cash part.
- Given an attachment, when `attachments.json` lists it, then its `checksum` is the Base64 MD5 of its bytes, never `null`, and no byte of the file is in the archive.
- Given an attachment saved before this story, when the export runs, then its `checksum` equals one saved after it.

## Design Notes

Assumptions taken alone, the owner unavailable, settled by Sure or by Archant's model:

- The checksum is computed at export from the stored bytes, where Active Storage stores it on the blob at upload. The archive is identical; computing it needs no migration and no backfill of files saved before, which a SQL migration could not do (SQLite has no MD5). The cost is reading every file once per export, one at a time inside the read snapshot; an export already reads the whole history and is run by hand.
- `cash_balance` comes from the balance row of today, the one `balance` already uses, not from Sure's latest row by date, which may be a future-dated one: Archant's `Account` line reports today's balance (Story 18.1), and both figures must come from one row for `balance - cash_balance` to be the holdings' value.
- Archant's archive import does not read `cash_balance`: it recomputes every balance from the imported lines, as it already ignores `balance` beyond the opening fallback.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

## Implementation Notes

Decisions taken alone during implementation, the owner unavailable, each settled by Sure or by Archant's model:

- `institution_name` needed nothing: Story 28.15 writes it, typed name first, then the linked bank's, and its test stays as it was.
- `exportedAccounts` reads `balanceWithCashOn`, new beside `balanceOn` in `services/ledger/balances.ts`, so `balance` and its `cash` come from one row as one object.
- `exportedAttachments` hashes each file in sequence through `oneByOne`; `checksumOf` reads `content` by primary key in the export's snapshot, never returns it, and throws rather than hash nothing if the row is gone. `LEFT_OUT`'s reason for `content` now says only its checksum leaves.
- The `Account` schema of `testing/sure-preflight.ts` accepts `cash_balance` as Sure's importer reads it, optional as for the `Balance` line, since it mirrors what Sure accepts, not what Archant writes; the export tests assert the field itself.
- No screen changes, so no visual QA and no Playwright change; `pnpm test:e2e` passes unchanged.

## Review Triage Log

First pass, the one-shot route's Blind Hunter over the WIP commit.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Story and sprint status not done, commit named WIP | false | reject | Both read done in the pull request; the WIP commit is amended. |
| 2 | Ledger spec checks `cash` only where it equals `balance`; Code Map names a ledger checksum test that does not exist | low | patch | Code Map corrected; `services/export.spec.ts` covers an investment account where they differ (85.10 and -339.90) and the not-yet-opened account. |
| 3 | The "saved before" test compares to a constant, not to an upload of the same bytes | low | patch | The test now inserts the old row and uploads the same bytes, and both checksums match Ruby's. |
| 4 | `checksumOf` would hash nothing for a missing row | low | patch (second pass) | Unreachable inside one snapshot, but a reader outside one could lose the row; it now throws, tested with a reader whose bytes come from an older snapshot. |
| 5 | `content` read outside `EXPORTED_COLUMNS` without saying so | low | patch | AD-23 names it as the one column read beyond the allowlist, hashed and never written. |
| 6 | The manifest waits for every file to be hashed | low | reject | `attachments.json` was already built whole; hashing runs at hundreds of MB per second, and an export is run by hand. |
| 7 | `balance` is `Money`, `cash` bare minor units; Sure filters by currency | low | patch (second pass) | `balanceWithCashOn` returns both in one object; one currency per account in Archant (AD-6), so no filter is needed. |
| 8 | Preflight should require `cash_balance` | false | reject | The helper mirrors what Sure accepts; the export tests assert the field. |
| 9 | AD-23 says nothing of the `Account` line's `cash_balance` | low | patch | Sentence added. |
| 10 | The security model does not say what a checksum reveals | low | patch | It says whoever holds the archive can confirm a given file is attached. |
| 11 | The parity row runs Story 30.7 into Story 18.1's clause | low | patch | Its own sentence now. |
| 12 | Deployment does not explain the `0.00` before the opening date | low | patch | Sentence added. |

Second pass, `bmad-code-review` (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor) over the amended commit. The Verification Gap layer found nothing.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Empty-row MD5 in `checksumOf` (three layers) | low | patch | First pass row 4, now patched. |
| 2 | One query per attachment, slow over Turso before `all.ndjson` starts | maybe-false | reject | Would be low if true: an export is run by hand and Turso is not the reference target; the snapshot stream expiry is already in `deferred-work.md`. |
| 3 | `content` read beyond the allowlist is not machine-checked | low | reject | Named in AD-23 and in `LEFT_OUT`; a typed list for one column adds a mechanism for a single case. |
| 4 | Balance conversion duplicated outside `balances.ts`; schema says balances are read only through `balanceOn` | low | patch | `balanceWithCashOn` sits beside `balanceOn`. |
| 5 | Ledger module has no attachment test beside it | low | patch | Two tests added in `services/ledger/export.spec.ts`. |
| 6 | No liability `cash_balance` test | low | reject | A liability holds no security, so `cash` is `balance`, stored with the same sign; the cash account test covers that path. |
| 7 | Preflight `cash_balance` optional | false | reject | First pass row 8. |
| 8 | No round trip proving the importer ignores `cash_balance` | low | reject | `sure-import-plan.ts` reads no `cash_balance`; `sure-import.spec.ts` imports Archant's own export, every `Account` line now carrying it. |
| 9 | The not-yet-opened test relies on the frozen clock | false | reject | The file states the clock at its top: 2026-09-21. |
| 10 | Two « Parity » clauses follow each other | low | reject | Each names its story; merging them would lose which story settled what. |
| 11 | `cash_balance` from today, not Sure's latest row | low | reject | Design Notes: `balance` is today's since Story 18.1, and both must come from one row. |
| 12 | The no-bytes check reads only the manifest | low | patch | The manifest test now checks every file of the archive for the attachment's bytes. |

