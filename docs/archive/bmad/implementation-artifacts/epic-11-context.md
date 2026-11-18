# Epic 11 Context: Reliability and first-use fixes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make every figure Archant shows trustworthy with real bank data, and let a first-time user get from `git clone` to a connected bank without reading code. The epic adds no new requirement. Stories 11.1 to 11.8 each fix a bug recorded in `_bmad-output/implementation-artifacts/deferred-work.md`, found after Epic 10 while comparing Archant with Sure (`docs/sure-parity.md`). Stories 11.9 to 11.14 act on the owner's manual QA of 2026-09-25 (`manual-qa-scenarios.md`): each makes something existing easier to find or use, or removes something the owner does not want. The sync stories (11.4 to 11.7) land before a real bank is connected. Differences with Sure marked « No decision recorded » in `docs/sure-parity.md` stay out of scope; where Sure's behaviour settles a design question, the story follows Sure.

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

- Hardens account creation and opening balance, import revert, transfer matching and kinds, monthly cash flow, recurring detection, bank sync, pending transactions, deduplication and the bank balance as reference. Eases account editing, merchants, tags, rules and the Enable Banking setup. Withdraws the command palette and single-key shortcuts.
- An import or a sync is atomic per account: a failure writes nothing for that account, other accounts still sync. Money is integer minor units plus a currency, never a float.
- Provider keys and tokens are encrypted at rest, never logged, never returned by an endpoint. Logs never carry an amount tied to an identity, an IBAN or a token.
- Every visible string goes through the French translation layer; an error code is translated from `errors.<CODE>` and never shown alone.
- The interface stays usable with the keyboard alone (`Tab`, arrow keys, `Esc` closes, `⌘Enter` saves the transaction sheet), with visible focus and WCAG 2.2 AA contrast, once single-key shortcuts are gone.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest. No test reaches the network; branch coverage stays at 100% on `domain/**`, `services/ledger.ts` and `connectors/**`.
- A new dependency is justified in the pull request; a dependency no code uses any more leaves `package.json` and `docs/tech-stack.md`.
- A story that changes a documented rule updates it in place: the architecture spine, `EXPERIENCE.md`, `docs/deployment.md`, `docs/sure-parity.md`, or UX-DR7 in `epics.md` (marked withdrawn by Story 11.13).

## Technical Decisions

- Layers: a route parses with Zod and calls one service; only services touch the database; domain stays pure. Work after a commit, such as recurring detection, is called by the service and its failure is logged, never failing the request.
- Only `services/ledger.ts` writes `entries`, `transactions`, `entry_keys`, `deleted_entry_keys`, `balances`, `transfers` and `rejected_transfers`, and only it deletes an account. Each ledger call carries an `origin` and runs in one `immediate` transaction that recomputes balances.
- Ingestion order per account: reject before the opening anchor (`BEFORE_OPENING_DATE`), key matching, pending reconciliation, insert, rules, transfer matching, statement balance, recompute. "Today" is computed in `APP_TIMEZONE` (default `Europe/Paris`).
- Dedup keys: `fp:` fingerprint plus `ext:<entry_reference>`, unique per `(account_id, source, key)`, never recomputed. A revert deletes its keys, deletes an entry only if no other source's key remains, and never deletes a valuation it did not create. Deleting an entry moves its bank keys to `deleted_entry_keys` as a tombstone; file keys are simply deleted.
- Valuations: one `opening_anchor` per account; a `reconciliation` fixes an end-of-day balance in both directions; a bank-linked account computes backward from its `current_anchor`. A superseded earlier-day anchor becomes a `reconciliation` keeping its id, so bank figures form a chain (Sure's `Account::CurrentBalanceManager`). Pending entries count in no balance.
- Entry identity is stable: `ledger.absorb` keeps the survivor's id and moves keys, taggings, transfers and recurring links. A pending entry missed by syncs on two different days is deleted; a line the sync refused still vouches for its entry.
- Enable Banking: a sync reads from the last success minus 7 days, retries `WRONG_TRANSACTIONS_PERIOD` with 89, 60 then 30 days, reads the balance apart after a complete read (`BANK_BALANCE_UNAVAILABLE` keeps the anchor), drops repeated lines and pending lines whose booked version is listed, and holds a 10-minute lease (`409 SYNC_IN_PROGRESS`). Consent asks for the bank's maximum capped at 90 days, less 60 seconds.
- Transfer candidates: opposite amount, different account, same currency, within 4 days, unmatched, not excluded, both accounts active, pair not rejected; automatic matching needs mutual uniqueness.
- Cash flow is defined once in `domain/cash-flow.ts` (`countsInCashFlow`, `direction`); the outflow side of a `loan_payment` or `investment_contribution` counts as an expense.
- Secrets use AES-256-GCM in `services/crypto.ts` with `ENCRYPTION_KEY`, stored as `v1:<iv>:<tag>:<ciphertext>`. Enable Banking credentials are saved from « Réglages › Banques » into `settings` (`enable_banking_application_id` plain, `enable_banking_private_key` encrypted PKCS#8) after a signed `GET /application` check; `ENABLE_BANKING_APPLICATION_ID` and `ENABLE_BANKING_PRIVATE_KEY`, both or neither, win over them. `services/bank-credentials.ts` resolves the connector per request; an active connection locks the credentials (`BANK_CREDENTIALS_LOCKED`). The spine and the « Connecting a bank » section of `docs/deployment.md` record where they live, and the `#connecting-a-bank` anchor stays.
- API: `{ data }` or `{ error: { code, message, fields?, params? } }`; new codes join the closed `AppError` union in `packages/api/src/lib/errors.ts`; request schemas live in `packages/api/src/schemas/`; env goes through `validateEnv`, every variable in `.env.example`.
- The API listens on `PORT`; in development Vite proxies `/api` to 8787. The local database is `local.db` at the repository root, created and migrated when the API starts.

## UX & Interaction Patterns

- French, formal « vous », infinitive-verb buttons, no exclamation marks. An error says what happened and what to do.
- Combobox pickers filter as you type, move with arrows, pick with `Enter`, and offer « Créer "…" » as the last option; in the rule dialog, category does too. A merge target offers no « Créer ».
- Account actions (Modifier, Exclure des rapports, Désactiver, Supprimer le compte) sit in the « … » menu beside the account name; there is no « Paramètres » tab.
- Settings live under `/settings/...` (Banques, Catégories, Marchands, Étiquettes, Sécurité); URLs stay English.
- A destructive confirmation states what is lost with counts, repeats the verb on the button, and focuses Annuler first.
- Dialogs and sheets stack one level deep at most; `Esc` closes the top layer and returns focus to what opened it.
- Network or server errors show a destructive toast with the translated message; a failed optimistic update rolls back.

## Cross-Story Dependencies

- Builds on Epic 2's import pipeline and revert, Epics 5 and 7's transfers and kinds, Epic 6's reports, Epic 9's recurring detection, and Epic 10's sync, pending reconciliation and consent flow.
- Stories 11.4 to 11.7 all touch `services/sync.ts` and the ledger's sync path; they go in order.
- Story 11.10 renamed `packages/web` to `packages/app` (`@archant/app`, `pnpm app`); later stories use the new paths, and `_bmad-output/` keeps its history as written.
- Story 11.13 removes the palette and shortcuts that Story 1.8 and the `x` selection of Story 4.5 added; the bulk selection itself stays through checkboxes.
- Story 11.14 reuses Epic 10's crypto service and connection model, and refuses a credential change while any bank connection exists.
- Epic 12, the visual refresh, assumes the interface as this epic leaves it.
