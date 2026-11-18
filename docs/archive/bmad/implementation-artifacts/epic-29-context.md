# Epic 29 Context: Bank synchronisation as Sure

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Bring Archant's Enable Banking synchronisation back to Sure's behaviour: credentials saved with their country and removable, the longest consent the bank grants with Sure's step-down, Sure's retries on a refused period and on a statement cut short, bank labels cleaned and merchants created from counterparties, lines without direction kept as money out, pending lines settled and merged as Sure, one account unlinked at a time and then computed forward, and syncs run at a chosen daily time, on demand, with the PSU address where the bank asks for it. Story 27.25 reviewed `docs/sure-parity.md` against Sure `00dd977fb` and found these departures without an admitted reason. The owner's rule holds: follow Sure exactly; only money as integer minor units, French text a French user expects, accessibility contrast and security justify a departure. An Archant planning document or an AD-n decision is no reason to keep a divergence. No new FR; the epic is parity work.

## Stories

- Story 29.1: Choose the bank's country with the credentials, and remove them
- Story 29.2: Ask for the bank's longest consent and step down on refusal
- Story 29.3: Retry from the bank's suggested start, and keep a statement cut short
- Story 29.4: Clean bank labels and create merchants from counterparties
- Story 29.5: Read a line without direction as money out
- Story 29.6: Settle pending lines as Sure
- Story 29.7: Suggest and merge pending duplicates
- Story 29.8: Unlink one bank account
- Story 29.9: Sync at the chosen time, on demand, with the PSU address
- Story 29.10: Recompute an unlinked account's history forward

## Requirements & Constraints

- Each story names the Sure file or method it mirrors (`provider/enable_banking.rb`, `enable_banking_item/importer.rb`, `enable_banking_entry/processor.rb`, `account/provider_import_adapter.rb`, `accounts_controller.rb#unlink`, `account/syncer.rb`, `auto_sync_scheduler.rb`); read Sure at `00dd977fb` (`~/github/sure`) before building, and match its order, words, thresholds and refusals, not only its outcome.
- Visible text uses Sure's `fr.yml` wording where a key exists, else the word a French user expects.
- Money stays integer minor units (NFR1): the pending match compares amounts and currency exactly; the fuzzy duplicate bands (up to 30 %, 30 % to half) compare minor units.
- Roles: every write is admin-only through `viewerReadOnly`; the interface hides write controls for a viewer (`useIsAdmin()`).
- Security: credentials, session ids and the stored PSU IP address are never logged nor returned; the PSU address is cleared once the consent ends. A provider response is still parsed by Zod, error bodies included (`detail.date_from`, N26's `PERIOD_INVALID`).
- `.env.example` lists every new variable with what happens without it (`ENABLE_BANKING_CONSENT_DAYS`, 180 by default, a non-positive or non-integer value ignored).
- No test reaches the network: Enable Banking calls are mocked, including refusals and partial pages.
- Every story ships Vitest and Playwright tests for its acceptance criteria, and sets each `docs/sure-parity.md` row it changes to Parity.

## Technical Decisions

- AD-18 (Enable Banking specifics) is the decision most stories rewrite, each with its own story, never before: consent ladder (29.2), refused period and partial pages (29.3), only `CRDT` is money in (29.5), pending window and keeping (29.6), schedule, removed hour between syncs and PSU headers (29.9). AD-17 changes with 29.6, AD-8 with 29.10. `packages/api/src/architecture-references.spec.ts` checks cited AD-n headings.
- Ingestion keeps AD-4's single pipeline (`services/ledger/ingest.ts`) and AD-2's rule that only `services/ledger/` writes money rows; pending matching stays step 3, through `absorb` in `services/ledger/pending.ts`, which keeps entry ids stable (AD-17).
- Pending (29.6): a booked line no key matches claims a pending entry of the same amount and currency dated 0 to 8 days before it, keeping the pending date; the 5-days-either-way rule, the two-miss deletion and the `transactions.pending_missed_syncs` / `pending_missed_on` columns go, and the window no longer reaches back to the oldest pending entry. A household switch, on by default, leaves `PDNG` lines out.
- Merge (29.7): the booked line survives, keeps its label and merchant, takes the pending category and date unless locked, and is locked (AD-10); attachments, tags and notes move onto it, a deliberate fix over Sure's loss (we-promise/sure#4220).
- Merchants (29.4): created on first sight from the counterparty and found again by name; a user-set merchant stays. Label normalisation stays in `domain/normalize-label.ts`; the raw remittance goes to notes.
- Consent (29.2): bank maximum capped at `ENABLE_BANKING_CONSENT_DAYS`, less 60 seconds; on a consent-validity `WRONG_REQUEST_PARAMETERS`, retry 180, 90, 45, 30 days shorter than the first try; any other refusal fails at once.
- Period (29.3): retry every page from `detail.date_from` first, then 89, 60, 30 days; a 400 or 422 on page two or later ingests the pages read and counts the account synced.
- Sync (29.9): an in-process timer at the chosen time in `APP_TIMEZONE`; the first-request-of-the-day sync and `POST /api/sync` stay; `SYNC_TOO_RECENT` and the one-hour gap go, only the lease (`409 SYNC_IN_PROGRESS`) makes the button wait.
- Unlink (29.8, 29.10): one account turns manual while its connection keeps syncing; once not linked it is computed forward from its opening anchor, every bank valuation, the last balance included, setting its own day, and no reconciliation is written on disconnect or unlink.
- Removing credentials (29.1) disconnects every connection first, accounts kept as manual; credentials from `ENABLE_BANKING_*` variables cannot be removed from the interface.

## UX & Interaction Patterns

- « Réglages › Banques » credentials form: « Pays » first, Sure's 31 countries, placeholder « Sélectionner le pays... »; locked with the rest under « Configuration verrouillée » while a bank is active; « Supprimer » confirms « Voulez-vous vraiment supprimer cette connexion ? ». The bank picker then asks no country.
- « Inclure les transactions en attente » switch; « Activer la synchronisation automatique » and « Heure de synchronisation (HH:MM) », 02:22 by default.
- Pending duplicate: « Doublon possible détecté » badge, the large-gap tooltip, « Oui, fusionnez-les », « Non, gardez les deux » (dismisses for good), « Ouvrir la fusion » listing booked lines ten at a time.
- Linked account menu: « Délier du fournisseur » opens « Délier le compte du fournisseur ? » with Sure's four warnings and « Confirmer et délier »; toast « Compte délié avec succès. C'est maintenant un compte manuel. » A manual account offers no unlink.
- A line without direction and without any text reads « Virement sortant ».

## Cross-Story Dependencies

- Stories 29.1, 29.2, 29.4, 29.5, 29.6, 29.8, 29.9 and 29.10 in any order. 29.3 after 29.6, since 29.6 removes pending misses. 29.7 after 29.4 and 29.6: its suggestions read the merchant 29.4 creates and the pending lines 29.6 keeps.
- Several stories edit AD-18 and the Enable Banking connector and sync service; build them one at a time to avoid conflicts. 29.10 edits AD-8 and `services/ledger/bank-link.ts`, which 29.8's unlink relies on.
- No story waits on another epic. 29.4 also settles « Merchants from the bank » in `docs/sure-parity.md` « Classification ».
- Builds on Epic 28's balance work (Stories 28.17 to 28.20: backward pass, bank balance dated today, reconciliation chain) and Epic 27's Enable Banking balance selection (27.19).
