# Epic 31 Context: Transactions and transfers as Sure

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Bring Archant's transactions and transfers back to Sure's behaviour (Sure at `00dd977fb`, `~/github/sure`): Sure's status and single-amount filters, Sure's bulk edit, split lines entered, listed, locked and matched as Sure does, a download button per attachment, transfers created from the new-transaction form with fees, a transfer opening its own drawer, the « Contributions aux investissements » category on contributions, and a split edit that recreates its lines. Story 27.25's review of `docs/sure-parity.md` found these departures in « Transactions » and « Transfers » without an admitted reason. The owner's rule holds: follow Sure exactly; only money as integer minor units, French text a French user expects, accessibility and security justify a departure. Archant keeps « virement » where Sure's `transfers` views say « transfert », as Sure's own `transactions.form.transfer` does. No new FR; the epic is parity work.

## Stories

- Story 31.1: Filter transactions by status and amount
- Story 31.2: Edit several transactions at once as Sure
- Story 31.3: Split lines as Sure shows and edits them
- Story 31.4: Download an attachment
- Story 31.5: Create a transfer between two accounts
- Story 31.6: Open a transfer in its own drawer
- Story 31.7: Categorise investment contributions
- Story 31.8: Edit a split by recreating its lines

## Requirements & Constraints

- Each story names the Sure file it mirrors (`transaction/search.rb`, `entry_search.rb`, `transactions/bulk_updates_controller.rb`, `Entry.bulk_update!`, `splits/new.html.erb`, `splits_controller.rb`, `User#show_split_grouped?`, `transactions/show.html.erb`, `transactions/_attachments.html.erb`, `TransactionAttachmentsController#show`, `transfer/creator.rb`, `transfers/_form.html.erb`, `transfers/show.html.erb`, `Family::AutoTransferMatchable`, `Family#investment_contributions_category`). Read it before building and match its fields, order, words and refusals, not only its outcome.
- Visible text uses Sure's `fr.yml` wording where a key exists; the bulk drawer uses the transaction drawer's « Étiquettes » and « Notes », not Sure's bulk « Balises » and « Remarques ». Sure's English line names (« Transfer to », « Payment to », « Transfer fee ») become « Virement vers », « Paiement vers », « Virement depuis », « Frais de virement ».
- Money is integer minor units: the amount filter compares absolute values in minor units (equal means within one cent), split amounts are signed integers summing exactly to the parent, transfer and fee amounts never pass through a float.
- Roles: every write is admin-only through `viewerReadOnly`; the interface hides write controls when `useIsAdmin()` is false. A viewer downloads an attachment (a read) and sees the transfer drawer without any control that writes.
- API changes replace, not add: `GET /api/transactions` takes `status`, `amount`, `amountOperator` instead of `amountMin`/`amountMax`; the assistant's `get_transactions` takes Sure's `statuses`, `amount`, `amount_operator`; `POST /api/transactions/bulk-update` takes `date`, `name`, `notes`, `categoryId`, `merchantId`, `tagIds` and no `excluded`; `PUT /api/transactions/:id/split` ignores line ids.
- Every story ships Vitest and Playwright tests for its acceptance criteria and sets its `docs/sure-parity.md` row (« List, search, filters », « Bulk edit », « Split interface », « Attachments », « Creating a transfer », « Category of a transfer side », « Automatic « Investment contributions » category », « Splits »).

## Technical Decisions

- AD-2: only `services/ledger/` writes transactions, splits, transfers, taggings and attachments; routes and the assistant call ledger functions.
- AD-10 locks: bulk edit locks every field it saves with `origin: "user"`, as Sure's `lock_saved_attributes!`; transfer tags set from the drawer are locked on both sides.
- AD-11 transfers: kind from `Transfer.kind_for_account`; a pair by hand is `confirmed`. Story 31.3 makes a split line a transfer candidate (Sure leaves out only excluded entries; the excluded parent stays out); Story 31.5 adds creation of both sides in one database transaction, with an idempotency key so a double submit returns the first transfer, and fee lines linked to the transfer; deleting a transfer deletes its fee lines, never its two sides. Accounts in different currencies are refused until exchange rates exist (AD-6). AD-11 is edited in `docs/architecture.md` with 31.3 and 31.5.
- AD-20 splits: children sum exactly to the parent, which is excluded and locked. Story 31.3 lets a child be a transfer candidate; Story 31.8 replaces « edit updates the children it keeps by id » with Sure's `unsplit!` then `split!`: every line deleted and recreated in one transaction, new ids, name, amount and category from the form, merchant and kind from the parent, old tags, notes, attachments and locks gone, a line's transfer deleted with it. A split line's label, date, amount, category and merchant are read-only; `PATCH /api/transactions/:id` refuses a label or category on a line. Bulk edit skips a split parent and applies every field but the date to its lines.
- AD-12: « Contributions aux investissements » (colour `#0d9488`, icon `trending-up`) is created on first need, also after the owner deleted it; an outflow already categorised keeps its category. AD-12 is edited with Story 31.7.
- Story 31.6 adds a `transfers.notes` column (Drizzle migration); « Catégorie » applies to the outflow only when `Transfer#categorizable?` holds.
- Story 31.3 adds a per-user « Grouper les transactions fractionnées » setting, on by default.
- Story 31.4: `?disposition=attachment` sends `Content-Disposition: attachment` with the cleaned file name; both dispositions stay under `attachmentContentSecurityPolicy`.

## UX & Interaction Patterns

- Filter bar: « Statut » with checkboxes « Confirmée » and « En attente » (both or none means no filter); « Montant » with « Égal à » (default), « Supérieur à », « Inférieur à » and one amount; the min/max range goes. Filters stay in the URL; the count and filtered total follow.
- Bulk bar: « Modifier » opens the drawer « Modifier les transactions » (« Date », « Nom », « Catégorie », « Marchand », « Étiquettes », « Notes », « Annuler », « Enregistrer »); an empty field changes nothing; an untouched « Étiquettes » keeps tags, a touched one replaces the set. The bar's category, merchant, tags and exclusion controls go; « Supprimer » stays with its confirmation.
- Split dialog: signed amount per line, the « Dépense » / « Revenu » toggle goes, the remaining counter and disabled submit stay.
- Attachments: each file shows an open button (new tab) and a download button.
- New-transaction form: « Virement » beside « Dépense » and « Revenu », asking « De », « Vers », « Date », « Montant », « Étiquettes », and a folded « Frais bancaires » with « Frais de transfert sortant » and « Frais de transfert entrant ».
- Transfer drawer: amount and name; « Aperçu » with « De » / « À », account, date, « Montant du virement », « Frais d'origine » / « Frais de destination » and « Total » when a fee exists; « Détails » with « Catégorie » (« Non classé » when blank), « Étiquettes », « Notes »; « Paramètres » with « Marquer comme récurrent » (moved from Story 27.24) and delete confirmed by « Voulez-vous vraiment supprimer ce virement ? ».

## Cross-Story Dependencies

- 31.1 to 31.6 and 31.8 come in any order. 31.7 waits for Story 32.2 (backlog), which brings Sure's default categories. 31.6 shows a fee only once 31.5 records one.
- 31.3 and 31.8 both rewrite AD-20 and the split code (`services/ledger/splits.ts`, transfer matching); build them one at a time. 31.5, 31.6 and 31.7 all touch transfers and AD-11; same rule.
- 31.6 hosts « Marquer comme récurrent » from Story 27.24 (done).
