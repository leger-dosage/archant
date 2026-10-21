---
title: "Story 31.5: Create a transfer between two accounts"
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: 'a451825d5897c99e9ba80702b8c78e335c484b52'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) creates a transfer from the new-transaction modal: a « Transfert » tab beside « Dépense » and « Revenu » opens `transfers/_form.html.erb`, which asks « De », « Vers », « Date », « Montant », the tags, and a folded « Frais bancaires » with « Frais de transfert sortant » and « Frais de transfert entrant »; `Transfer::Creator` writes both legs, a `confirmed` transfer and each fee as a standard line in « Frais », in one database transaction, and an idempotency key turns a double submit into the first transfer. Archant only pairs two lines that already exist: a move of money no statement shows cannot be recorded.

**Approach:** A new ledger function, `createTransferBetween` in `services/ledger/transfers.ts`, mirrors `Transfer::Creator` in one immediate transaction: both legs, the transfer `confirmed` with its kind from `transferKindOf`, the tags on both legs, each fee a standard line in « Frais » (found by name or created) linked to the transfer by a new `transactions.fee_transfer_id`, and the idempotency key on a new `transfers.idempotency_key`, unique. `POST /api/transfers/new` calls it through `services/transfers.ts`. The new-transaction sheet gains Sure's type tabs at its top, « Dépense », « Revenu », « Virement »; « Virement » swaps the form for `TransferForm`. Undoing or refusing a transfer deletes its fee lines, as Sure's `Transfer#destroy!`.

## Boundaries & Constraints

**Always:**
- Amounts and fees are parsed from text in the source account's currency into integer minor units by `parseAmount`, never through a float; the amount is above zero, each fee zero or above.
- The outflow is `-amount` on « De », named « Virement vers {Vers} », or « Paiement vers {Vers} » when « Vers » is a liability (Sure's `name_prefix`); the inflow is `+amount` on « Vers », named « Virement depuis {De} », or « Paiement depuis {De} » for a liability, as Sure's `"#{name_prefix} from"`. Both lock date, amount and label, as a manual line (Sure's `user_modified: true`), and tags when set.
- A fee is a line of `-fee` on its account, named « Frais de virement — » and the outflow's name for the source fee, the inflow's for the destination fee, as Sure's « Transfer fee — », in the category « Frais » (`#6b7280`, `receipt`, expense, Sure's `models.category.defaults.fees`), found case-insensitively by name or created in the same transaction; no lock, as Sure's.
- A key already used with the same accounts, date, amount and fees returns the first transfer, `200`; with anything else, `409 TRANSFER_FORM_STALE`, Sure's `StaleIdempotencyKeyError`. The unique index backs it under concurrency.
- Both accounts' balances are recomputed from the date in the same transaction (AD-2).
- Only an administrator creates one (`viewerReadOnly`); the tabs show only for a new transaction, which only an administrator opens.

**Ask First:** none; the owner is unavailable and every decision below is settled by Sure.

**Never:** no exchange rate, no destination amount: two currencies are refused (AD-6); no category on the outflow of a contribution (Story 31.7); no transfer drawer (Story 31.6); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Checking to savings | 100,00 € | `201`, outflow « Virement vers Livret » −10000, inflow « Virement depuis Courant » +10000, `internal_move`, `confirmed` | none |
| To a card | depository → credit card | « Paiement vers Carte », `credit_card_payment`; inflow « Paiement depuis Courant » | none |
| To a loan | depository → loan | `loan_payment`, « Paiement vers » | none |
| To an investment | depository → investment | `investment_contribution`, « Virement vers » | none |
| Investment to investment | investment → crypto | `internal_move` | none |
| Both fees | 1,50 € out, 0,80 € in | `-150` on « De » and `-80` on « Vers », in « Frais », linked; « Frais » created once | none |
| Tags | two tags | both legs carry both | unknown tag: `400` on `tagIds` |
| Double submit | same key, same fields | `200`, the first transfer, nothing written | none |
| Stale key | same key, another amount | nothing written | `409 TRANSFER_FORM_STALE` |
| Same account | « De » = « Vers » | nothing written | `400` `same_account` on `toAccountId` |
| Two currencies | EUR → USD | nothing written | `400` `exchange_rate_unavailable` on `toAccountId` |
| Bad amounts | `0`, `-5`, `abc`; fee `-1` | nothing written | `400` `not_positive` / `invalid_amount` on `amount`, `negative_amount` on the fee |
| Unknown account | id of none | nothing written | `400` on `fromAccountId` or `toAccountId` |
| Undo or refuse | created transfer with fees | sides stay, fee lines deleted, balances recomputed | none |
| Viewer | `POST /api/transfers/new` | nothing written | `403 FORBIDDEN` |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/models/transfer/creator.rb`, `app/views/transfers/_form.html.erb`, `app/views/shared/_transaction_type_tabs.html.erb`, `app/controllers/transfers_controller.rb#create`, `app/models/transfer.rb` (`kind_for_account`, `destroy!`, `has_many :fee_transactions, dependent: :destroy`), `config/locales/views/transfers/fr.yml`.
- `packages/data/schema/transfers.ts` -- `idempotencyKey: text("idempotency_key")`, unique where not null.
- `packages/data/schema/transfer-fees.ts` -- `transfer_fees (transaction_id, transfer_id)`, both cascading: a path that deletes a transfer without its fees (a side deleted, an account deleted, an import reverted) leaves them standard lines. See the Spec Change Log.
- `packages/data/drizzle/0090_transfer_creation.sql` -- generated.
- `packages/api/src/schemas/transfers.ts` -- `newTransferBodySchema` (text fields) and `newTransferSchema(currency)` parsing `amount`, `sourceFee`, `destinationFee`.
- `packages/api/src/services/ledger/export.ts`, `reset.ts` -- `transfer_fees` and `idempotency_key` left out of the archive, as Sure's exporter; the reset empties `transfer_fees`.
- `packages/api/src/services/ledger/transfers.ts` -- `createTransferBetween(deps, input, { origin })`; `unmatchTransfer` and `rejectTransfer` delete the fee lines through `deleteTransactionRows` and recompute their accounts.
- `packages/api/src/services/transfers.ts` -- `createTransferBetweenAccounts(deps, body)`: reads the source currency, parses, calls the ledger.
- `packages/api/src/routes/transfers.ts` -- `POST /new`, `201` created, `200` existing.
- `packages/api/src/lib/errors.ts` -- `TRANSFER_FORM_STALE: 409`.
- `packages/app/src/components/TransactionTypeTabs.tsx` -- new: the three tabs, Sure's icons.
- `packages/app/src/components/TransactionForm.tsx` -- the tabs on a new transaction, driving the amount's sign.
- `packages/app/src/components/TransactionSheet.tsx` -- the type tabs for a new transaction, `TransactionForm` or `TransferForm` below; title « Nouveau virement » on the transfer tab.
- `packages/app/src/components/AmountField.tsx` -- `nature` controlled from the tabs when given; its own toggle stays for an edit.
- `packages/app/src/components/TransferForm.tsx` -- new: « De », « Vers », « Date », « Montant », « Étiquettes », folded « Frais bancaires », « Créer le virement ».
- `packages/app/src/hooks/useTransfers.ts` -- `useCreateTransferBetween`, invalidating transactions and accounts.
- `packages/app/src/locales/fr.json` -- the tabs, the form, `errors.TRANSFER_FORM_STALE`, `errors.fields.same_account`, `errors.fields.exchange_rate_unavailable`.
- Docs: `docs/architecture.md` AD-11, `docs/sure-parity.md` « Creating a transfer », `docs/security-model.md` if it lists writes.

## Tasks & Acceptance

**Execution:**
- [x] `services/ledger/transfers-create.spec.ts`, `routes/transfers.spec.ts`, `services/ledger/reset.spec.ts` -- tests first: the matrix.
- [x] Schema, migration, error code, request schemas.
- [x] `createTransferBetween`, fee deletion on undo and refusal, service and route.
- [x] `TransactionSheet`, `AmountField`, `TransferForm`, hook, locales.
- [x] `e2e/transfers.spec.ts` -- create a transfer with a fee from « Ajouter une opération », both legs and the fee line in the list.
- [x] AD-11, parity row, story and sprint status to done.

**Acceptance Criteria:**
- Given the new-transaction sheet, when the administrator picks « Virement », then the form asks « De », « Vers », « Date », « Montant », « Étiquettes » and a folded « Frais bancaires ».
- Given a valid form, when it is submitted, then both legs, the transfer and each fee exist and both balances move, in one database transaction.
- Given a double submit, when the second request arrives, then it returns the first transfer.

## Spec Change Log

- Implementation: the fee link is a table, `transfer_fees`, not the column `transactions.fee_transfer_id` the Approach names. `transactions.ts` referencing `transfers.ts`, which references it, fails oxlint's `import/no-cycle`; the table gives the same link and the same cascade. Behaviour is unchanged.

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | No future-date bound: a year typo writes a balance row for every day up to it | medium | patch | `createTransferBetween` refuses past `isTooFarAhead` with `date_too_late` on `date`, as `ingest` does; tested. |
| 2 | « Frais » created but the category list is not refreshed | low | patch | `useCreateTransferBetween` invalidates `categories.all`. |
| 3 | « Dissocier » and « Ne plus proposer » now delete fees but refresh no balance | medium | patch | `useInvalidateTransactions` in `useTransfers.ts` invalidates `accounts.all` too. |
| 4 | `unpair_transfer` may now delete fee lines; `docs/security-model.md` says one transaction per call | medium | patch | The tool's description and the security model name the fee lines, as Sure's `destroy!`. |
| 5 | New lines skip transfer matching, which every typed line goes through | low | patch | `matchTransfers(tx, now)` runs in the same transaction. |
| 6 | An inactive account is accepted by the API | low | patch | `transferAccount` refuses it on its field, as the form lists active accounts only; tested. |
| 7 | `TRANSFER_FORM_STALE` text invites a second transfer; `exchange_rate_unavailable` text suggests another date works | low | patch | Both messages say what happened. |
| 8 | The tabs' group is named « Sens de l'opération » though it holds « Virement » | low | patch | `transfers.form.type` « Type d'opération »; e2e checks it. |
| 9 | No test of the cascade when a side is deleted outside undo or refusal | medium | patch | `transfers-create.spec.ts` deletes the inflow and checks the fee stays a standard line, its link gone. |
| 10 | No e2e records an income through the « Revenu » tab, nor checks an edit keeps its toggle | medium | patch | `e2e/transactions.spec.ts` adds that test. |
| 11 | The fee-deletion test checks the destination balance only | low | patch | It checks the source's too. |
| 12 | A resent key with other tags returns the first transfer | false | reject | Sure's `matches_request?` compares accounts, date, amounts and fees, never tags. |
| 13 | A fee edited, or the date moved, then the form resent, answers `TRANSFER_FORM_STALE` | low | reject | Sure compares the persisted state the same way. |
| 14 | An undone transfer's form resent creates a second transfer | low | reject | Sure clears the keys in `destroy!`, with the same outcome. |
| 15 | A fee line later matched elsewhere loses that transfer without its one-time cleanup when undone | low | reject | Rare; `deleteTransaction` deletes a side's transfer the same way. |
| 16 | Switching tabs drops what was typed without the discard confirmation | low | reject | Sure's tabs are links that reload the form, the same loss. |
| 17 | Back from « Virement », the form starts on the tab clicked, not the one used before | low | reject | Cosmetic; the tab clicked is the one shown. |
| 18 | The form opened from an inactive account keeps it as « De » | low | reject | The API now refuses it on `fromAccountId`, shown under the field. |
| 19 | « Vers » offers the source and accounts in another currency | low | reject | Sure's form lists every account too; the refusal shows under the field. |
| 20 | The spec's Approach names `transactions.fee_transfer_id`, the code a table | false | reject | Recorded in the Spec Change Log; behaviour unchanged. |
| 21 | No warning that undoing deletes the fees | low | reject | Sure's own delete warns of nothing more; Story 31.6 brings the transfer drawer. |
| 22 | The viewer's `403` is untested | false | reject | `routes/middleware/roles.spec.ts` walks every mutating route, `POST /api/transfers/new` included. |
| 23 | `same_account`, `exchange_rate_unavailable` and unknown destination or tag are tested in the ledger only | low | reject | The route maps every `AppError` the same way; the route tests cover the mapping. |
| 24 | Reusing an existing « frais » of another case or kind is untested | low | reject | One lookup by `lower(name)`, as Sure's `find_or_create_by!` ignores kind. |
| 25 | e2e covers neither a double submit nor a return to « Dépense » | low | reject | Vitest covers the key; the « Revenu » test covers the tabs. |
| 26 | Statuses disagree and the task list names `transfers.spec.ts` | low | patch | Statuses move to done at finalisation; the Code Map names `transfers-create.spec.ts`. |
| 27 | AD-11's schema list omits `idempotency_key` and `transfer_fees` | low | patch | Both added. |

Second pass, `bmad-code-review`: the three layers above had already reported on this diff, so only its Acceptance Auditor ran.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The fees' category origin is `user` whatever the origin passed | low | patch | `categoryOriginOf(options.origin)`, as every other ledger path. |
| 2 | The matrix's `-5` amount is untested | low | patch | `routes/transfers.spec.ts` checks `not_positive` for it. |
| 3 | The e2e does not assert « Date », « Étiquettes » and « Frais de transfert entrant » show | low | patch | Asserted in `e2e/transfers.spec.ts`. |
| 4 | Sprint status and spec not `done` | low | reject | Set at finalisation, in this pull request. |

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The inflow of a liability payment reads « Paiement depuis », not the story's « Virement depuis »: Sure's `inflow_transaction` uses the same `name_prefix` as the outflow.
- The fee names follow Sure's `"Transfer fee — #{name_prefix} to/from …"`: « Frais de virement — Virement vers Livret » on the source, « Frais de virement — Virement depuis Courant » on the destination.
- The key lives on `transfers`, not on each entry as Sure's `entries.idempotency_key`: Sure needs per-leg suffixes only because its index is per account; one unique column on the transfer gives the same answer, and it goes with the transfer, as Sure clears its keys in `destroy!`.
- The tabs sit at the top of the new-transaction sheet, as Sure's `shared/transaction_type_tabs`, and drive the amount's sign there; an edit keeps the toggle beside the amount.
- `POST /api/transfers/new` beside `POST /api/transfers`, which pairs two lines: one body per route keeps each field error on its field.
- « Montant » rather than Sure's « Montant source »: with one currency there is no destination amount to tell it from.
- The form lists every active account, a bank-linked one included, as Sure's `set_accounts`; the new-transaction form keeps its manual accounts.
- A transfer that loses a side some other way (a side deleted, an account deleted, an import reverted) leaves its fee lines as standard lines, their `transfer_fees` row cascading away; Sure's callbacks delete them. Recorded in `deferred-work.md`.
- The fee link and the key stay out of the export, as Sure's `Family::DataExporter` writes neither.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
