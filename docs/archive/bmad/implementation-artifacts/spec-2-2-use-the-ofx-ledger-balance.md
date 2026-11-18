---
title: 'Story 2.2: Use the OFX ledger balance'
type: 'feature'
created: '2026-09-22'
baseline_commit: 'a0b5f82d4deb69cedb1c2807d8d7730026f90f73'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An OFX import writes the lines but drops the file's `LEDGERBAL`, so the account balance drifts from the bank's as soon as a line is missing or the opening balance was a guess.

**Approach:** The OFX source returns the statement balance; step 7 of `ledger.ingest` (AD-4) turns it into a `reconciliation` valuation owned by the import (AD-8), converted by `toStoredBalance` (AD-5). The preview says what will happen to it.

## Boundaries & Constraints

**Always:**
- `ParsedStatement` gains `balance: { amount: MinorUnits; currency: string; date: IsoDate } | null`, signed as the bank prints it. OFX reads `LEDGERBAL/BALAMT` through the existing `amountOf` and `DTASOF` through `providerDate`, currency `CURDEF`. An unreadable `BALAMT` or `DTASOF`, or no `LEDGERBAL`, gives `null`; the file stays valid.
- `toStoredBalance(account, signed)` in `domain/balances/stored-balance.ts`: unchanged for an asset, negated for a liability. The only place a statement balance changes sign.
- `entries.import_id`, nullable, references `imports.id` restrict, indexed; set only on a reconciliation an import wrote.
- Step 7 outcome, returned in `IngestResult.balance` and the preview as `statementBalance`, `null` without a statement balance:
  - `recorded` `{ date, balance }`: no snapshot on that date, or one owned by an import with another value. Confirm inserts it with `import_id`, or updates the imported one's amount and `import_id`, as Sure's `ReconciliationManager` updates in place.
  - `present` `{ date, balance }`: a snapshot with the same value is already on that date, whoever wrote it. Nothing is written, as for a line already present.
  - `kept` `{ date, balance, recorded, gap }`: a snapshot with no `import_id` and another value is on that date. Nothing is written; `gap = balance - recorded`, shown signed as on the Soldes tab.
  - `skipped` `{ date, balance, reason }`: `BEFORE_OPENING_DATE` (against the opening date after any accepted move), `DATE_IN_FUTURE`, or `CURRENCY_MISMATCH`. Nothing is written.
- The outcome joins the preview digest: a snapshot added between preview and confirm answers `409 IMPORT_PREVIEW_STALE`. Recompute starts at the earliest of the written lines, the moved opening and the snapshot date.
- A user write through `recordSnapshot` or `updateSnapshot` on an imported snapshot clears its `import_id`: the value is now the user's, later imports keep it, Story 2.5's revert leaves it.
- The balance counts as something to write, like a line (Sure publishes an import without new rows): confirm is enabled when lines would be written or the outcome is `recorded`. With no line to write and a `recorded` balance, the button reads « Enregistrer le solde » and the success toast « Solde du relevé enregistré. »; « Toutes les opérations de ce fichier sont déjà présentes. » shows only when nothing at all would be written.
- Preview, above the tabs, one sentence (`fr.json` `imports.balance.*`): recorded « Le relevé indique un solde de {amount} au {date}. Il sera enregistré dans l'onglet Soldes. »; present « Le solde du relevé au {date}, {amount}, est déjà enregistré. »; kept « Vous avez saisi un solde de {recorded} au {date}, il est conservé. Le relevé indique {amount}, soit un écart de {gap}. »; skipped « Le solde du relevé au {date} ne sera pas enregistré : » plus « il précède la date d'ouverture du compte. », « il est daté dans le futur. » or « sa devise diffère de celle du compte. ». Amounts are stored balances, so a card shows its debt as positive.
- Fixture: one synthetic OFX 1.0.2 SGML card statement (`CCSTMTRS`, `windows-1252`) with a negative `LEDGERBAL`, naming the French bank it imitates in a header comment.

**Never:**
- No revert, no Imports tab (2.5). No origin marker on the Soldes tab. No `AVAILBAL`. No sign guessing per bank: a card exported with a positive `LEDGERBAL` shows a credit, per the OFX specification.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Checking | `BALAMT 2408.61`, `DTASOF` 15 Sept | Snapshot 2 408,61 € on 15 Sept, `import_id` set | — |
| Card | `CCSTMTRS`, `BALAMT -512,30` | Snapshot 512,30 € owed | — |
| No balance | No `LEDGERBAL` | No snapshot, no sentence | — |
| User snapshot | 2 400,00 € typed on 15 Sept | `kept`, gap 8,61 €, value stays | — |
| Re-import | Same file after confirm | `present`, nothing written, confirm disabled | — |
| Balance only | Every line present, later `DTASOF` | `recorded`, « Enregistrer le solde » writes the snapshot | — |
| Same as user | 2 408,61 € typed on 15 Sept | `present`, nothing written | — |
| Newer file | Another import's snapshot on that date, other value | Amount and `import_id` replaced | — |
| Before opening | `DTASOF` on or before opening date | `skipped` | — |
| Future | `DTASOF` after today | `skipped` | — |
| Stale | User snapshot added on `DTASOF` after preview | Nothing written | `409 IMPORT_PREVIEW_STALE` |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/statement.ts` -- `ParsedStatement` (L43); comment says the balance arrives here.
- `packages/api/src/connectors/ofx/ofx.ts` -- `statement` Zod schema (L70) gains optional `LEDGERBAL`; `amountOf` (L113) already takes a comma; `parse` (L165) builds the result.
- `packages/api/src/connectors/ofx/fixtures/` -- `boursorama-211-xml.ofx` has `2408.61` on 15 Sept, `credit-agricole-102-sgml.ofx` has `1234,56`; `ofx.spec.ts` asserts `balance` for both.
- `packages/api/src/services/ledger.ts` -- `ingest` (L527): slot 7 comment (L700), digest (L616), recompute (L702). `snapshotOn` (L1194) finds a same-day snapshot; `recordSnapshot` (L1231) and `updateSnapshot` (L1282) clear `import_id`. `deleteAccount` (L859) already deletes entries before imports.
- `packages/api/src/domain/balances/snapshot.ts` -- `snapshotRejectionFor` gives `BEFORE_OPENING_DATE` and `DATE_IN_FUTURE`; reuse it.
- `packages/data/schema/entries.ts` -- add `importId` and the index; migration 0006 through `pnpm data generate`; `migrate.spec.ts`.
- `packages/api/src/services/imports.ts` -- `ImportPreview` (L31) and `runPreview` pass `statementBalance` through.
- `packages/web/src/components/ImportDialog.tsx` -- `Preview` (L166), next to the `opening` sentence (L181); `lib/import-preview.ts`; `locales/fr.json` `imports`.
- `packages/web/e2e/import-ofx.spec.ts` -- OFX built inline with `daysAgo`; the Soldes tab test ids live in `e2e/snapshots.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/balances/stored-balance.spec.ts`, `stored-balance.ts` -- asset, liability, zero; tests first.
- [x] `packages/api/src/connectors/ofx/ofx.spec.ts`, `ofx.ts`, `domain/statement.ts`, new card fixture -- balance read from XML, SGML with comma, card, absent, unreadable amount, unreadable date; then the parser.
- [x] `packages/data/schema/entries.ts`, `drizzle/0006_*`, `migrate.spec.ts` -- column, index, migration.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- every matrix row at ledger level, dry run writes nothing, `balanceOn` equals the statement balance after confirm, user edit clears `import_id`; then step 7.
- [x] `packages/api/src/services/imports.ts`, `app.spec.ts` -- `statementBalance` in the preview response.
- [x] `packages/web/src/components/ImportDialog.tsx`, `lib/import-preview.ts`, `locales/fr.json` -- the three sentences.
- [x] `packages/web/e2e/import-ofx.spec.ts` -- one test per acceptance criterion below.

**Acceptance Criteria:**
- Given a checking account and an OFX file with `LEDGERBAL`, when I import it, then the preview states the balance and date, and after confirm the header balance and the Soldes tab show it.
- Given a snapshot I typed on the `DTASOF` date, when the preview opens, then it states my value is kept and the gap; after confirm my value is unchanged.
- Given a credit card and a file whose `LEDGERBAL` is negative, when I import it, then the card shows the positive amount owed.
- Given a file without `LEDGERBAL`, when I import it, then the preview has no balance sentence and the Soldes tab stays empty.
- Given the verification gate of `AGENTS.md`, when it runs, then every command passes and no tracked file changes.

## Implementation Notes

- `drizzle-kit` generates `ALTER TABLE ADD` without the foreign key action; `0006_add_entry_import.sql` adds `ON DELETE restrict` by hand to match the schema.
- The confirm rules live in `lib/import-preview.ts`: `canConfirm`, `isBalanceOnly`, and `isNothingNew`, which now counts the balance.
- Two `app.spec.ts` tests confirming the Crédit Agricole fixture now expect its `LEDGERBAL` (1 234,56 on 15 Sept) instead of the sum of its lines.
- QA on a throwaway database, Chromium 1280 px, light and dark: the Boursorama fixture previews « Le relevé indique un solde de 2 408,61 € au 15 septembre 2026 », confirm sets the header to 2 408,61 €, and the same file again shows the balance as already recorded with confirm disabled.

## Spec Change Log

- Review loop 1, findings #1 to #3: a file whose only news is its balance could not be confirmed, and re-import promised a write it skipped. The owner asked for Sure's behaviour and a logical rule, so the frozen block now treats the balance like a line: a `present` outcome for an equal value, whoever wrote it, and confirm enabled by a `recorded` balance alone, labelled « Enregistrer le solde ». Avoids a preview that promises a write confirm cannot make. KEEP: the parser, `toStoredBalance`, the migration, `import_id` ownership and clearing, the digest entry and the skip reasons as built.

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge | `ImportDialog.tsx` confirm, `isNothingNew` | Confirm stays disabled when only the balance would change; the footer says nothing is new next to « Il sera enregistré » | medium | `disabled={count === 0 ...}` ignores `statementBalance`; a re-export with no new line but a later `DTASOF` can never record its balance. | intent_gap, resolved in spec change log |
| 2 | blind, edge | `ledger.ts` `planStatementBalance` / `writeStatementBalance` | `recorded` also covers an equal value already owned by an import: the preview promises a write confirm skips | medium | Same root as #1: the frozen matrix names re-import `recorded`; a distinct status changes the frozen outcome union. | intent_gap, resolved in spec change log |
| 3 | blind, edge | `ImportDialog.tsx` `StatementBalanceNote` kept | A user value equal to the file reads « un écart de 0,00 € » | low | True; fixing it changes the frozen sentence, folded into #1's question. | intent_gap, resolved in spec change log |
| 4 | blind | `ImportDialog.tsx` kept gap | Gap formatted unsigned, while `SnapshotList.tsx` uses `formatSignedMoney` | low | `formatMoney` drops the direction of the gap. Direct fix. | patch |
| 5 | verification | `import-ofx.spec.ts` | The skipped sentence and its reasons have no interface test | medium | Pre-verified: no e2e or component test renders `imports.balance.skipped`. | patch |
| 6 | blind, edge | `ofx.ts` `balanceOf` | `DTASOF` at midnight may mean the end of the day before, putting the snapshot one day late | maybe-false | `providerDate` keeps the first eight digits, the repo's rule for provider dates. Real exports would settle whether banks mean start or end of day. | defer |
| 7 | blind | `ledger.ts` step 7 | A line dated on `DTASOF` but missing from the file is overridden by the snapshot | false | AD-8: a reconciliation sets the end-of-day balance, as in Sure; the next file's snapshot moves past it. | |
| 8 | blind | `ImportDialog.tsx` skipped | Skipped sentence omits the amount and offers no opening move | low | Copy decided in the spec; adds a branch and an action. Rejected. | |
| 9 | blind | Soldes tab | Imported snapshots are not marked | false | The intent excludes it (« No origin marker on the Soldes tab »). | |
| 10 | blind | `deleteSnapshot` | A deleted imported snapshot comes back on re-import | false | Same rule as a deleted imported transaction in Story 2.1; Story 2.5's revert is the removal tool. | |
| 11 | blind | `app.spec.ts` | `statementBalance` schema uses `.passthrough()` | low | Ledger tests assert every outcome exactly. Rejected. | |
| 12 | blind | success toast | Toast does not mention the balance | false | EXPERIENCE.md: result toasts give numbers only. | |
| 13 | blind | `import-ofx.spec.ts` card test | Soldes tab not checked for the card | low | The header assertion is the acceptance criterion; the ledger test checks the stored value. Rejected. | |
| 14 | edge | `ofx.ts` `amountOf(BALAMT)` | Balance scaled with the account currency when `CURDEF` differs | false | Only `skipped` reaches that case, and its sentence shows no amount. | |
| 15 | edge | `lib/import-preview.ts` | Code Map names it, file unchanged | false | The sentence logic lives in the component; nothing reads it from `lib`. | |

## Design Notes

A newer import replaces an older import's snapshot on the same date because the bank's latest file is the better word, as Sure's `ReconciliationManager` updates in place. An equal value writes nothing, so a re-import changes nothing and keeps the first import as owner. Existing tests that confirm a fixture and assert a balance will now see the fixture's `LEDGERBAL` from 15 Sept; update their expectations, not the fixtures.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- `import-ofx.spec.ts` and the existing suite pass.

**Manual checks:**
- Import each fixture on a throwaway database: the header balance equals the file's `LEDGERBAL`; the card fixture shows a positive amount owed.
