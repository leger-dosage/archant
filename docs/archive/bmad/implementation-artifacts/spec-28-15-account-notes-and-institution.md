---
title: 'Story 28.15: Account notes and institution'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '968db7d22816898f4ef8ebba6e09f6dd04a642b1'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure stores `institution_name`, `institution_domain` and `notes` on every account, edited in the closed « Détails supplémentaires » disclosure of `accounts/_form.html.erb`, and `accounts/_account.html.erb` shows the institution after « • » beside the name on a wide screen and under it on a phone. `Account#institution_name` falls back to the provider's, so a linked account shows its bank. Archant has none of it.

**Approach:** Add three nullable columns to `accounts`; accept them on `POST` and `PATCH /api/accounts`; return the row's institution with the list and the stored values with the account; add Sure's disclosure to the creation and edit dialogs and the institution to the accounts page's row; carry them in `all.ndjson` as Sure's `Account#as_json` does.

## Boundaries & Constraints

**Always:**
- Columns `institution_name`, `institution_domain`, `notes`, nullable text. Each field is trimmed; blank saves null. Name and domain at most 255 characters, Sure's string columns as `DETAIL_TEXT_MAX_LENGTH`; notes at most 2000, the bound of a transaction's notes (Sure's `text` has none). Longer is refused `400 VALIDATION_ERROR`, field code `too_big`, never cut. No format check on the domain, as Sure.
- `AccountSummary.institutionName` is Sure's reader: the stored name, else the linked bank connection's `institution_name`. `AccountDetail.additionalDetails` holds the stored `{ institutionName, institutionDomain, notes }`, what the form edits.
- Disclosure as Sure's: closed `<details>` « Détails supplémentaires » after the type's fields, holding « Nom de l'institution », « Domaine de l'institution », « Notes » (textarea, 4 rows) with Sure's `fr.yml` placeholders « ex., Banque Populaire », « ex., banquepopulaire.fr », « Stockez des informations supplémentaires comme les numéros de compte, codes de tri, IBAN, numéros de routage, etc. ». A linked account's name placeholder is its bank's name, as `account.provider&.institution_name`; Archant stores no bank domain, so the domain placeholder stays Sure's generic one. It opens on its own when one of its fields is refused.
- In the edit dialog the « Exclure des rapports » switch moves into the disclosure, last, as in Sure's form.
- Row: after the name and the excluded marker, `• {institution}` muted, hidden below `sm`; below `sm`, the institution on its own muted, truncated line after the subtype and « Par défaut » lines. The bullet is hidden from assistive technology.
- Export: each `Account` line of `all.ndjson` adds `institution_name` (the reader's value), `institution_domain` and `notes`, as Sure's `as_json`, which its importer reads back. `accounts.csv` unchanged, as Sure's.

**Never:** no logo fetched from the domain (Brandfetch stays out, security); no institution nor notes in `get_accounts` (Sure's has none); no notes shown outside the form, as Sure; no exclusion switch added to creation (Story 28.16 rebuilds creation in Sure's steps).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create with details | `institutionName: " BNP "`, notes | stored `BNP`, row « • BNP » | none |
| Blank | `institutionName: "  "` | stored null | none |
| Clear | `PATCH { notes: null }` or `""` | null | none |
| Too long | name or domain of 256, notes of 2001 | refused | `400`, `fields: [{ path, code: "too_big" }]` |
| Linked, no name | linked to « Banque Démo » | row « • Banque Démo », form placeholder « Banque Démo » | none |
| Linked, own name | stored « Ma banque » | row « • Ma banque » | none |
| Export | account with the three | `institution_name`, `institution_domain`, `notes` on its line | none |
| Viewer | `PATCH` | refused | `403` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/accounts.ts` -- three columns; migration by `pnpm data generate` (next `0083`), plain `ADD COLUMN`.
- `packages/api/src/services/ledger/accounts.ts:26-60` -- `NewAccountInput` and the `Account` literal take the three.
- `packages/api/src/schemas/accounts.ts` -- shared optional nullable fields on creation (`accountCreationSchema`), `updateAccountSchema` and `accountSettingsFormSchema`; reuse `DETAIL_TEXT_MAX_LENGTH`; `ACCOUNT_NOTES_MAX_LENGTH` local (importing `NOTES_MAX_LENGTH` from `transactions.ts` would close an import cycle).
- `packages/api/src/services/accounts.ts` -- `summarise` takes the bank's name; `listAccounts` reads the bank names once; `getAccount` adds `additionalDetails`; `updateAccount` writes the three.
- `packages/api/src/services/export.ts:860-905` -- `Account` line.
- `packages/api/src/mcp/accounts.ts:51` -- explicit mapping, unchanged.
- `packages/app/src/components/AccountAdditionalDetails.tsx` (new) -- the disclosure, modelled on `LoanDetailsFields.tsx:235` `<details>`; children slot for the edit dialog's switch.
- `packages/app/src/components/CreateAccountDialog.tsx`, `EditAccountDialog.tsx`, `AccountGroups.tsx`, `locales/fr.json`.
- Tests to model on: `routes/accounts.spec.ts` (create, patch, viewer), `services/export.spec.ts`, `e2e/manage-accounts.spec.ts:355` (exclusion switch, now inside the disclosure), `e2e/bank-connections.spec.ts:805` (linked row).
- `docs/sure-parity.md:72`, `docs/security-model.md:95`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/routes/accounts.spec.ts` -- create and patch with the three, trim, blank, clear, each limit, linked fallback in list and detail, viewer; failing first.
- [x] `packages/api/src/services/export.spec.ts` -- the three keys on the `Account` line, the linked fallback; failing first.
- [x] `packages/app/e2e/account-details.spec.ts` (new) -- open « Détails supplémentaires » in creation, fill the three, find « • {institution} » on the row at desktop width and the line under the name at phone width; edit shows the stored values. Update `manage-accounts.spec.ts` for the moved switch.
- [x] `packages/data/schema/accounts.ts`, migration -- data.
- [x] `packages/api/src/services/ledger/accounts.ts`, `schemas/accounts.ts`, `services/accounts.ts`, `services/export.ts` -- server.
- [x] `packages/app/src/components/AccountAdditionalDetails.tsx`, `CreateAccountDialog.tsx`, `EditAccountDialog.tsx`, `AccountGroups.tsx`, `locales/fr.json` -- interface.
- [x] `docs/sure-parity.md`, `docs/security-model.md` -- rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of the open disclosure in both dialogs and of `/accounts` with an institution, light and dark, desktop and phone width, are reviewed against Sure's `accounts/_form.html.erb` and `accounts/_account.html.erb`.

## Implementation Notes

- `drizzle-kit generate` wrote `0083`, renamed `0083_account_details.sql`, three `ADD COLUMN`; no rebuild, so existing accounts read null.
- The new « Nom de l'institution » label made Playwright's `getByLabel("Nom")` ambiguous in both dialogs; those calls in `accounts.spec.ts`, `manage-accounts.spec.ts` and `trades.spec.ts` now pass `exact: true`.
- `trade-decimals.spec.ts` copied today's `accounts` rows into a database stopped before 0080, which has no new column; it now names the columns of that time.
- `testing/sure-preflight.ts` admits the three keys on an `Account` line; `LEFT_OUT` in `services/ledger/export.ts` now says the bank's name leaves on its accounts' lines.
- The bullet is hidden from assistive technology and replaced there by a comma, so the row's link reads « name, institution ».
- Screenshots of both dialogs with the disclosure open and of `/accounts` with institutions, light and dark, at 1440 and 390 px, were reviewed against Sure's `accounts/_form.html.erb` and `accounts/_account.html.erb`.

### Review Findings

- [x] [Review][Patch] The export test never had an account both linked and named, so a reversed fallback would pass [packages/api/src/services/export.spec.ts:833]
- [x] [Review][Patch] `NewAccountInput` said its details arrive trimmed, which the ledger never does [packages/api/src/services/ledger/accounts.ts:36]
- [x] [Review][Defer] The creation dialog's mapping of a server refusal onto the three fields is untested [packages/app/src/components/CreateAccountDialog.tsx:72] — deferred: the form's schema refuses first, so only a server-only refusal reaches it; the edit dialog's test covers the shared component.

Rejected:
- `too_big` against `too_long` for the same 255 bound (low): a transaction's notes already answer `too_big` from Zod; both read « Ce texte est trop long. ».
- `ACCOUNT_NOTES_MAX_LENGTH` copies 2000 (low): importing `NOTES_MAX_LENGTH` closes an import cycle; recorded beside the constant.
- Three `institutionName` fields with three meanings (low): each is typed and commented; renaming the summary's would diverge from Sure's reader name.
- IBANs in notes undocumented (false): the security model's first paragraph says the database and the export hold everything in clear.
- The fallback rule written in three reads (low): one line each, each test-covered.
- Spec and sprint status disagree (false): both are set to done at completion.
- The linked-row e2e reads `textContent` (low): the accessible name is checked in `account-details.spec.ts`.
- The institution shrinks the account name as much as itself (low): a flex item is blockified, so both truncate; a 255-character bank name is not a real case.
- The 0083 snapshot is out of the reviewed diff (false): drizzle-kit wrote it; `pnpm data generate` reports no change.
- An empty bank name renders a lone « • » (false): `bank_connections.institution_name` is `not null` and filled from the provider's parsed name.
- A revoked connection's bank still named (false): Sure's reader names the provider while the account is linked, whatever its state.
- The domain placeholder stays generic for a linked account (false): the frozen intent records it; Archant stores no bank domain.
- Creation's unprefixed ids (low): the dialog's ids are unprefixed already, and one dialog mounts at a time.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The disclosure reopens on a refusal only once: closed again over the same error, it stays closed | low | reject | `open={open \|\| refused}` keeps the prop true, so React does not reopen it; it needs a user to close it over an error and resubmit unchanged, and `LoanDetailsFields` has the same pattern. |
| 2 | The row's link reads « name institution » run together, the bullet hidden | low | patch | The bullet was `aria-hidden` with nothing in its place; a `sr-only` comma now separates them, and the e2e checks the accessible name. |
| 3 | The security model does not say account notes are stored in clear | false | reject | Its first paragraph says the database is a plain SQLite file readable whole; the viewer paragraph now names account notes and institution. |
| 4 | `LEFT_OUT.bank_connections` says the table never leaves while its name now does | low | patch | Its text now says the bank's name leaves on its accounts' lines. |
| 5 | `docs/deployment.md` does not list the three keys | low | reject | The export section lists files, not keys; `docs/sure-parity.md` records what `all.ndjson` carries. |
| 6 | The bank fallback is computed three ways, and the list reads every bank account | low | reject | Each read already had its own query shape; a household has a handful of bank accounts. |
| 7 | `trade-decimals.spec.ts`'s named columns will go stale | false | reject | They are the columns before 0080, a fixed past that no later migration changes. |
| 8 | Spec tracking incomplete and Code Map missing files | low | reject | The fix edits this build's spec; the notes above record the extra files. |
| 9 | Clearing in the edit dialog is not read back, so a dropped `notes` or domain in the `PATCH` would pass | medium | patch | Also the verification-gap finding; the e2e now reopens the dialog and reads « Notes » empty and the domain kept. |
| 10 | No creation-dialog test of a server refusal | low | reject | The creation and edit dialogs share `AccountAdditionalDetails` and the same schema; the edit test covers reopening and the message. |
| 11 | Creation's ids `institutionName`, `notes` lack a prefix | low | reject | The creation dialog's ids are unprefixed already (`name`, `currency`); only one dialog mounts at a time. |
| 12 | The viewer test does not assert the read fields | low | reject | The viewer reads the same `GET` routes with no role branch; the route spec asserts the fields for the administrator. |
| 13 | Length counts UTF-16 units, so emoji count double | low | reject | Every Archant text bound counts the same way; 255 units still holds any real bank name. |
| 14 | The security model says the domain is « stored as typed », but it is trimmed | low | patch | Now « stored and never requested ». |

## Design Notes

Assumptions taken alone, each settled by Sure. The row's institution uses Sure's `Account#institution_name` reader, so a linked account shows its bank without one typed; the form edits the stored value, as Rails' `text_field` reads the attribute before its reader, and shows the bank in the placeholder. The export writes the reader's value, since Sure's `as_json` calls each attribute's reader (`read_attribute_for_serialization` is `send`). Sure bounds none of the three; Archant refuses past Sure's string column width and its own notes bound, so a request cannot store a file. Sure's form holds the exclusion switch in the disclosure, so the edit dialog moves it there.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
