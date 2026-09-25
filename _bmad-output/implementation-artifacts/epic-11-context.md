# Epic 11 Context: Reliability and first-use fixes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every figure Archant shows must be trustworthy with real bank data, and a first-time user must get from `git clone` to a connected bank without reading code. The epic adds no new requirement: stories 11.1 to 11.8 each fix a bug recorded in `_bmad-output/implementation-artifacts/deferred-work.md`, found after Epic 10 while comparing Archant with Sure (`docs/sure-parity.md`); stories 11.9 to 11.14 act on the owner's manual QA of 2026-09-25 (`manual-qa-scenarios.md`), making existing things easier to find or use, or removing what the owner does not want. The sync stories (11.4 to 11.7) must land before a real bank is connected. Differences with Sure marked « No decision recorded » in `docs/sure-parity.md` stay out of scope; where Sure's behaviour settles a design question, the story follows Sure.

## Stories

- Story 11.1: Opening dates that accept today and survive a revert
- Story 11.2: Transfer matching ignores excluded transactions and inactive accounts
- Story 11.3: The category of a loan payment or an investment contribution
- Story 11.4: A bank read survives a partial failure
- Story 11.5: Pending and booked versions never count twice
- Story 11.6: A transaction I delete stays deleted
- Story 11.7: A synced account keeps each bank balance it received
- Story 11.8: Recurring series stay single and current
- Story 11.9: A first start that says what is wrong
- Story 11.10: The interface package is named app
- Story 11.11: Account actions in the account's menu
- Story 11.12: Create tags, merchants and categories where they are picked
- Story 11.13: No command palette and no single-key shortcuts
- Story 11.14: Enable Banking set up from the interface

## Requirements & Constraints

- Hardens existing behaviour for account creation and opening balance, import revert, transfer matching and kinds, monthly cash flow, recurring detection and listing, bank sync, pending transactions, file and bank deduplication, and bank balance as reference.
- A sync or import stays atomic per account: a failure writes nothing for that account, other accounts still sync.
- Provider keys and tokens are encrypted at rest, never logged, never returned by an endpoint. Logs never carry an amount tied to an identity, an IBAN or a token.
- Every visible string goes through the French translation layer; error codes are translated from `errors.<CODE>` and never shown alone.
- The interface stays usable with the keyboard alone (`Tab`, arrows, `Esc`, `⌘Enter` in the sheet) and meets WCAG 2.2 AA, even once single-key shortcuts are removed.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest. No test reaches the network; money paths stay covered to the branch (100% on `domain/**`, `services/ledger.ts`, `connectors/**`).
- A new dependency needs a justification; a dependency no code uses any more is removed from `package.json` and `docs/tech-stack.md`.

## Technical Decisions

- Layering: routes call one service; only services touch the database; domain stays pure. Only `services/ledger.ts` writes `entries`, `transactions`, `entry_keys`, `balances`, `transfers` and `rejected_transfers`, and deletes accounts. Every ledger call carries an `origin` and runs in one `immediate` transaction that recomputes balances.
- Ingestion pipeline order per account: reject before opening anchor (`BEFORE_OPENING_DATE`), key matching, pending reconciliation, insert, rules, transfer matching, statement balance, recompute. "Today" is computed in `APP_TIMEZONE` (default `Europe/Paris`).
- Dedup keys: `fp:` fingerprint plus `ext:<externalId>` (Enable Banking `entry_reference`, never `transaction_id`), unique per `(account_id, source, key)`, never recomputed. Revert deletes the keys an import wrote and an entry only if no other source's key remains; it never deletes a valuation it did not create.
- Valuations: one `opening_anchor` per account; `reconciliation` fixes an end-of-day balance in both directions; a bank-linked account computes backward from its `current_anchor`. Story 11.7 turns each superseded `current_anchor` into a `reconciliation` (as Sure's `Account::CurrentBalanceManager`) and must update AD-8 in the architecture spine accordingly.
- Entry identity is stable: `ledger.absorb` keeps the survivor's id and moves keys, taggings, transfers and recurring links. Pending misses are counted in `transactions.pending_missed_syncs`.
- Transfer candidates: opposite amount, different account, same currency, within 4 days, unmatched, pair not rejected; automatic matching needs mutual uniqueness. Excluded transactions and inactive accounts must be removed from the candidate set (Sure's `Family::AutoTransferMatchable`).
- Cash flow is defined once in `domain/cash-flow.ts` (`countsInCashFlow`, `direction`) and used by every report and the list's direction filter; the outflow side of `loan_payment` or `investment_contribution` counts as an expense.
- Enable Banking: sync reads from last success minus 7 days; lease on `bank_connections.sync_started_at` (10 min, `409 SYNC_IN_PROGRESS`); JWT RS256 via `jose`, key through `crypto.createPrivateKey`. Secrets use AES-256-GCM in `services/crypto.ts` with `ENCRYPTION_KEY`, stored as `v1:<iv>:<tag>:<ciphertext>`. Story 11.14 adds credentials stored this way, with environment variables taking precedence, and records their location in the spine and in `docs/deployment.md` (keep the `#connecting-a-bank` anchor).
- Recurring detection runs after commit, called by the service; its failure is logged and never fails the request.
- API conventions: `{ data }` / `{ error: { code, message, fields?, params? } }`; new codes join the closed `AppError` union in `packages/api/src/lib/errors.ts`; request schemas in `packages/api/src/schemas/`; env through `validateEnv`, every variable in `.env.example`.
- The API serves on `PORT`; in development Vite proxies `/api` to 8787. The local database is `local.db` at the repository root, created and migrated at API start.

## UX & Interaction Patterns

- French, vouvoiement, infinitive-verb buttons, no exclamation marks. Errors say what happened and what to do.
- Combobox pickers (category, merchant, tags) filter as you type and offer « Créer "…" » as the last option; the rule dialog's pickers must behave the same.
- Settings live under `/settings/...` (Banques, Catégories, Marchands, Étiquettes, Sécurité). URLs stay English.
- Destructive confirmations state what is lost with counts, repeat the verb on the button, and focus Annuler first.
- Dialogs and sheets stack one level deep at most; `Esc` closes the topmost layer and returns focus.
- After Story 11.13, `EXPERIENCE.md` must describe the interface without the command palette, `g` navigation and single-key shortcuts, and UX-DR7 is marked withdrawn in `epics.md`.

## Cross-Story Dependencies

- Builds on Epic 2's import pipeline and revert, Epic 5 and 7's transfers and kinds, Epic 6's reports, Epic 9's recurring detection and Epic 10's sync, pending reconciliation and consent flow.
- Stories 11.4 to 11.7 all touch `services/sync.ts` and the ledger's sync path; they are best done in order to avoid conflicting edits.
- Story 11.10 renames `packages/web` to `packages/app` (`@archant/app`, `pnpm app`) across the Dockerfile, CI, Playwright config, `AGENTS.md`, `README.md` and `docs/`; stories landing after it use the new paths.
- Story 11.14 reuses Epic 10's crypto service and connection model, and refuses credential changes while any bank connection exists.
- Epic 12 (visual refresh) follows and assumes the interface as left by this epic.
