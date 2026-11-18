---
title: 'Story 2.1: Import an OFX file with preview'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: 'eb9b04f043f419c4431e074750198028d52e5eb8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Transactions only enter Archant by hand; the OFX file every French bank exports cannot be loaded, so a month of history means dozens of forms.

**Approach:** Build the file half of the connector port (AD-3) with its first source, `ofx`, and the keyed path of `ledger.ingest` (AD-4, AD-7): upload a file on the account page, see a grouped preview that writes nothing, confirm to write it in one database transaction. Re-importing never duplicates.

## Boundaries & Constraints

**Always:**
- `domain/statement.ts`: `NormalizedTransaction` gains `externalId: string | null`; `ParsedStatement` gains `rejected: { ref; reason: RejectionCode }[]`. `RejectionCode` gains `INVALID_DATE`, `INVALID_AMOUNT`, `MISSING_LABEL`. `balance`, `originalAmount`, `reference` and `pending` wait for Stories 2.2, 2.4 and Epic 10.
- `connectors/` holds `FileSource { id; detect(bytes, fileName); parse(bytes, options) }`, the static `registry.ts`, and `ofx/`. Connectors never import `drizzle-orm` or `services/**` (new oxlint override).
- Decoding: strict UTF-8, fallback `windows-1252`; the OFX `CHARSET:1252` header forces `windows-1252`; a UTF-8 BOM is stripped.
- `ofx-js` 1.1.1 (no dependencies), wrapped: size checked before parsing; a pre-pass closes empty leaf tags (`<MEMO>` then newline); its output parsed by Zod. One bank (`STMTRS`) or card (`CCSTMTRS`) statement per file.
- Line mapping: `FITID` → `externalId`; `DTPOSTED` → its first eight digits as `YYYY-MM-DD` through `domain/provider-date.ts`, never a time zone; `TRNAMT` with `.` or `,` decimal, sign kept (AD-5), converted with the account currency's minor units; currency from `CURDEF`. Label: trimmed `NAME` and `MEMO`, spaces collapsed; one alone if the other is empty, equal, or contains it; otherwise `NAME MEMO`. A line failing a field is rejected with its code and its index as `ref`; the file stays valid.
- Keys (AD-7): `fp:` sha256 of `date|amount|normalised label|occurrence index` among identical triples in the file, plus `ext:<FITID>`. `domain/normalize-label.ts`: lower case, accents stripped, spaces collapsed. Key lookups batched, 500 keys per query.
- Groups: exact key match → already present. Remaining lines paired one-to-one with the account's transaction entries of the same amount at the nearest date within 3 days that carry no `ofx` key → matched, confirming attaches the line's keys and changes nothing else on the entry. Two candidates at the same distance → created with `transactions.possible_duplicate = true`. No candidate → created.
- `imports`: id, account_id, source, file_name, status `previewed` | `confirmed`, content (bytes), options (JSON), preview_digest, counts (JSON), created_at, confirmed_at. `entry_keys` as in AD-7 without `connection_id` (Epic 10 adds it). Both ledger-only in the oxlint list, except `services/imports.ts` creating and purging previewed rows. `ledger.deleteAccount` and `ledger.deleteTransaction` delete the keys first.
- Routes: `POST /api/accounts/:id/imports` (multipart `file`, `bodyLimit` 5 MB) stores a previewed import and returns `{ id, fileName, source, groups }`; `POST /api/imports/:id/preview` re-runs it with new options and stores the new digest; `POST /api/imports/:id/confirm`. Confirm re-runs `ingest` inside the write transaction and throws `409 IMPORT_PREVIEW_STALE` when the digest differs, writing nothing. Confirming a non-previewed import answers `404`. Confirm marks the import `confirmed` with counts in the same transaction. Previewed imports older than 24 hours are purged at server start.
- `dryRun` computes groups without writing. Inserts are chunked (deferred-work.md, Epic 1): a 5,000-line statement must fit SQLite's parameter cap.
- Interface: « Importer » on the account header, `i` in `lib/shortcuts.ts`, « Importer un fichier » in the palette on an account page. `ImportDialog` with steps Fichier and Aperçu, a drop zone and a labelled file input; tabs À créer, Déjà présentes, Rapprochées, Doublons possibles, Rejetées with counts announced to screen readers; confirm « Importer N opérations », N = created + possible duplicates + matched, disabled at zero with « Toutes les opérations de ce fichier sont déjà présentes. ». Stale: « Le compte a changé depuis l'aperçu. Vérifiez avant d'importer. » over the new preview. Invalid file: « Ce fichier n'est pas un relevé OFX lisible. ». Success toast with numbers only; account queries invalidated. Below 768 px: « Disponible sur ordinateur ». The transaction sheet shows « Import OFX du 12 sept. 2026 » for an imported transaction.
- Logs carry the import id, counts and codes only.
- Moving the opening date (decided): the Rejetées tab offers « Avancer la date d'ouverture au … », the day before the earliest `BEFORE_OPENING_DATE` line. It sets `moveOpeningDate` in the import's options through the preview route; the new preview lists those lines under À créer and states the new opening amount. On confirm, in the same transaction, the `opening_anchor` moves to that date and its amount becomes the one that keeps the end-of-day balance of the old opening date unchanged: `old - sum(lines created in (new, old])` for an asset, `old + sum(...)` for a liability (AD-5). Deliberately not Sure's `adjust_opening_anchor_if_needed!`, which keeps the amount and shifts today's balance.
- Fixtures (decided): synthetic, anonymous-by-construction OFX files written for this story, imitating two French banks' published export formats: one OFX 1.0.2 SGML in `windows-1252` with unclosed and empty tags and comma amounts, one OFX 2.x XML in UTF-8. Each file names the bank it imitates in a header comment. Real exports can replace them later without code change.

**Never:**
- No `LEDGERBAL` snapshot (2.2), no CSV or QIF (2.3, 2.4), no Imports tab or revert (2.5), no « Doublon possible » marker in lists nor merge action, no account matching on `ACCTID`, no `csrf()` (Epic 3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Re-import | Same file after confirm | All already present, confirm disabled | — |
| New FITIDs | Bank re-export, same lines, new `FITID`s | Already present through `fp:` | — |
| Twin lines | Two identical lines same day | Both created; both present on re-import | — |
| Manual twin | Manual `-42,90` on the 3rd, file line on the 5th | Matched, keys attached, no new entry | — |
| Tie | Two manual `-10,00` at equal distance | Created, `possible_duplicate` | — |
| Edited after import | Label and amount changed since | Still already present | — |
| Bad line | `TRNAMT` `12,345` in EUR | Rejected `INVALID_AMOUNT`, others parse | — |
| Two statements | File with two `STMTRS` | Nothing written | `400 INVALID_IMPORT_FILE` |
| Too big | 5 MB + 1 byte | Nothing written | `400 INVALID_IMPORT_FILE` |
| Stale | Transaction added between preview and confirm | Nothing written | `409 IMPORT_PREVIEW_STALE` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger.ts` -- `ingest` (L247): step slots already numbered; add keys, matching, `dryRun`, import confirmation, chunked inserts. `IngestSource` (L229) gains `{ importId }`. `accountWithOpeningDate` (L160), `recomputeBalances` (L88, private), `deleteTransaction` (L424), `deleteAccount` (L452).
- `packages/api/src/domain/statement.ts` -- types and `rejectionFor` (L41), runs before key matching.
- `packages/api/src/services/transactions.ts` -- `TransactionSource` (L27) hard-coded `"manual"` in `withSource` (L51); derive from `entry_keys`. `rejectionError` (L59) is the manual mapping, untouched.
- `packages/api/src/lib/errors.ts` -- `ERROR_STATUSES` (L7): add `INVALID_IMPORT_FILE: 400`, `IMPORT_PREVIEW_STALE: 409`. `fr.json` `errors` must match (`web/src/lib/api.ts` L13).
- `packages/api/src/app.ts` -- chained `.route(...)` (L20); keep chaining for `AppType`. `onError` (L42).
- `packages/api/src/index.ts` -- purge previewed imports after `createDb`.
- `packages/data/schema/` -- new `imports.ts`, `entry-keys.ts`, `possible_duplicate` on `transactions.ts`; `check.ts` `inList` for status; `package.json` exports, `types.ts`; migration 0005 via `pnpm data generate`.
- `.oxlintrc.json` (L51–124) -- ledger-only list repeated in the domain override; add `entry-keys`, `imports`; new `connectors/**` override.
- `packages/api/vitest.config.ts` (L13) -- add `src/connectors/**` to 100% thresholds.
- `packages/api/src/testing/temp-database.ts`, `ledger.spec.ts` `setToday`, `app.spec.ts` `app.request` for multipart.
- `packages/web/src/routes/comptes.$accountId.tsx` -- header button (L322–347), `usePageCommands` (L247), `useShortcut` (L273), dialog state pattern (L62, L380).
- `packages/web/src/components/SnapshotDialog.tsx` -- dialog pattern; `TransactionSheet.tsx` L376 source label; `hooks/useInvalidateAccount.ts`; `lib/query-keys.ts`; `ui/tabs.tsx`, `ui/table.tsx`.
- `packages/web/e2e/fixtures.ts` -- `openAccount` (opened 30 days ago), `daysAgo`, `uniqueName`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/normalize-label.spec.ts`, `provider-date.spec.ts`, `keys.spec.ts` -- tests first: normalisation, date extraction, fingerprints and occurrence index, pairing (window, nearest, tie, one-to-one); then the three modules.
- [x] `packages/data/schema/imports.ts`, `entry-keys.ts`, `transactions.ts`, `types.ts`, `package.json`, `drizzle/0005_*` -- tables, flag, migration; `migrate.spec.ts` checks them.
- [x] `packages/api/src/connectors/decode.spec.ts`, `ofx/ofx.spec.ts`, `ofx/fixtures/` -- SGML and XML, empty tags, comma amounts, charset, BOM, bad lines, two statements, oversize, both banks; then `decode.ts`, `ofx/ofx.ts`, `registry.ts`, and `ofx-js` in `packages/api/package.json`.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- every matrix row at ledger level, opening move on an asset and a credit card keeping the old opening date's balance, dry run writes nothing, stale throws and rolls back, 5,000 lines, delete paths with keys.
- [x] `packages/api/src/services/imports.ts`, `routes/imports.ts`, `routes/accounts.ts`, `schemas/imports.ts`, `lib/errors.ts`, `app.ts`, `index.ts`, `app.spec.ts` -- upload, preview, confirm, 400, 404, 409, purge.
- [x] `.oxlintrc.json`, `packages/api/vitest.config.ts` -- boundaries and thresholds.
- [x] `packages/web/src/components/ImportDialog.tsx`, `hooks/useImports.ts`, `lib/shortcuts.ts`, `routes/comptes.$accountId.tsx`, `components/TransactionSheet.tsx`, `locales/fr.json` -- dialog, entry points, source label.
- [x] `packages/web/e2e/import-ofx.spec.ts` -- OFX built in the test with `daysAgo` dates; one test per acceptance criterion below.

**Acceptance Criteria:**
- Given an account and an OFX 1.x or 2.x file, when I upload it with « Importer », then the Aperçu tabs show the counts and nothing is written until I confirm.
- Given the preview, when I confirm, then the transactions appear on the account, the balance moves, and a toast gives the counts.
- Given the same file uploaded again, when the preview opens, then every line is under Déjà présentes and confirm is disabled.
- Given lines on or before the opening date, when the preview opens, then Rejetées lists them and offers to move the opening date; accepting it, then confirming, imports them and leaves the balance of the old opening date unchanged.
- Given a preview, when a transaction is added through the API before I confirm, then the stale message shows over the new preview.
- Given a text file, when I upload it, then the unreadable-file message shows.
- Given the verification gate of `AGENTS.md` and `pnpm test:e2e`, when they run, then every command passes and no tracked file changes.

## Implementation Notes

- Imports write with `origin: "sync"`: no field is locked (AD-10), so later rules may still categorise imported lines.
- The preview response also carries `openingSuggestion` (the date the Rejetées offer names) and `opening` (the moved anchor and its new amount).
- A line the source cannot read is rejected with `line: null`, its `ref` being its position among the file's `STMTTRN`; a line the ledger refuses keeps its date, label and amount, its `ref` being its position in the statement.
- `closeEmptyLeaves` treats a tag as a leaf when the file never closes it. Labels are cut at `LABEL_MAX_LENGTH` (200) by code points. A `FITID` repeated inside one file keys only its first line.
- The transaction source comes from `entry_keys`: a manual entry later matched by an import shows « Import OFX du … ».
- `bodyLimit` is 5 MB + 64 KiB, room for the multipart envelope; the file itself is checked at exactly 5 MB in the service and the connector. `.qfx` (Quicken's OFX) is accepted by name.
- Confirm clears `imports.content`; `createImport` also purges day-old previews, on top of the start-up purge.
- `pairLines` lets the line nearest to a candidate choose first, then amount and date: taken literally, AD-7's "sort by amount then date" gave the only entry of the 3rd to the file's line of the 1st and duplicated the 3rd.
- A 5,000-line import takes about 0.4 s in `ledger.spec.ts`.
- QA on a throwaway database, Chromium 1280 px, light and dark: the Crédit Agricole fixture previews 5 lines under À créer with nothing written, confirm moves the balance from 1 000,00 € to 3 012,98 €, the same file again shows 5 under Déjà présentes with confirm disabled.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge, verification | `services/ledger.ts` `ingest` | Digest ignores the moved opening | low | No route edits the opening balance today, so the drift cannot happen yet; the fix is one more digest input. | patch |
| 2 | blind | `services/imports.ts` confirm | Two tabs on one import confirm the latest options | false | Every upload creates its own import id; one dialog owns it. | |
| 3 | blind, edge | `schemas/imports.ts` | `moveOpeningDate` unbounded, year 1 writes ~740k balance rows | medium | Schema is `z.iso.date()` only; the ledger applies any earlier date. | patch |
| 4 | blind, edge | `services/imports.ts`, `index.ts` | Abandoned previews pile up until restart | medium | Purge runs only at start; a long-lived container keeps every file. | patch |
| 5 | blind | `imports.content` | Confirmed import keeps the raw file with the full account number | medium | Nothing reads it after confirm; AD-14 stores account numbers masked. | patch |
| 6 | blind, edge | `connectors/ofx/ofx.ts` | `CHARSET:ISO-8859-1` and XML `encoding` ignored | low | Only `CHARSET:1252` matched; the fallback hides it unless bytes are valid UTF-8. Direct fix. | patch |
| 7 | blind | `ImportDialog.tsx` Rapprochées | Tab does not show the entry a line pairs with | low | True, not asked by the story; fix adds a lookup and columns. Rejected. | |
| 8 | blind | `ImportDialog.tsx` | Counts live region remounted pre-filled | medium | `role="status"` sits inside the `key={version}` component. | patch |
| 9 | blind | `services/transactions.ts` `withSources` | A matched manual entry shows « Import OFX » | low | True; telling them apart needs a new column. Rejected. `confirmedAt ?? 0` is unreachable: keys are written only at confirm. | |
| 10 | blind | `0005_add_imports.sql` | Source check constraint needs a table rebuild in 2.3 | false | The repo's enumeration convention (check constraint from a const array); drizzle-kit generates the rebuild. | |
| 11 | blind, edge | `services/ledger.ts` `groupLines` | A reused `FITID` marks a new line present | maybe-false | AD-7 treats any key hit as present; needs real exports showing cross-file FITID reuse. | defer |
| 12 | blind | `connectors/file-source.ts`, `ofx.ts` | Connectors import constants from `schemas/` | low | AD-1 draws connectors to domain only; moving the constants crosses AD-15's schema rule too. Rejected. | |
| 13 | blind | `sprint-status.yaml` | Story `in-progress` while spec `in-review` | false | Step 5 syncs the story. | |
| 14 | edge | `connectors/ofx/ofx.ts` | Empty or repeated-field `STMTTRN` refuses the whole file | low | Malformed exports; per-line parsing is a larger change. Rejected. | |
| 15 | edge | `closeEmptyLeaves` | Leaf closed in one place, empty in another | low | SGML exports are consistent per tag; noted by the implementation. Rejected. | |
| 16 | edge | `ofx.ts` `amountOf` | `.50`, `-.99`, `12.500` rejected | low | `AMOUNT_PATTERN` needs a leading digit and at most the currency's decimals. Direct fix. | patch |
| 17 | edge | `ofx.ts` `toLine` | Label cut splits a surrogate pair | low | `slice` counts UTF-16 units. Direct fix. | patch |
| 18 | edge | `services/ledger.ts` | Suggestion 1899-12-31 for a line on 1900-01-01 | low | Needs a bank line dated 1900. Rejected. | |
| 19 | edge | `services/imports.ts` `runPreview` | Preview after a concurrent confirm rewrites a confirmed row | low | Update has no status filter. Direct fix. | patch |
| 20 | edge | `ImportDialog.tsx` | Drop during a pending upload races two uploads | low | No pending guard on drop. Direct fix. | patch |
| 21 | edge | `ImportDialog.tsx` | « déjà présentes » shown when every line is rejected | low | Message keyed on count 0 only. Direct fix. | patch |
| 22 | edge | `fr.json` `openingMoved` | Says today's balance does not change | medium | False when the file has lines after the old opening date. | patch |
| 23 | verification | `ofx.spec.ts`, `app.spec.ts` | Size tests pass without the size check | medium | Zero bytes fail the schema anyway. | patch |
| 24 | verification | `app.spec.ts` | Import source untested on `GET /api/transactions` | medium | Only the account list asserts it. | patch |
| 25 | verification | `ImportDialog.tsx` stale path | Opening move kept after a 409 untested | low | Narrow path; the user can press the offer again. | defer |
| 26 | verification | `index.ts` | Start-up purge untested | low | Entrypoint wiring; #4 adds a tested purge on upload. Rejected. | |

## Design Notes

The digest is a sha256 over the sorted `(group, ref, matched entry id)` triples, stored on the import at every preview; confirm recomputes it inside its `immediate` transaction, so the check and the write cannot race. The ledger marks the import confirmed because the counts must commit with the entries. N in the confirm label counts matched lines: attaching their keys is what makes the next import recognise them. A deleted imported transaction comes back on re-import, as in Sure; Story 2.5's revert is the tool for removing an import.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- `import-ofx.spec.ts` and the existing suite pass.

**Manual checks:**
- Import each fixture on a throwaway database; accented labels readable; light and dark, 1280 and 600 px.
