# Epic 27 Context: Consolidate before new features

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Fix what an audit of 2026-10-08 found before any new feature: figures Archant gets wrong, a two-factor code that works twice, assistant answers that are not Sure's, Sure commits not yet mirrored, bank sync failures and open bugs, then review every remaining departure from Sure and tidy the largest files. Sure was read on `origin/main` at `00dd977fb` (8 October 2026). The owner's rule: follow Sure exactly; only money as integer minor units, French text a French user expects, accessibility contrast and security justify a departure. An Archant planning document, an AD-n decision or the API error contract is no reason; where a story is hard because of an old divergence, it aligns with Sure. For the assistant the owner decided « Aligner tout »: every tool answers its Sure function field by field and takes its parameters.

## Stories

- Story 27.1: Confirm the transfers the matcher proposes
- Story 27.2: A paused bill is never overdue
- Story 27.3: Bill totals, order and amounts as Sure shows them
- Story 27.4: A recurring series is never deleted by detection
- Story 27.5: A purchase's fee in its cost basis
- Story 27.6: Count income and expenses as Sure does
- Story 27.7: One-time transactions and Sure's monthly medians
- Story 27.8: A two-factor code works once
- Story 27.9: Assistant answers in Sure's formats, and Sure's accounts and lists
- Story 27.10: Assistant transactions as Sure's
- Story 27.11: Assistant holdings and balance snapshots as Sure's
- Story 27.12: Assistant reports and budgets as Sure's
- Story 27.13: Assistant bills and recurring payments as Sure's
- Story 27.14: Archant's own assistant tools in Sure's shapes
- Story 27.15: Principal and interest in the loan chart, and Sure's chart axis
- Story 27.16: Categories as Sure in the transaction list
- Story 27.17: Edit an account's opening balance
- Story 27.18: Let a sync update a transaction again
- Story 27.19: Every balance a bank sends, and a revoked consent at once
- Story 27.20: A renewal that keeps every account, and a disconnection without the key
- Story 27.21: Revert imports in any order
- Story 27.22: A new pending purchase is never taken for a booked line
- Story 27.23: A tab left open across an upgrade reloads
- Story 27.24: Recurring transfers as Sure follows them
- Story 27.25: Every remaining departure from Sure reviewed
- Story 27.26: Split the largest files and remove duplicates

## Requirements & Constraints

- FR101 to FR106, and the revisions of FR31, FR32, FR35, FR38, FR41, FR64, FR90, FR96 to FR100, NFR2 and NFR19 that `epics.md` records.
- Money stays integer minor units inside (NFR1). Sure's `Money#format` strings and `number_to_percentage` strings are built from integers; an amount Sure takes as a JSON number is read through its decimal text, never as a float.
- No exchange rates exist (AD-6): totals keep counting the reporting currency's accounts and the interface keeps its notice; converting other currencies, as Sure's totals do, stays Later. The assistant's `left_out_count` and `left_out_account_ids` go.
- French text: Sure's `fr.yml` wording wherever it has a key; where Sure falls back to English, the word a French user expects.
- Every story ships tests for its acceptance criteria, Vitest and Playwright as `AGENTS.md` says; each story that changes a row of `docs/sure-parity.md` sets it to Parity.

## Technical Decisions

- Each AD-n a story overturns is edited by that story when it is built, never before: AD-11 (27.1), AD-22 (27.5, 27.6), AD-9 (27.6, 27.7, 27.24), AD-19 and NFR19 (27.9, then 27.10 to 27.14), AD-8 (27.17), AD-10 (27.18), AD-18 (27.19), AD-24 (27.24).
- Transfers (27.1): Sure's `transfers.status`, `pending` from the matcher, `confirmed` by the owner or a hand pair; greedy ranking by `match_rank` then date difference over every unmatched line, replacing mutual uniqueness; 4 days for a proposal, 30 for a confirmed pair. Every existing transfer migrates `pending`, since no column says which ones the matcher made. No label test: Sure has none.
- Bills (27.2, 27.3): one helper says overdue or due only for an active series; `derivedState` stays raw for the matcher. A paused bill's open occurrence reads `"paused"` in tools. Totals sum exact monthly fractions and round once after × 12. Default sort `active`, `ended`, `inactive`; name sort by the stored name, unnamed last, amount ascending in Sure's sign. The list shows the amount; the range shows in the detail panel, the summary and the wide occurrence line. `backfillOccurrences` stays as Sure's `HistoryBackfiller`.
- Recurring (27.4, 27.24): `rekey` never deletes; Sure's cleaner retires a stale series. No transfer side is a candidate of an ordinary series; a recurring transfer has `destination_account_id` and is paid by an outflow of a transfer into it, identity scored 0.40.
- Holdings (27.5): a buy's effective price is its price plus fee divided by quantity; a sale's fee stays out. A partial index on zero-quantity holdings serves `liveCostBasisLocks`.
- Income statement (27.6, 27.7): each line on the side of its sign, loan payments and contributions always expenses; the dashboard's cash flow uses Sure's net view per top-level category; no trade counts; `pea` and `assurance_vie` left out as Sure's tax-advantaged subtypes; a one-time flag as Sure's `one_time` kind; medians as `IncomeStatement::FamilyStats`.
- Two-factor (27.8): a `last_used_step` column on Better Auth's `two_factors`, claimed by a conditional update in a `before` hook on `/two-factor/verify-totp`, through Better Auth's schema option and helpers, never a hand-rolled session (AD-13, NFR6).
- Assistant (27.9 to 27.14): `mcp/tool.ts` holds `formatMoney` (French `Money#format`, non-breaking spaces), `percentage` and `decimalOf`; refusals answer `{ success: false, error, message }` or `{ error, hint }` as a result; `403 insufficient_scope` stays HTTP. Inputs take Sure's names where Sure takes names (`linked_account_names`, `earmarks`, `account_name`), Sure's numbers and Sure's sign with `type` for `create_transaction`, converted to AD-5 at the boundary. `get_transactions` carries only `is_transfer`; transfer details stay on `get_transaction` and `get_transfer_candidates`. Archant's `import_bank_statement` becomes `import_statement_file`, its answer shaped as Sure's `import_bank_statement`. Tools Sure lacks follow Sure's closest function.
- Bank sync (27.19, 27.20): Sure's balance order `CLBD`, `ITBD`, `OPBD`, `PRCD`, `XPCD`, `CLAV`, `ITAV`, with Sure's freshness rule; the session read first and a session-level 401 or 404 asking for renewal; an account a renewal leaves out stays listed; a disconnection without a connector skips the revocation.
- Imports (27.21): `imports` stores the opening shift and the moved-to date at confirm; revert uses them in any order.
- No rate limit on `/api/mcp`: Sure has none for its MCP endpoint; `docs/security-model.md` says the owner's agreement before a write is asked by the assistant and the server cannot verify it.

## UX & Interaction Patterns

- Transfers: Sure's proposal with « Confirmer » and « Rejeter » on a pending transfer, in the sheet and the list.
- Pickers: « Créer « nom » », « Ajouter comme sous-catégorie… », « Créer « nom » dans : », « Retour », « Impossible de créer la catégorie ».
- Locked fields: Sure's folded « Protégée contre la synchronisation » block and « Autoriser la mise à jour par la synchronisation ».
- Opening balance: a « Solde d'ouverture » sheet with « Date », « Valeur du compte à ce jour » and « Mettre à jour la valeur ».
- Loan chart: « Capital : X · Intérêts : Y » under the schedule's balance. Charts take Sure's axis floor of 1.5 % of the mean.
- Day totals leave transfers out; a transfer whose two sides are on the page shows once.

## Cross-Story Dependencies

- Stories 27.1 to 27.8 first, any order, 27.7 after 27.6. Then 27.9, which brings the shared formats, before 27.10 to 27.14; 27.12 after 27.6 and 27.7; 27.13 after 27.2 and 27.3. Stories 27.15 to 27.24 in any order, 27.17 after 27.9, 27.24 after 27.6. Story 27.25, documents only, after those. Story 27.26 last, after 27.14, since it splits `schemas/assistants.ts`.
- Stories 27.9 to 27.14 each edit `mcp/server.ts`, `docs/deployment.md` « Connecting an assistant » and `docs/security-model.md` « Assistants »: one at a time.
- Outside the epic: Epic 5's transfers, Epic 22's holdings, Epic 23's bills, Epics 16 and 26's tools, Epic 10's Enable Banking connector.
