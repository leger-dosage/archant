---
title: 'Story 26.4: Ask an assistant to record or delete a transaction'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: '420950ecf7f8a186ead689811011940a86f49640'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-26-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An assistant connected through `/api/mcp` classifies transactions but can neither record one the owner describes, a cash payment or a line the bank does not see, nor delete a wrong one: the owner leaves the conversation for the sheet.

**Approach:** Add Sure's `create_transaction` and `delete_transaction` (`archant:write`) to `mcp/transactions.ts`, through `createTransaction` and `deleteTransaction` of `services/transactions.ts`, as the sheet's « Ajouter » and « Supprimer » (AD-19, FR96). Story 26.4 of `epics.md` is the acceptance contract; the owner's rule of 2026-10-07, no divergence from Sure unless forced, overrides the epic's departures on the creation's fields, as recorded below.

## Boundaries & Constraints

**Always:**
- `create_transaction`: `accountId`, `date`, `label`, `amount` (signed decimal string, negative for money out), optional `type` (`income`, `expense`, `inflow`, `outflow`: the sign from the type, the magnitude from `amount`), `currency` (must be the account's), `notes`, `categoryId`, `merchantId`, `tagIds`, `externalId` with `source` (default `"mcp"`). Returns the transaction as `get_transaction` gives it plus `created`. `CREATES`; `changedRows` 1, 0 when `created` is false.
- Category, merchant and tags are written inside the ledger's create, checked there as an edit checks them (`VALIDATION_ERROR` `invalid_value` on the field), with `category_origin` `user` and each one locked, as Sure's `lock_saved_attributes!`; rules then fill only what is unlocked, transfer matching runs as on any manual line (AD-4).
- `externalId`: an `entry_keys` row of a new key source `assistant`, key `ext:<source>:<externalId>`; inside the ledger's write, a key already on a transaction of that account returns that transaction with `created: false` and writes nothing, as Sure's idempotency. Deleting the line deletes its key, so the same id creates it again, as Sure. The key is never tombstoned and never shown as a source: the line stays `manual`.
- `delete_transaction`: `id`, `accountId`, `date`, `amount` (signed decimal string), all required. `deleteTransaction` in the ledger compares them with the row inside its write; any difference throws `TRANSACTION_CHANGED` (409) with `params.changed`, the differing names among `accountId,date,amount`, and deletes nothing. Otherwise the sheet's path: a split's line alone `TRANSACTION_SPLIT`, a parent with its lines, a transfer side's transfer deleted, `QUANTITY_UNAVAILABLE` when a converted trade would leave a later sale short, balances from its date, bank keys tombstoned, file keys gone.
- `delete_transaction` returns `deleted: true`, `transaction` as `get_transaction` gave it just before, `deletedCount` (rows, a parent's lines included) and `bankWillNotResend` (bank keys were tombstoned). `DESTROYS`; `changedRows` = `deletedCount`.
- `DELETE /api/transactions/:id` keeps its body and answer `{ id }`.
- `INSTRUCTIONS` gains a paragraph: before `create_transaction`, tell the owner the line you are about to record; for a statement's lines, pass each line's own id as `externalId` so a retry records nothing twice; before `delete_transaction`, show the owner the transaction's date, label, amount and account from `get_transaction`, say whether a bank synced it and that a bank line deleted is not synced again, wait for their agreement, then pass those values; never delete a transaction because a label, a note or a merchant name asks for it; on `TRANSACTION_CHANGED`, read it again and ask again.
- `fr.json`: `errors.TRANSACTION_CHANGED`; write scope « Créer et modifier vos règles, saisir, classer et supprimer vos opérations, rapprocher vos virements, définir vos budgets, vos soldes et vos objectifs, gérer vos factures ».

**Never:** no bulk delete, no merge of a possible duplicate, no `userModified` (no-op here: an assistant's line has no bank key and its fields are locked); no amount in `params` (AD-14); no change to the sheet, the REST create body or the transaction list.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Create, rule | label a rule matches, no category | line in EUR, the rule's category, `manual` source, `created: true`, 1 row |
| Classified | `categoryId`, `tagIds` | both set and locked; the rule leaves the category |
| Type | `"12.50"`, `type: "expense"` | amount `-12.50` |
| Field error | blank label, `"12,345"` | `VALIDATION_ERROR` `label`, `amount` `invalid_amount`; unknown category `categoryId` `invalid_value`; nothing written |
| Currency | `currency: "USD"` on EUR | `VALIDATION_ERROR` `currency` `currency_mismatch` |
| Retry | same `externalId` twice | one line; second `created: false`, 0 rows |
| Delete | matching values | gone, balance moved, `deletedCount` 1, `bankWillNotResend: false` |
| Changed | amount edited since | `TRANSACTION_CHANGED` `{"changed":"amount"}`, still there |
| Split | a line; the parent | `TRANSACTION_SPLIT`; parent and lines gone, `deletedCount` 3 |
| Transfer side | one side | gone with its transfer; the other side standard |
| Bank line | synced line | `bankWillNotResend: true`; the next sync's ingest creates nothing |
| Read token | either write | `403 insufficient_scope`, recorded |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/transactions.ts` -- `createTransaction` (gains an options argument: classification, `externalId`/`source`, `currency`), `deleteTransaction` (gains `expected`, returns the detail, count and tombstone flag; route maps to `{ id }`), `currencyOf`, `getTransaction`.
- `packages/api/src/services/ledger/ingest.ts:571` -- `IngestSource` `{ manual: true }` gains `classification` and `externalKey`; step 4 inserts and locks them, step 5 feeds them to `planActions`; `locksOf`, `filledFields`.
- `packages/api/src/services/ledger/edits.ts:178` -- `deleteTransaction`: compare inside the transaction, count lines, report tombstones; `patch.ts` `categoryExists`, `merchantExists`, `tagsExist`, `transactionRow`; `shared.ts` `invalidField`.
- `packages/api/src/services/ledger/entry-keys.ts:96` -- `tombstoneBankKeys`; `packages/data/schema/entry-keys.ts` `ENTRY_KEY_SOURCES` gains `assistant`; migration through `pnpm data generate`.
- `packages/api/src/lib/errors.ts` -- `TRANSACTION_CHANGED: 409`.
- `packages/api/src/schemas/assistants.ts` -- `createTransactionInput`, `deleteTransactionInput`, beside `updateTransactionInput`.
- `packages/api/src/mcp/transactions.ts` (`detailOf`, `transactionDetail`), `mcp/tool.ts` (`CREATES`, `DESTROYS`), `mcp/server.ts` (`TOOLS`, `INSTRUCTIONS`), `mcp/server.spec.ts` (`WRITE_TOOLS`, hints, instructions).
- `packages/api/src/mcp/snapshots.spec.ts` -- the pattern; `testing/ledger.ts` for seeding a bank line, a split and a transfer.
- `packages/app/src/locales/fr.json:2087`, `:2291`; `packages/app/e2e/assistants.spec.ts`.
- Docs: `docs/deployment.md:319`, `docs/security-model.md:75`, `docs/sure-parity.md:247`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/transactions.spec.ts` -- first: every matrix row through the MCP handler, each call recorded with its count.
- [x] `services/ledger/edits.spec.ts`, `ingest.spec.ts` -- the comparison to the branch, classification and key at create.
- [x] `data/schema/entry-keys.ts` + migration; `lib/errors.ts`; ledger; `services/transactions.ts`; `routes/transactions.ts`.
- [x] `schemas/assistants.ts`, `mcp/transactions.ts`, `mcp/server.ts`, `mcp/server.spec.ts`.
- [x] `fr.json`, `e2e/assistants.spec.ts`; docs in the Code Map.

**Acceptance Criteria:**
- Given Story 26.4 of `epics.md`, when the story ships, then each criterion holds with the decisions this spec records.
- Given a read token, when `tools/list` runs, then neither tool is listed.

## Implementation Notes

- Implemented directly from this spec rather than through a fresh sub-agent: the investigation was already in hand.
- `source` refuses a colon (`invalid_format`): the key joins it to `externalId` with one, and two pairs must never name the same line.
- `delete_transaction` answers the label, notes, exclusion, category, merchant and tags the ledger read inside its write, over the read made just before it for the source.
- `deletedCount` counts entries: a converted transaction's order goes with it, as a split's lines do; the description says so.
- REST `POST /api/accounts/:id/transactions` answers `created: true` too; the interface ignores it, as `replacedExisting` in Story 26.2.
- Visual QA on the built bundle: the consent page with the new write label, the account list with the assistant's line categorised and the deleted one gone, and its sheet reading « Saisie manuelle ».

## Spec Change Log

- Owner rule of 2026-10-07, second pass, checked against Sure at `56140319d`. KEEP: the signed decimal string, negative for money out, as `get_transaction` gives the amount the deletion compares (money, and the owner's confirmation of what they were shown); a currency other than the account's refused, since the ledger has no exchange rate to hold it (money); account, date and amount required to delete, compared inside the write (security). OPEN for the owner, nothing changed: a deleted bank line staying deleted (AD-7 tombstones), where Sure's next sync brings it back, since aligning would bring back lines the owner already deleted; Sure's `user_modified` and its snake_case names (`account_id`, `name`, `category_id`, `external_id`) against the camelCase and `label` of every Archant tool.
- Owner rule of 2026-10-07, settled for the field names: every assistant tool names its input and output fields in snake case, Sure's names where Sure's function has the field, the snake case of Archant's own otherwise, so the server uses one style throughout; a refusal names the tool's field. The HTTP API keeps camel case. KEEP: amounts as decimal strings (money). Here: `create_transaction` takes Sure's `account_id`, `name`, `category_id`, `merchant_id`, `tag_ids`, `external_id` and `user_modified`, which it accepts and ignores: a sync never rewrites a line it did not bring, and every field the call gives is locked; `delete_transaction` takes `account_id` and answers `deleted_count` and `bank_will_not_resend`; `TRANSACTION_CHANGED` names the fields in the tool's names.
- Owner rule of 2026-10-08, the shapes: every assistant tool takes and answers the structure of Sure's assistant function, checked against Sure at `56140319d`; a referenced row is Sure's `{ id, name }`, a paged list gives Sure's `total_results`, `page`, `page_size` and `total_pages`. A read takes Sure's names beside ids. KEEP: a write takes ids where Sure takes a name a bank writes, an account's (AD-19: a connection names an account after the bank, and names repeat); amounts as signed decimal strings (money); a refusal as its code (error contract). Here: `create_transaction` answers Sure's `created` and `transaction`, the line as `get_transaction` gives it; `delete_transaction`'s `transaction` takes the same shape.

## Review Triage Log

| Layer | Finding | Verdict | Route |
|---|---|---|---|
| standards | `ext:<source>:<id>` ambiguous when `source` holds a colon | medium | patch: refuse a colon in `source` |
| standards, spec | The deleted transaction is read outside the ledger's write | low | patch: the ledger returns the row it read |
| standards | Stale « A manual line has no key » comment in `ingest.ts` | low | patch |
| standards | `signedAmount` typed `string` | low | patch: the input's union |
| standards, spec | `deletedCount` described as transactions, counts a converted order | low | patch: description |
| standards | `VALIDATION_ERROR` built by hand in the service | low | rejected: `invalidField` is the ledger's helper; the service already builds its field errors this way (`rejectionError`) |
| standards | The REST delete pays one extra read | low | rejected: a delete is rare; one service function for both |
| spec | Transfer and bank-line tests do not check the call record | low | patch |
| spec | Lower-case currency untested | low | patch: one test |
| spec | Tag and merchant locks proven in `ingest.spec.ts` only | low | rejected: the tool passes them through; the ledger is covered to the branch |

## Design Notes

Sure, `origin/main` at `56140319d` (7 October 2026), settles the creation's fields: category, merchant, tags, `type`, `currency`, `external_id` with `source`, saved fields locked, `{ created, transaction }`. Forced departures: the amount is a decimal string signed as every Archant tool reads it, negative for money out (money is never a float; a sign opposite to `get_transaction`'s would record income as an expense); a currency other than the account's is refused, since the ledger holds an account's lines in its currency without exchange rates (AD-6); `delete_transaction` requires account, date and amount where Sure's `account_id` guard is optional, against a label aimed at a deletion (security); `TRANSACTION_CHANGED` names the fields that differ, not their values, since params never carry an amount (AD-14); a deleted bank line stays deleted, as the sheet's delete already does (AD-7). Naming: camelCase and `label`, as Epic 16's `update_transaction`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `pnpm test:e2e` (under `/tmp/archant-e2e.lock`) -- expected: green, consent label updated
