---
title: "Story 29.4: Clean bank labels and create merchants from counterparties, as Sure"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: 'bd8a05dbb3cd09a11b82fa3735aa2a340f3e9819'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure's `EnableBankingEntry::Processor` (at `00dd977fb`) names a bank line from its counterparty, else from its remittance when the counterparty is a technical `CARD-<digits>` placeholder, else the bank code's description, else the remittance, else the direction (`name`). Every remittance it reads goes through `primary_remittance_information`: a wallet prefix (`WALLET_PREFIX`, « Apple Pay: », « Google Pay: », « Samsung Pay: ») goes, a technical `POS` or `ATM` terminal line is skipped for the next one, a merchant name the household already knows, three characters or more, wins, the longest first, and else a card-terminal prefix (`PAYMENT_PROCESSOR_PREFIX`, `SUMUP *`, `SQ *`, `IZETTLE *`, `ZETTLE *`, `PAYPAL *`) goes. Its `merchant` then finds or creates a merchant from the readable counterparty, or from the remittance for a `CARD-` placeholder or when it names a known merchant (`merchant_name_candidate`, `find_or_create_merchant`), and `import_transaction` sets it unless the user locked it (`enrich_attribute`). Archant names the line from the counterparty, the bank code or the first raw remittance line, applies none of these clean-ups, and creates no merchant: bank lines stay « Sans marchand » and read « CARD-1234 » or « Apple Pay: … » where Sure reads the shop.

**Approach:** The Enable Banking connector takes the household's merchant names and computes Sure's label and merchant name for each line; the sync service hands it those names. The ledger's ingest finds the merchant by name, case aside, or creates it, for each line it writes or absorbs, and sets it unless locked. A bank line's fingerprint keeps hashing the label as Archant read it before this story, so a label that now depends on the household's merchants never changes a line's key.

## Boundaries & Constraints

**Always:**
- Label, in Sure's order: a counterparty (the creditor for a debit, the debtor for a credit) that is not `/^CARD-\d+$/i` once trimmed; for a `CARD-` placeholder, the cleaned remittance, cut as Rails' `truncate(100)` (97 code points and `...` when longer); the bank code's description; the cleaned remittance, cut the same way; « Virement sortant » or « Virement entrant ». The 200-character `LABEL_MAX_LENGTH` still applies.
- Cleaned remittance, Sure's `primary_remittance_information`: each remittance line trimmed, `WALLET_PREFIX` removed, trimmed again, blank lines dropped; the first line not matching Sure's technical regex (`POS` or `ATM`, an amount, then a `d.m.` date and an `hh:mm` time at the end), else the first line; then the longest known merchant name of three characters or more found in it as a whole word, case aside, returned as stored; else the line without `PAYMENT_PROCESSOR_PREFIX`, the line itself when nothing would be left.
- Whole word as Sure's lookarounds: no letter, mark, decimal digit or `_` right before or after the name; the name's own characters are matched literally.
- Merchant name, Sure's `merchant_name_candidate`: the readable counterparty; else for a `CARD-` placeholder the cleaned remittance's first 100 code points; else the cleaned remittance when it is exactly a known name; else none. Cut to `MERCHANT_NAME_MAX_LENGTH` (60) and trimmed, Archant's merchant limit.
- Known names: every merchant of the household, read once per bank account before its statement, as Sure computes `known_merchant_names` once per account batch.
- The ledger finds a merchant by name with the locale-aware fold `assertNameFree` uses, else creates it; only for lines it writes or absorbs, never for a line already present, and never on a dry run. A created line takes it before rules run, so a rule may still change it. An absorbed pending entry takes it unless `merchant` is locked; a line naming no merchant leaves the entry's merchant as it is, as Sure's `if merchant`.
- Notes stay the remittance lines joined, wallet prefix included, as Sure's `notes`.
- A bank line's fingerprint hashes `keyLabel`, the label read as before this story (counterparty, bank code, first remittance line, direction), so entries already synced and lines whose label changes with the household's merchants keep their key (AD-7).
- AD-3, AD-7 and AD-18 state it; `docs/sure-parity.md` « Label », « Merchants from counterparties » and « Merchants » change.

**Never:** no `source` column and no separate « provider merchants » list: Archant holds one household, so a bank merchant is one of its merchants (Sure's `ProviderMerchant` exists to be shared between families); no merchant change on a line already present; no direction change for a line without indicator (Story 29.5); no pending rule change (Story 29.6); no new dependency; no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Readable counterparty | creditor `Boulangerie Martin` | label and merchant `Boulangerie Martin` | none |
| `CARD-` placeholder | creditor `CARD-1234`, remittance `Apple Pay: SUMUP *CAFE DU COIN` | label and merchant `CAFE DU COIN` | none |
| Long remittance on `CARD-` | 150 characters | label 97 + `...`; merchant first 60, trimmed | none |
| Technical line | `POS 45,13 AT D6 31.07. 10:27`, `BILLA DANKT 0007114` | label from the second line | none |
| Known merchant | known `Billa`, remittance `BILLA DANKT 0007114`, no counterparty | label and merchant `Billa` | none |
| Short known name | known `IT`, remittance `NAME IT` | no match | none |
| Unknown remittance, no counterparty | `SUMUP *GLACIER` | label `GLACIER`, no merchant | none |
| Same merchant again | `CARREFOUR` after `Carrefour` exists | existing merchant reused | none |
| Locked merchant on pending | user set merchant, booked line absorbs | merchant stays | none |
| Already present | line re-read under its key | nothing written | none |
| Fingerprint | line without `entry_reference`, label now cleaned | same fingerprint as before | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/connectors/enable-banking/labels.ts` (new) -- Sure's `name`, `primary_remittance_information`, `merchant_name_candidate`, `technical_card_counterparty?`, `technical_remittance_line?`, the wallet and processor prefixes and the known-merchant match, as pure functions; `labelOf` leaves `client.ts`.
- `packages/api/src/connectors/enable-banking/client.ts` -- `toTransaction(raw, since, knownMerchants)` sets `label`, `keyLabel` and `merchant`; `fetchStatement` passes the names.
- `packages/api/src/connectors/bank-connector.ts` -- `fetchStatement(uid, since, today, knownMerchants)`.
- `packages/api/src/domain/statement.ts` -- `NormalizedTransaction.merchant` and `keyLabel`, both optional, a bank connector's only.
- `packages/api/src/domain/keys.ts` -- `tripleOf` hashes `keyLabel` when given.
- `packages/api/src/services/ledger/ingest.ts` -- finds or creates the merchants of the written and absorbed lines; sets them on insert and on the rule plan.
- `packages/api/src/services/ledger/pending.ts` -- `absorb` takes the merchant unless locked.
- `packages/api/src/services/sync.ts` -- reads the merchant names per bank account.
- `packages/data/schema/merchants.ts` -- comment only: bank merchants share the table.
- Specs: `labels.spec.ts`, `client.spec.ts` (merchant and label of `toTransaction`, `keyLabel`), `keys.spec.ts` (`keyLabel`), `ingest.spec.ts` (created, found again case aside, absorbed, locked, present untouched, rules see it), `sync.spec.ts` (names passed, merchant created by a sync).
- Docs: `docs/architecture.md` AD-3, AD-7, AD-18; `docs/sure-parity.md` rows « Label », « Merchants from counterparties », « Merchants ».
- Sure, read-only, at `00dd977fb`: `app/models/enable_banking_entry/processor.rb`, `app/models/account/provider_import_adapter.rb#find_or_create_merchant`, `app/models/family.rb#known_merchant_names`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: each clean-up (wallet, technical line, processor prefix, `CARD-` placeholder and its cut), the known merchant match (whole word, longest, three characters, stored case), the merchant candidate, `keyLabel`; ingest creating a merchant, finding it again case aside, absorbing into a pending entry with and without a lock, leaving a present line alone; a sync creating the merchant from a counterparty.
- [x] `labels.ts`, connector, port, statement type, keys.
- [x] Ingest, absorb, sync.
- [x] AD-3, AD-7, AD-18 and parity rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with no request reaching Enable Banking.

### Review Findings

Second pass, `bmad-code-review` (four layers) over the committed branch.

- [x] [Review][Patch] The absorb lock on a merchant the user cleared was never exercised: the only locked case already had a merchant [packages/api/src/services/ledger/ingest.spec.ts]
- [x] [Review][Patch] `toTransaction` defaulted `knownMerchants` to `[]`, so a caller forgetting it silently matched no known merchant [packages/api/src/connectors/enable-banking/client.ts]
- [x] [Review][Patch] `merchantNameOf` cut a placeholder's remittance to 100 code points before the 60-unit cut, dead code under a misleading comment [packages/api/src/connectors/enable-banking/labels.ts]
- [x] [Review][Patch] AD-18 and the parity row said « 60 characters » where the code counts the merchant form's UTF-16 units [docs/architecture.md]
- [x] [Review][Patch] No test that two lines of one statement naming a new merchant in two cases create one merchant [packages/api/src/services/ledger/ingest.spec.ts]
- [x] [Review][Patch] The parity row called merchants Parity without naming lines paired with another source's entry, which take no merchant [docs/sure-parity.md]
- [x] [Review][Defer] Present and paired bank lines are never re-enriched as Sure's `import_transaction` does, so lines synced before this story keep no merchant and a recurring series keyed by their label stops at the upgrade [packages/api/src/services/ledger/ingest.ts] — deferred: Archant refreshes no field of such a line, label included; the pull request describes the upgrade effect.

Rejected:
- `low` Regular expressions compiled per known name and per line, and `primaryRemittance` run twice: measured 0.5 s for 4,000 lines and 300 names, far under the 10-minute lease; caching adds structure.
- `low` Raw-label rules (« Apple Pay », « SUMUP ») stop matching new lines: Sure's labels; the pull request says so.
- `false` Concurrent merchant creation breaking the unique index: `ingest` holds the write lock in an `immediate` transaction.
- `low` A merchant deleted between the names' read and the ingest comes back: a window of seconds, and Sure recreates a deleted merchant at the next sync too.
- `false` A `CARD-` line whose remittance lines are all technical gets a merchant named after the terminal line: Sure's `lines.first` fallback does the same.
- `false` A known name of digits or punctuation matches: Sure's `matched_known_merchant_name` has no such guard.
- `low` Bank text not composed (NFC) before matching, and Ruby/JavaScript whitespace and word-boundary differences: Sure normalises nothing either; no bank known to send decomposed text.
- `low` `Map` keyed by the line object: no step copies a line between the lookup and its uses.
- `low` `foldedName` adds NFC to `assertNameFree`'s fold: stored names are composed by the merchant schema, so both folds agree on every stored name.
- `low` « Virement entrant » and « Virement sortant » not cited as French text in the « Label » row: pre-existing wording.

## Design Notes

Assumptions taken alone, each settled by Sure or by a reason the owner admits. Known names are every merchant of the household: Sure's `known_merchant_names` is the family's merchants plus the provider merchants on its transactions, and Archant keeps both in one table. A merchant is found again with the locale-aware fold, Sure's `provider_merchant_id` being the MD5 of the lower-cased name; with one table, a merchant the user created under that name is the one found, since the table's unique index refuses a second. The merchant name is cut to 60 characters, Archant's merchant limit, where Sure keeps a counterparty whole. A line already present is left alone, as Archant refreshes no field of a present line, where Sure re-enriches name, notes and merchant on every read: changing that is wider than this story. A bank line's fingerprint keeps the label read before this story, a deliberate fix: Sure keys by content, not by name, and hashing the new label would duplicate every re-read line without `entry_reference` whose label a newly known merchant changes. No Playwright test: the story asks for Vitest; the visible change, a merchant under each synced line, is checked in the visual QA.

## Spec Change Log

- Code review, first pass: an absorbed pending entry overwrote a merchant a rule had set, since Archant runs rules on created rows only, where Sure re-applies every rule after each sync and the rule's merchant wins. The frozen constraint said the absorbed entry takes the merchant unless locked. Amended in code to Sure's net outcome: the entry takes it only when it has none and `merchant` is not locked; and a merchant this ingest created that no transaction ends up referencing is deleted after rules, as Sure's merchant list shows only provider merchants assigned to a transaction. Known-bad state avoided: a rule's merchant lost at booking, and empty merchants piling up in « Réglages › Marchands ». KEEP: `keyLabel` fingerprints, Sure's label order and clean-ups, the merchant found again by the locale-aware fold.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Absorb overwrites a merchant a rule set on the pending entry | medium | patch | Archant runs rules on created rows only; Sure re-applies every rule after each sync, so the rule's merchant wins there. Absorb now fills the merchant only when the entry has none and it is not locked. |
| 2 | Merchants created and then referenced by nothing (absorbed entry keeping its own, rule replacing the bank's) show in « Réglages › Marchands » | medium | patch | Sure lists only provider merchants assigned to a transaction. The ingest deletes, after rules, the merchants it created that no transaction references. |
| 3 | `merchantsNamed` creates rows under a reader's name | low | patch | Renamed `findOrCreateMerchants`, as Sure's `find_or_create_merchant`. |
| 4 | `foldedName` comment calls it `assertNameFree`'s fold, which has no NFC | low | patch | Comment corrected. |
| 5 | Two stored names folding alike: the last read wins | low | patch | Ordered by `createdAt`, `id`, first kept. |
| 6 | Helper inserted between `bankBalance` and its comment in `ingest.spec.ts` | low | patch | Moved. |
| 7 | No end-to-end test that `keyLabel` keeps a re-read line present | medium | patch | Ingest test added. |
| 8 | Known names re-read per account and their order are untested and unexplained | medium | patch | Two-account sync test, same-length tie test, comment on the order. |
| 9 | MCP `get_merchants` `source` description says no merchant is a provider's | low | patch | Description now says a sync's merchants are the household's own; the literal stays `family`, Archant having no provider merchants. |
| 10 | Ledger does not validate `line.merchant` itself | low | reject | Only the Enable Banking connector sets it, already cut and composed as the merchant form accepts. |
| 11 | `merchantName` repeats `merchantSchema`'s rules | low | reject | The schema validates and refuses; the connector must cut instead, so it cannot reuse it. |
| 12 | Labels change on upgrade for rules and recurring detection | low | reject | Sure's labels; nothing for a self-hoster to do, existing lines keep theirs. |
| 13 | No user documentation that every counterparty becomes a merchant | low | reject | Sure does the same; the parity rows state it. |
| 14 | A regular expression compiled per known name and per line | low | reject | Measured 0.5 s for 4,000 lines and 300 names; far under the 10-minute lease, and caching adds a structure. |
| 15 | Bank text not composed (NFC) before the known-name match | low | reject | Sure's match does not normalise either. |
| 16 | `knownMerchants.includes` relies on `primaryRemittance` returning the stored name | low | reject | That is exactly Sure's `merchant_name_candidate`. |
| 17 | An exact known name under three characters still becomes the merchant | false | reject | Sure's `known_merchant_names.include?(remittance)` has no length floor either. |
| 18 | A concurrent merchant creation breaks the unique index | false | reject | `ingest` runs in an `immediate` transaction holding the write lock. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
