# Review of every remaining departure from Sure (Story 27.25)

Read on 2026-10-12, after Stories 27.1 to 27.24 and 27.27, against Sure `origin/main` at `00dd977fb` (8 October 2026). Sure has 47 newer commits; they are out of this pass.

Every row of `docs/sure-parity.md` marked Different, Dropped, « No decision recorded » or mixed was read against the four admitted reasons: (1) money as integer minor units, (2) French text a French user expects, (3) accessibility contrast, (4) security. Later rows stay Later; they are already planned back. Line numbers are those of `docs/sure-parity.md` at commit `6b42fb23`.

Verdicts:

- **R1–R4**: the departure stays; the row cites the admitted reason.
- **S-n**: the departure becomes story S-n of the catalogue below, in a later epic of `epics.md`.
- **D-n**: the departure is decision D-n listed for the owner (section « Decisions for the owner »).
- **Fix**: the row is stale or wrong; it is rewritten as stated, no story and no decision.

A row gets one verdict per sub-difference; a sub-difference is never both a story and a decision.

## Verdicts by row

### Product-wide differences

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 31 | Tenancy | D-1 | A `Family` per sign-up means hosting several households, a non-goal of `AGENTS.md`. |
| 32 | Runtime | D-2, Fix | Internal. Text wrong: the day's sync runs after the response, not inside the request. |
| 33 | Sign of amounts | D-2 | Storage only: Sure displays `-entry.amount`; `sureAmount` (`services/export.ts:145`) and the assistant answer in Sure's sign. |
| 34 | Money | R1 | Cite reason 1 instead of AD-6. |
| 35 | Interface language, French | R2 | |
| 35 | No locale selector | D-1 | Nineteen other locales serve no French household; i18next keeps the door open. |
| 37 | Visual design | D-3, Fix | Text wrong: the font is Inter (`styles.css:22`), the primary button indigo `#5e6ad2` (`styles.css:101`). Inset `#F2F2F3` and category chip contrast are R3. |
| 38 | Preferences | S-36.6, Fix | Sure's time zone, date format, currency, country and `month_start_day` are household settings; only `locale` is per user. |

### Users and access

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 45 | First user through `/setup` | D-1 | Sure's open sign-up creates a family per user. Sure's onboarding preference choices join S-36.6. |
| 46 | Password reset | S-36.1 | Sure self-hosted mails the link over SMTP (`password_resets_controller.rb:13-20`). |
| 47 | Roles | S-36.2, Fix | Sure's `guest` is read-only at `00dd977fb` (`require_non_guest!`); « still edits categories and rules » is wrong. Sure's `member` is missing. |
| 47 | Guest layout | S-36.3 | `ui_layout: intro` (`user.rb:753-765`). |
| 48 | Members, admin changes roles | D-1 | Only Sure's `super_admin`, the instance operator, changes a role; Archant's administrator is both. |
| 50 | Per-account sharing | S-36.4 | Inside one household (`account_share.rb`). |
| 51 | Password asked to turn two-factor off | R4 | Sure does not ask (`mfa_controller.rb:126`). |
| 51 | Backup codes | S-36.5 | Sure: 8 codes of 16 hex characters, no regeneration. |
| 51 | Passkeys | S-36.7 | `webauthn_credentials`, `passkey_sessions_controller.rb`. |
| 52 | OpenID Connect | S-36.8 | `oidc_accounts_controller.rb`, `AuthConfig`. |
| 53 | Impersonation, invite codes, Stripe | D-1 | Hosted product and open sign-up, non-goals. |

### Accounts

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 59 | `cash`, `cd`, `money_market`, empty subtype | S-28.1 | |
| 59 | `hsa` | D-1 | US tax product. |
| 60 | Card details; « balance is available credit » toggle | S-28.2 | `credit_cards/_form.html.erb`, `enable_banking_account/processor.rb:98-140`. |
| 61 | Loan chart periods, greyed line past the cursor | S-28.3 | A Recharts limit is no reason. |
| 61 | « Prudent » in income green | R3 | |
| 61 | Two cards per row on a phone | D-3 | Reflow, not contrast. |
| 61 | Loan subtype names | R2 | |
| 61 | Term or rate out of bounds refused | S-28.4, Fix | Not security: Sure saves and does not amortise. |
| 61 | Bank debits moving a loan balance (Later) | Fix | Sure does not; « Not in Sure, not planned ». |
| 62 | EU and generic investment subtypes | S-28.5 | |
| 62 | US, UK, CA, AU, IN subtypes | D-1 | No French product. |
| 62 | Yahoo only | D-2 | Sure's other providers need a key. |
| 62 | Prices fetched on first visit and by button | D-2 | No queue. |
| 62 | Seven provisional days; prices kept offline | D-2 | |
| 62 | Prices and quantities in millionths | R1 | |
| 62 | Trade in another currency refused | Later | AD-6, exchange rates. |
| 62 | Sale above the quantity held refused | S-28.6 | Sure caps the cost basis and lets quantity go negative. |
| 62 | Manual security by ISIN | D-4 | Addition: the ISIN is the only identifier of an assurance-vie fund. |
| 62 | Search, `MC.PA`, prices from the first trade | D-2 | |
| 62 | Holdings computed forward only | Fix | No investment account can be linked; Parity. |
| 62 | Recalculation on price import; `Holding` without `id` in export | D-2 | |
| 62 | Cost basis lock in its own table | D-2 | |
| 62 | No delete or remap on a position | S-28.7 | |
| 62 | Price entered by hand without a provider | D-4 | Addition. |
| 63 | Four property subtypes | S-28.8 | They have French names. |
| 63 | Address, area, year built, overview tab | S-28.8 | |
| 63 | Automatic valuation | D-1 | Rentcast and Realie cover the United States only: Dropped. |
| 64 | Vehicle make, model, year, mileage, overview | S-28.8 | |
| 65 | Other asset, other liability (Later) | S-28.10 | No reason recorded. |
| 65 | Crypto (Later) | S-28.11 | |
| 66 | Inactive accounts hidden behind a toggle | S-28.12 | Sure lists them muted. |
| 67 | Synchronous deletion | D-2 | |
| 68 | Default account | S-28.13 | |
| 68 | Account order | S-28.14 | |
| 68 | Notes, institution name and domain | S-28.15 | Brandfetch logo: R4, see line 172. |
| 69 | Creation wizard | S-28.16 | |

### Entries and balances

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 77 | Forward-only nuance | Fix | No linked investment; Parity. |
| 78 | Linked account opening balance | S-28.17 | `Balance::ReverseCalculator#use_opening_anchor_for_date?`. |
| 80 | Property and vehicle outside cash | S-28.9 | `Account#balance_type` `:non_cash`. |
| 81, 82 | Current anchor date; older statement moves the anchor | S-28.18 | Sure dates it today and records older balances as reconciliations. |
| 82 | One anchor per day | D-2 | |
| 85 | Opening date forced before the oldest line; future date refused on an empty account | S-28.20 | Since Story 27.21 nothing forces the refusal. |
| 85 | Linked account sheet opens nothing | S-28.17 | |
| 85 | No confirmation step | S-28.19 | `valuations_controller#confirm_create`. |
| 87 | Notes saved by « Enregistrer » | D-3 | Follows the dialog choice. |
| 88 | More decimals than the currency refused | R1 | |
| 88 | Future date and unknown `account_id` errors | S-28.20 | |
| 89 | Vertical axis labels | S-34.2 | Sure draws none. |

### File import

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 95 | OFX | D-4 | Addition; French banks export it. |
| 95 | Sure export import | S-30.1 | |
| 95 | Mint, YNAB, Actual | S-30.2 | |
| 95 | AI-parsed PDF | D-5 | Needs a language model provider. |
| 96 | Account, category, merchant, rule, trade imports | S-30.3 | |
| 96 | Import sessions API | D-1 | Sits on the public REST API (line 251). |
| 97 | Mapping by index, several label columns, debit/credit | D-4 | Additions. |
| 97 | Currency, category, tags, account, type-column sign, `rows_to_skip` | S-30.4 | |
| 98 | Number formats | Fix | Comma or point decimal covers Sure's four `NUMBER_FORMATS`: Parity. |
| 98 | Date formats and guess | S-30.4 | |
| 99, 102 | Clean step; grouped preview against the row table | S-30.5 | |
| 100 | FITID or fingerprint keys, file and bank convergence | D-6 | Sure's key brings back duplicates on a re-import or a CSV overlapping a sync. |
| 100 | Matched line updates category, tags, notes | S-30.4 | |
| 101 | QIF scope | S-30.6 | Archant's reading of `12,50` is a parsing fix, not a departure. |

### Enable Banking synchronisation

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 109 | Enable Banking only | D-7 | About 25 connectors in Sure. |
| 110, 111 | Country with the credentials; removing them | S-29.1, Fix | Line 111's « Parity » is wrong on the country. |
| 110 | `ENABLE_BANKING_*` variables win | D-4 | |
| 110 | `GET /application` check before save | D-4 | |
| 110 | Lock enforced by the API | R4 | Every boundary is checked. |
| 112 | 90-day cap, no step-down | S-29.2 | `consent_seconds_ladder`. |
| 114 | Key `entry_reference` before `transaction_id` | D-6 | Sure duplicates when a bank changes the id. |
| 115 | Window per bank account | D-6 | Sure leaves a gap when one account fails. |
| 115 | Window extended to the oldest pending entry | S-29.6 | |
| 115 | Server checks the start date range | R4 | |
| 116 | Bank's suggested `date_from`, N26 `PERIOD_INVALID` | S-29.3 | |
| 116, 117 | Pending misses from the accepted start; partial pages | S-29.3 | Sure keeps pages only on 400 or 422 and counts the account synced. |
| 119 | Label clean-ups | S-29.4 | |
| 121 | Merchants from counterparties | S-29.4 | |
| 122 | Line without a debit/credit indicator | S-29.5, Fix | Sure reads it as money out; the row's description of Sure is wrong. |
| 123 | ±5 days, booked date, deletion after two misses, `syncs_include_pending` | S-29.6, D-6 | Sure keeps an Enable Banking pending line forever; Story 11.5's deletion goes. |
| 124 | Flags on an AD-7 tie | D-6 | |
| 124 | Pending-to-booked suggestions; merge takes the pending category and date | S-29.7 | |
| 124 | Dismiss is permanent | Fix | Sure's is permanent too: Parity. |
| 126 | Past balances kept on disconnect | D-6 | Sure recomputes forward; history can jump. |
| 126 | No per-account unlink | S-29.8 | |
| 128 | Scheduled sync at a chosen time; one hour between syncs | S-29.9 | Sure's `AutoSyncScheduler` at 02:22; a timer needs no queue. |
| 128 | `POST /api/sync` | D-4 | |
| 129 | PSU headers on data calls | S-29.9 | |

### Transactions

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 135 | Status filter; amount operator filter | S-31.1 | |
| 137 | Viewer does not see « Autoriser la mise à jour » | D-3 | Global rule: no write control for a viewer. |
| 138 | `create_transaction` refuses another currency | Later | Exchange rates. |
| 138 | `delete_transaction` needs account, date and amount | R4 | |
| 138 | `external_id` apart, `user_modified` ignored | D-2 | |
| 139 | Assistant import of a file, no LLM-extracted PDF | D-5 | |
| 139 | Decimal-text amount | R1 | |
| 139 | 1 MB and 1.5 MB caps, counters shown to the owner | R4 | |
| 139 | Preview and confirmation by tool | D-4 | |
| 140 | Bulk date, name, notes; tags replaced; no bulk exclusion | S-31.2 | |
| 142 | Editing a split keeps lines by id with tags and notes | D-6 | Sure's `unsplit!` then `split!` loses them. |
| 142 | A split line is never a transfer candidate | S-31.3 | |
| 142 | Possible duplicate resolved before splitting | D-2 | |
| 143 | Expense/income toggle; no flat-list preference; split line edits label and category in the sheet | S-31.3 | |
| 144 | Attachments in SQLite | D-2 | |
| 144 | No download button | S-31.4 | |
| 144 | « thumbnail, preview, drag and drop » | Fix | Sure has none of them. |
| 144 | A merge moves the duplicate's files | D-6 | Sure's merge destroys them. |
| 145 | Convert to trade: split parent, fee as a remainder | D-6 | Sure's excluded entry still counts in the balance; following it moves cash twice. |
| 145 | Convert to dividend or interest | D-4 | Sure only converts to buy or sell. |
| 145 | « no bulk conversion » | Fix | Sure has none. |

### Transfers

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 155 | « Sure's matcher follows another rule » | Fix | All three use `Transfer.kind_for_account`. |
| 159 | Cross-currency | Later | Exchange rates. |
| 162 | Creating a transfer | S-31.5 | `Transfer::Creator`. |
| 163 | Assistant matching tools | D-4 | |
| 164 | Automatic « Contributions aux investissements » | S-31.7 | |
| 165 | Transfer side category, merchant and tags (Parity) | S-31.6, Fix | Wrong: Sure opens `transfers/show` with category, tags on both sides, notes, fee and delete. |

### Classification

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 171 | Category kind | S-32.1 | Sure #1160 removed it; also Spec 27.9's « `kind` column change ». |
| 171 | 15 defaults instead of 22; multi-merge; delete all and restore; Sure's colours and icons | S-32.2 | French names are R2, not the count. |
| 171 | Category CSV import | S-30.3 | |
| 172 | Merchant colour and website; multi-merge | S-32.3 | |
| 172 | Brandfetch logo | R4 | The browser would call `cdn.brandfetch.io`; the CSP refuses it. |
| 172 | Merchants from the bank | S-29.4 | |
| 172 | AI enrichment | Later | |
| 173 | Tag colour; delete with replacement; delete all | S-32.3 | |
| 173 | « tags.ts comment denies the colour » | Fix | It no longer does. |

### Rules

Epic 8's departures were not the owner's own choice: pull request #32, written by an agent and merged by the owner, named three as its main departures. Those three are D-4; the others are stories.

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 181 | Provider details condition | S-32.7 | |
| 181 | Investment activity label condition | Fix | Sure has no such condition. |
| 182 | Negative operators, « est vide », « n'est pas vide » | S-32.4 | |
| 183 | Amount condition in any currency | S-32.5 | Integers per currency exponent keep R1. |
| 185 | AI actions | D-5 | |
| 185 | E-mail action | D-8 | Archant sends no e-mail. |
| 185 | Investment activity label action | S-32.8 | Needs activity labels (line 62). |
| 185 | One tag per action | S-32.6 | |
| 186 | Replace in the label | D-4 | Owner's real labels, Story 8.4; RE2 is R4. |
| 187 | Transfer action without a mirror entry | D-4 | PR #32. |
| 188 | Creation order | D-4 | PR #32; Sure has no order at all. |
| 188 | List sort; new rule active at once | S-32.9 | The « as in Sure » comment of `services/rules.ts:237` is wrong. |
| 189, 190 | Rules after each sync over the history; runs listed | S-32.10 | `family/syncer.rb#perform_post_sync`. |
| 190 | Manual apply respects locks | D-4 | PR #32, FR38. |
| 190 | Count shown; « apply all » includes inactive rules | S-32.9 | |
| 190 | Synchronous | D-2 | |
| 191 | Create from the pickers | D-4 | Asked in the owner's QA, Story 11.12. |
| 192 | Rule prompt; quick-categorise wizard; delete all | S-32.11, S-32.12, S-32.13 | |
| 192 | Rule export | Fix | `rules.csv` is exported: Parity. |
| 192 | Rule import | S-30.3 | |

### Recurring transactions

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 206 | Old inactive items deleted | Fix | Sure never calls `remove_old_inactive_transactions`: Parity. |
| 206 | Detection retires series and deletes empty suggestions | S-33.1 | Sure does it from the cleanup button only. |
| 207 | Next date | S-33.2 | `schedule.rb:172-176`. |
| 209 | Renamed series | S-33.3 | Sure has no `rekey`. |
| 210 | Import revert | Fix | Sure's revert syncs and detects too: Parity. |
| 212 | Entry picker in the declare dialog; merchant key kept | S-33.4 | |
| 212 | No currency choice | Fix | Sure has none: Parity. |
| 214 | Postpone to a date, amount field | S-33.5 | Sure offers `snooze_week` only. |
| 214 | No free search for a payment | S-33.6 | |
| 214 | No source amount | Fix | Export only: Parity. |
| 217 | Orphan repair | Fix | Same outcome: Parity in outcome. |
| 218 | Price changes | Fix | Parity confirmed, see below. |
| 219 | Exact monthly fractions | R1 | |
| 219 | `fixed` strategy | Fix | Sure writes no other outside import. |
| 219 | Totals without other currencies | Later | |
| 219 | Price notice, autopay tone | S-33.8 | |
| 219 | Bill drawer in full | S-33.7 | |
| 224 | Sign of a recurring transfer | D-2 | |
| 225 | AI review, smart fill | D-5 | |
| 226 | `fixed`, `none`, notice and grace days; `source` always `detected` | Fix | Same output. |
| 226 | Search reads the label | D-2 | |
| 226 | « Non catégorisé », « Sans catégorie » | R2 | |
| 226 | Refusals without Sure's sentence; `YYYY-MM-DD` dates; late read in `record_bill_payment` | D-2 | |
| 227 | Per-family switch | S-33.9 | |
| 227 | Preview-features gate | D-1 | Epic 23 was asked for. |

### Dashboard and reports

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 233 | Balance sheet « Never » | S-34.1, Fix | A flat balance sheet exists; Sure groups by type. |
| 233 | Net worth axes | S-34.2 | |
| 234 | `get_income_statement` in the reporting currency | Later | |
| 234 | Sankey, outflows donut, six months, spending trend, shared period | S-34.3, S-34.4 | |
| 234 | Investment summary widget | S-34.5 | |
| 235 | Customisable dashboard | S-34.6 | |
| 236 | Reports page, CSV, print | S-34.7 | |
| 236 | Google Sheets link | D-1 | Needs an API key (line 251). |

### Other areas

| Line | Item | Verdict | Note |
| ---- | ---- | ------- | ---- |
| 244 | Month start day | S-35.1 | With S-36.6. |
| 244 | Nothing written on read | D-2 | A `GET` never writes (AD-21). |
| 244 | Envelopes, copy and move for expense categories only; shared subcategory display; parent raised at once; net available amount; refusal as a field error | S-35.2 | `deferred-work.md:259-261`. |
| 244 | Carry computed on read | Fix | Same on screen: Parity. |
| 244 | Following months created at 0 | D-2 | |
| 244 | `update_budget` and `get_budget` inputs and refusals | S-35.3 | |
| 244 | More decimals than the currency | R1 | |
| 244 | Reporting currency only | Later | |
| 244 | Available cash panel | S-35.4 | |
| 244 | Bills reserved per envelope | S-35.5 | |
| 244 | Personal budgets and budget shares | S-36.4 | Rests on account ownership. |
| 245 | Pledges; spending a goal; contribution baseline | S-35.6, S-35.7, S-35.8 | |
| 245 | Pace, inactive account, curve scaling | S-35.9 | |
| 245 | Vertical axis | Fix | Parity since 27.15. |
| 245 | Dashboard card instead of a Plan page | S-35.10 | |
| 245 | Filters, search, indicators on `/goals` | S-35.11 | |
| 245 | Reserve target on read, 120-month cap | S-35.12 | A safe-integer bound alone is R1. |
| 245 | Reserve in another currency | Later | |
| 245 | `create_goal` contract | S-35.13 | |
| 245 | `get_goals` | D-4 | |
| 245 | `goals.ndjson` | D-4 | |
| 245 | Goal page explanations | S-35.14 | |
| 245 | Goals shown without Sure's preview gate | D-1 | |
| 248 | Export in the request, no copy kept | R4 | |
| 248 | Column allow-list | R4 | |
| 248 | `institution_name`, `cash_balance`; attachment `checksum` | S-30.7 | |
| 248 | `trades.csv`; converted transaction, cost lock, anchor, carry | Fix | Same output as Sure. |
| 248 | `prices.ndjson`; replace rule under `archant` | D-4 | |
| 248 | No archive import | S-30.1 | « into a family with no accounts » is wrong: Sure merges. |
| 250 | AI chat, documents | D-5 | |
| 251 | Public REST API, API keys; OAuth for mobile apps | D-1 | |
| 251 | MCP refuses Sure's fixed `MCP_API_TOKEN` | R4 | |
| 253 | Mobile apps, push | D-1 | |
| 253 | « Disponible sur ordinateur » for imports and rules | S-34.8 | |
| 254 | Job console | D-2 | |
| 254 | Debug logs | R4 | Logs never tie an amount, IBAN or token to an identity. |
| 254 | Hosting settings | Fix | Credentials live in « Réglages › Banques »; other blocks follow their rows. |
| 255 | Onboarding | D-1 | |
| 255 | Reset all data; reset with sample data | S-30.8, S-30.9 | |
| 256 | Keyboard | S-34.9 | Sure's few hotkeys; Archant's `⌘Enter` goes. |

## The three named checks

**Bill labels.** None of the four has a written reason (`git log -S`: Stories 23.4 and 23.5).

| Archant | Where | Sure `fr.yml` | Proposal |
| ------- | ----- | ------------- | -------- |
| « Libellé reconnu » | `bills.match.name`, `BillLabels.tsx:107`, a match reason chip | `bills.match.name_matches` « Le nom correspond » | Keep: R2, the bank prints « libellé », and Sure's sentence sits among noun chips. |
| « À la date prévue » | `bills.match.onDate`, `BillLabels.tsx:131`, payment on the due day | `bills.match.due_date` « Correspondance de date d'échéance » | Keep: R2, Sure's is a stacked calque that hides the meaning. |
| « Une opération supprimée » | `bills.review.unknown`, `_authed.bills.tsx:263`, `OccurrenceSheet.tsx:88` | `bills.index.suggestion_unknown_entry` « Une transaction » | « Une opération »: R2 for the noun, « supprimée » goes, Sure does not say it. |
| « Actifs » | `bills.allView.active`, `AllBills.tsx:158`, count heading of the subscription rollup | `bills.all.subscription_active` « Actif » | Keep: R2, it counts subscriptions, so plural. |

**Price changes.** Parity. Sure's `price_change_detector.rb:58-71` records the change, then `series.update!(amount:)` hits the same unique index (`db/schema.rb:2171-2174`) and `RecordNotUnique` is rescued: change kept, amount unchanged, as `price-changes.ts:113-131`. A series already holding the amount records nothing in both (`price_change_detector.rb:52`, `domain/recurring/occurrences.ts:207`). The story's premise, « not recorded when the series takes the new amount », does not describe the code. Only the comment of `price-changes.ts:73-74`, « the unique index on the amount being Archant's, not Sure's », is false.

## Decisions for the owner

Each decision covers every row the table sends to it. Owner's answers of 2026-10-14: D-1, D-5, D-7, D-8 nothing planned for now; D-2 Parity with an internal note; D-3 Sure's layout (S-34.10), Archant's Linear-inspired visual style kept; D-4 additions kept as « Parity, plus … »; bill labels take Sure's words. D-6: see its entry.

- **D-1. Product scope.** Several households, open sign-up, hosted product (Stripe, invite codes, impersonation), other locales, US and other non-French products, public REST API and what rests on it, mobile apps, onboarding, preview gates. Proposal: Dropped, citing the product and `AGENTS.md` non-goals.
- **D-2. Internal differences.** Storage sign, one Node process without a queue, SQLite attachments, one anchor per day, a `GET` never writes, and the rest the table names: nothing differs on screen, in the assistant or in the export. Proposal: such a row reads Parity, its Archant column keeping the internal note.
- **D-3. Visual and interaction choices.** Linear's colours and Inter (Epics 12 and 14), dialogs where Sure has drawers, no write control shown to a viewer, two loan cards per row on a phone. Proposal: ask, the owner chose Linear's skin in Epic 14.
- **D-4. Archant additions beside Sure.** OFX, mapping by index, ISIN securities, hand prices, `ENABLE_BANKING_*` variables, the credential check, `POST /api/sync`, replace in the label, the rule transfer without a mirror, rule order, manual apply respecting locks, create from pickers, dividend conversion, assistant tools and export files Sure lacks. Proposal: keep each addition that leaves Sure's own behaviour untouched; the row reads « Parity, plus … ».
- **D-5. Language models.** AI-parsed PDF, AI rule actions, AI bill review, assistant chat. Proposal: Dropped under R4, bank data never reaches a model provider.
- **D-6. Where following Sure loses or duplicates the user's data.** Owner's rule of 2026-10-14: Archant keeps its behaviour where Sure has an issue for the defect, the row citing it; a critical defect without an issue gets one; a minor one follows Sure. Import keys and AD-7 tie flags: Sure #3779, fix #3841 open. `entry_reference` key: #3464. Convert to trade: #3057, excluded entries counted in balances. Attachments, tags and notes on a pending merge: #4220, opened on 2026-10-14. Per-account window: no defect, a failed sync never advances Sure's `last_synced_at`; D-2. Disconnect history: S-29.10. Split edits: S-31.8.
- **D-7. More bank connectors.** Proposal: one later story per connector, Trade Republic first, once the owner names which.
- **D-8. E-mail.** Archant sends none; S-36.1 brings SMTP. Proposal: the rule e-mail action follows S-36.1 as a story once SMTP exists.

## Story catalogue

Epics 28 to 36 of `epics.md`. Sizes S, M, L. Sure paths at `00dd977fb`.

### Epic 28: Accounts and balances as Sure

- S-28.1 Every depository subtype a French household uses (S): `cash`, `cd`, `money_market`, empty subtype. `depository.rb`.
- S-28.2 Credit card details and the available-credit toggle (S). `credit_cards/_form.html.erb`, `enable_banking_account/processor.rb:53-140`.
- S-28.3 Loan chart periods and payoff rendering (S). `Loan::PayoffChart::WINDOW_KEYS`.
- S-28.4 Save a loan whose terms cannot be amortised (S). `Loan#amortizable?`.
- S-28.5 Investment subtypes for Europe and everywhere (S). `Investment.subtypes_grouped_for_select`.
- S-28.6 Sell more than is held (M). `holding/cost_basis_tracker.rb`, `forward_calculator.rb`.
- S-28.7 Delete a position and remap its security (M). `holdings_controller.rb`.
- S-28.8 Property and vehicle details and overview (M). `properties/_form.html.erb`, `vehicles/_form.html.erb`, their `tabs/_overview`.
- S-28.9 Property and vehicle values only valuations move (M). `Account#balance_type`, `balance/base_calculator.rb`.
- S-28.10 Other asset and other liability accounts (S), after S-28.9.
- S-28.11 Crypto accounts (L), after S-28.10. `crypto.rb`.
- S-28.12 Inactive accounts listed, and a menu on each account row (S). `Account.listable_manual`.
- S-28.13 A default account for new transactions (S). `accounts_controller#set_default`.
- S-28.14 Account order preference (S). `account_order.rb`.
- S-28.15 Account notes and institution (S). `accounts/_form.html.erb`.
- S-28.16 Create an account in Sure's steps (M), after S-28.2, S-28.8, S-28.10. `accounts/new.html.erb`.
- S-28.17 Honour a linked account's opening balance (M). `balance/reverse_calculator.rb`.
- S-28.18 Date the bank's balance today (S). `account/current_balance_manager.rb`.
- S-28.19 Confirm a balance before saving it (S). `valuations_controller.rb#confirm_create`.
- S-28.20 Opening balance and snapshot refusals as Sure's (S). `reconciliation_manager.rb`, `opening_balance_manager.rb`.
- S-28.21 An activity label on investment transactions (S), before S-32.8. `Transaction::ACTIVITY_LABELS`, `transactions/show.html.erb`.

### Epic 29: Bank synchronisation as Sure

- S-29.1 Choose the bank's country with the credentials, and remove them (S). `_enable_banking_panel.html.erb`.
- S-29.2 Ask for the bank's longest consent and step down on refusal (S). `consent_seconds_ladder`.
- S-29.3 Retry from the bank's suggested start, and keep a statement cut short (S), after S-29.6. `corrected_date_from`, `fetch_paginated_transactions`.
- S-29.4 Clean bank labels and create merchants from counterparties (M). `enable_banking_entry/processor.rb`, `find_or_create_merchant`.
- S-29.5 Read a line without direction as money out (S). `processor.rb#amount_value`.
- S-29.6 Settle pending lines as Sure (M): 0 to 8 days, pending date kept, no deletion, `syncs_include_pending`. Reverses Story 11.5's deletion.
- S-29.7 Suggest and merge pending duplicates (M), after S-29.4, S-29.6. `provider_import_adapter.rb:316-360`.
- S-29.8 Unlink one bank account (S). `accounts_controller.rb#unlink`.
- S-29.10 Recompute an unlinked account's history forward, as Sure's `account/syncer.rb` (S); `bank-link.ts` writes no reconciliation on disconnect.
- S-29.9 Sync at the chosen time, on demand, with the PSU address (M). `AutoSyncScheduler`, `enable_banking_item/provided.rb`.

### Epic 30: Imports, exports and resets as Sure

- S-30.1 Import a Sure archive (L). `sure_import.rb`, `sure_import/preflight.rb`, `family/data_importer.rb`.
- S-30.2 Import Mint, YNAB and Actual files (M each), after S-30.4.
- S-30.3 Import accounts, categories, merchants, rules and trades from CSV (M).
- S-30.4 Map currency, category, tags, account and a type column; Sure's date formats (M). `transaction_import.rb`, `import.rb`.
- S-30.5 Fix rows before publishing, and Sure's confirm step (M), after S-30.4. `import/cleans_controller.rb`.
- S-30.6 Read QIF categories, tags, splits, investments and several accounts (L), after S-30.5. `qif_import.rb`.
- S-30.7 Export each account's institution and cash balance, and each attachment's checksum (S). `family/data_exporter.rb`.
- S-30.8 Reset all financial data (M). `family/financial_data_reset.rb`.
- S-30.9 Reset with sample data (L), after S-30.8. `demo/generator.rb`.

### Epic 31: Transactions and transfers as Sure

- S-31.1 Filter transactions by status and amount (S). `transaction/search.rb`, `entry_search.rb`.
- S-31.2 Edit several transactions at once as Sure (M). `bulk_updates_controller.rb`, `Entry.bulk_update!`.
- S-31.3 Split lines as Sure shows and edits them (M). `transactions/show.html.erb`, `splits/new.html.erb`.
- S-31.4 Download an attachment (S). `transactions/_attachments.html.erb`.
- S-31.5 Create a transfer between two accounts (M). `transfer/creator.rb`.
- S-31.6 Open a transfer in its own drawer (M). `transfers/show.html.erb`.
- S-31.8 Edit a split by recreating its lines, as Sure's `splits_controller.rb#update` `unsplit!` then `split!` (S): tags and notes of the lines go.
- S-31.7 Categorise investment contributions (S), after S-32.2. `Family#investment_contributions_category`.

### Epic 32: Categories, merchants, tags and rules as Sure

- S-32.1 Categories without a kind, budgets over every category (M). Sure #1160 (`e1ff6d46e`).
- S-32.2 Sure's 22 default categories, multi-merge, delete all and restore, colours and icons (M). `category.rb`, `category/merger.rb`.
- S-32.3 Merchants and tags as Sure: colours, website, multi-merge, delete with replacement, delete all (M).
- S-32.4 Every rule operator (M). `rule/condition_filter.rb`.
- S-32.5 Match an amount in any currency (S). `condition_filter/transaction_amount.rb`.
- S-32.6 Add several tags in one rule action (S). `set_transaction_tags.rb`.
- S-32.7 Filter rules by provider details (M). `transaction_details.rb`, `processor.rb#extra`.
- S-32.8 Set an investment activity label by rule (S), after S-28.21.
- S-32.9 Confirm a rule before it runs; list sort; « apply all » counts and runs every rule (M). `rules_controller.rb`, `rules/confirm.html.erb`.
- S-32.10 Run rules over the history after each sync, and list every run (M), after S-32.9. `family/syncer.rb#perform_post_sync`, `rule_run.rb`.
- S-32.11 Offer a rule after categorising (M). `rules/_category_rule_cta.html.erb`.
- S-32.12 Categorise uncategorised lines in groups (L). `transactions/categorizes_controller.rb`.
- S-32.13 Delete every rule (S). `rules_controller.rb#destroy_all`.

### Epic 33: Bills as Sure

- S-33.1 Retire stale bills from the cleanup button only (S). `recurring_transaction/cleaner.rb`.
- S-33.2 Date a monthly bill's next payment as Sure (S). `schedule.rb:172-176`.
- S-33.3 Leave a renamed series behind (S): `rekey` goes.
- S-33.4 Declare a bill from any transaction (M). `recurring_transactions_controller.rb:115-125,312-345`.
- S-33.5 Postpone an occurrence a week (S). `recurring_occurrences/show.html.erb:286`.
- S-33.6 Search any transaction to pay an occurrence (M). `recurring_occurrences_controller.rb:99-200`.
- S-33.7 Show a bill's drawer in full (M). `bills/_summary.html.erb`, `_detail.html.erb`.
- S-33.8 Price notices and autopay tone (S). `bills/_notice.html.erb`.
- S-33.9 Turn recurring transactions off (S). `recurring_feature_guardable.rb`.

### Epic 34: Dashboard and reports as Sure

- S-34.1 Group the balance sheet by account type (S). `pages/dashboard/_balance_sheet.html.erb`.
- S-34.2 Draw charts' axes as Sure (S): no vertical axis labels, start and end dates. `time_series_chart_controller.js`.
- S-34.3 Pick the dashboard period (M). `periodable.rb`, `period.rb`.
- S-34.4 Cash flow widgets (L), after S-34.3. `_cashflow_sankey`, `_outflows_donut`.
- S-34.5 Investment summary on the dashboard (M), after S-34.3.
- S-34.6 Arrange the dashboard (M), after S-34.4, S-34.5.
- S-34.7 The reports page, its CSV and print layout (L), after S-34.3. `reports_controller.rb`.
- S-34.8 Import files and edit rules on a phone (M).
- S-34.9 Sure's few hotkeys (S). `hotkey_controller.js`.
- S-34.10 Sure's layout under Archant's visual style (M): drawers where Sure has drawers, Sure's card grid on a phone, notes saved as Sure saves them. Owner's answer to D-3.

### Epic 35: Budgets and goals as Sure

- S-35.1 Start the month on the household's chosen day (M), after S-36.6. `budget.rb:35-55`.
- S-35.2 Budget every category as Sure (M), after S-32.1. `budget_category.rb`, `Budget#copy_from!`.
- S-35.3 Sure's budget tools' inputs (S). `update_budget.rb`, `get_budget.rb`.
- S-35.4 Available cash beside the budget (M). `_available_cash.html.erb`.
- S-35.5 Bills reserved inside each envelope (S). `bills_reservation`.
- S-35.6 Pledge a deposit toward a goal (L), after S-35.9. `goal_pledge.rb`.
- S-35.7 Spend a goal (L). `goal.rb:564-636`.
- S-35.8 Count contributions on an investment-backed goal (M).
- S-35.9 A goal's pace and history as Sure (S). `goal.rb:265-281, 717-780`.
- S-35.10 Budgets and goals on a Plan page (M). `plans_controller.rb`.
- S-35.11 Filter, search and summarise goals (M), after S-35.9.
- S-35.12 Refresh a months-of-expenses reserve monthly (S).
- S-35.13 Sure's `create_goal` contract (S); `get_goals` per D-4.
- S-35.14 Explain a goal's state on its page (S), after S-35.9.

### Epic 36: Users, access and preferences as Sure

- S-36.1 Reset a forgotten password by e-mail (M). New SMTP variables in `.env.example`.
- S-36.2 A member who writes, and a guest as Sure's (M): `viewer` migrates to `guest`.
- S-36.3 Guests open on the assistant (S), after S-36.2.
- S-36.4 Share each account with chosen members, and personal budgets (L), after S-36.2. `account_share.rb`, `budget_share.rb`.
- S-36.5 Two-factor backup codes as Sure's (S).
- S-36.6 Household preferences (L): time zone, date format, country, month start day, currency at setup.
- S-36.7 Sign in with a passkey (M). Better Auth's passkey plugin.
- S-36.8 Sign in through OpenID Connect (L), after S-36.2.
