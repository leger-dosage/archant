---
name: Archant
status: final
updated: '2026-09-25'
sources:
  - ../../feature-inventory.md
  - ../../epics.md
  - ../../architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md
---

# Archant — Experience Spine

## Foundation

Responsive web, desktop first. A phone can read everything and make quick edits, such as categorising a transaction; importing files and managing rules are laptop tasks. shadcn/ui on Vite, React, TanStack Router and Tailwind CSS 4. `DESIGN.md` is the visual reference; this file specifies behaviour and only the delta over shadcn's components.

One instance serves one household and, for now, one signed-in user with the `admin` role. The interface is in French, through i18next, with every string in `locales/fr.json`. Routes and search params are English, as in Sure: a URL is not translated, so it must read the same whatever the locale.

Navigation entries appear with the epic that ships them: a surface whose epic has not shipped is absent, never disabled.

## Information Architecture

| Surface | Route | Reached from | Purpose | Epic |
| --- | --- | --- | --- | --- |
| First-launch setup | `/setup` | First visit with no user | Create the administrator | 3 |
| Sign-in | `/sign-in` | Any page without a session | Sign in | 3 |
| Dashboard | `/` | Sidebar, `g d` | A greeting, net worth and its history, the month's flow by category, the balance sheet by account type | 6, 12 |
| Accounts | `/accounts` | Sidebar, `g c` | Accounts grouped under Actifs and Passifs, with totals; add an account | 1 |
| Account detail | `/accounts/:id` | Sidebar account row, accounts page | Balance, chart, tabs Opérations, Soldes, Imports, Paramètres | 1 |
| Import | Dialog over account detail | "Importer" on an account, `i` | File, column mapping, preview, confirmation | 2 |
| Transactions | `/transactions` | Sidebar, `g o` | All transactions, filters in the URL, bulk actions | 1 |
| Transaction | Sheet over the current page | Row click, `Enter`, `e` | Edit every field | 1 |
| Recurring | `/recurring` | Sidebar, `g r` | Subscriptions and bills with the next date | 9 |
| Rules | `/rules` | Sidebar, `g u` | Rules list and editor | 8 |
| Settings | `/settings/...` | Sidebar footer, `g s` | Banques, Catégories, Marchands, Étiquettes, Sécurité | 3, 4, 10 |
| Command palette | Overlay | `⌘K` / `Ctrl+K` | Go anywhere, run any action, find an account or a transaction | 1 |

Until Epic 6 ships, `/` redirects to `/accounts`. The sidebar lists accounts under the Comptes entry, grouped and with balances, as in Sure. Dialogs and sheets stack one level deep at most: the import dialog never opens a sheet, and a sheet never opens a dialog except a confirmation.

→ Composition reference: [mockups/key-direction-a.html](mockups/key-direction-a.html), which shows the dashboard, the transactions list, the empty dashboard, the logo and the favicon. This spine and `DESIGN.md` win on conflict.

## Voice and Tone

French, vouvoiement, short sentences. Buttons are an infinitive verb and its object. No exclamation marks, no emoji, no congratulation. Numbers do the talking.

| Do | Don't |
| --- | --- |
| « Importer un fichier » | « Cliquez ici pour importer vos transactions ! » |
| « 42 opérations importées, 3 déjà présentes. » | « Import réussi avec succès ✓ » |
| « Aucune opération sur cette période. » | « Oups, il n'y a rien ici... » |
| « Le consentement de BoursoBank expire le 12 octobre. » | « Attention !!! Votre connexion va bientôt expirer » |
| « Supprimer le compte et ses 1 204 opérations ? » | « Êtes-vous sûr ? » |
| « Sans catégorie » | « Non catégorisé(e) » |

Error messages come from the API code (`errors.<CODE>`) and say what happened and what to do, in one or two sentences.

## Money and Dates

- Amounts render through the `Money` component in `fr-FR`: `1 234,56 €`, narrow no-break space as thousands separator, true minus sign. Transaction amounts are signed; balances and totals are not.
- A liability's balance reads as what is owed, positive, under the Passifs group; net worth subtracts it.
- Amount input accepts `1234,56`, `1 234,56`, `-42,90` and `42.90`, through `parseAmount`. A field whose sign matters offers a Dépense / Revenu toggle next to the amount rather than asking for a minus sign.
- Dates in lists are grouped under day headers: « Aujourd'hui », « Hier », then « lundi 15 septembre », and « 15 septembre 2025 » for another year. Date inputs use shadcn `Calendar` in French, week starting Monday, and accept typed `15/09/2026`.
- Periods for charts are chosen with a segmented control: 1 M, 3 M, 6 M, 1 A, Tout.

## Component Patterns

Behavioural. Visual specs live in `DESIGN.md` or in shadcn's defaults.

| Component | Use | Behavioural rules |
| --- | --- | --- |
| Sidebar | Everywhere once signed in | Accounts listed under Comptes, grouped, with balances; inactive accounts hidden. Clicking an account opens its detail. The group header toggles open or closed and remembers it. |
| Transaction row | Transactions, account detail | Click or `Enter` opens the transaction sheet. The category chip opens a combobox in place; choosing saves immediately with an optimistic update and an undo toast. Checkbox or `x` selects. |
| Transaction sheet | Over any list | Fields: date, label, amount, account (read-only for imported ones), category, merchant, tags, notes, exclude from reports. Saves on `⌘Enter` or the Enregistrer button; `Esc` closes and asks only if changes are unsaved. Shows the source (manuel, import OFX du 12 sept., Enable Banking) and, when relevant, the linked transfer. |
| Filter bar | Transactions | Filters as removable chips: compte, période, montant, texte, then catégorie, étiquette, marchand, sens as their epics ship. Every filter is in the URL. The result count and the signed total of the filtered rows show at the right. |
| Bulk bar | Transactions | Appears at the bottom when a row is selected: count, « Tout sélectionner (N résultats) », then Catégorie, Marchand, Étiquettes, Exclure, Supprimer. Supprimer confirms with the count. |
| Import dialog | Account detail | Steps shown at the top: Fichier, Colonnes (CSV only), Aperçu. Drop zone or file picker; the format is detected. The preview shows one tab per group with its count: À créer, Déjà présentes, Rapprochées, Doublons possibles, Rejetées. Confirm button states the count: « Importer 42 opérations ». |
| CSV mapping | Import dialog | First ten rows as a table; a select above each column (Date, Libellé, Montant, Débit, Crédit, Notes, Ignorer). Delimiter, date format, decimal separator and sign convention prefilled with French defaults. The preview below updates as the mapping changes. |
| Combobox | Category, merchant, tags, account | Type to filter, arrows to move, `Enter` to pick. Merchant and tags offer « Créer "…" » as the last option. Categories show parents with their children indented. |
| Command palette | Global | Groups: Aller à, Actions, Comptes, Opérations (search by label, at least 3 characters). `Enter` runs the highlighted item. Recent items first when the query is empty. |
| Stat block | Dashboard, account detail | Value, then the change over the chosen period in amount and percentage. |
| Chart | Dashboard, account detail | Hover or arrow keys move a cursor that shows date and amount. A « Voir les données » toggle shows the same series as a table. |
| Banner | Top of content | Consent expiring within 14 days, consent expired, last sync older than 48 hours. One action each: Renouveler, Reconnecter, Voir la connexion. Dismissible for the session only. |
| Confirmation dialog | Destructive actions | States what will be lost, with counts. The destructive button repeats the verb: « Supprimer 12 opérations ». Focus starts on Annuler. |

## State Patterns

| State | Surface | Treatment |
| --- | --- | --- |
| First launch | `/setup` | A single card: « Créer le compte administrateur », email, password twice. No other route reachable. |
| No account | Accounts, dashboard | A card with a tinted icon, « Aucun compte pour l'instant », one sentence, « Connectez une banque ou importez un relevé pour voir votre patrimoine ici. », and one button, « Ajouter un compte ». |
| Account without transactions | Account detail | « Aucune opération. » with two actions: « Importer un fichier » and « Ajouter une opération ». |
| Loading | Any list or chart | Skeleton rows matching the layout; no spinner over content. |
| Filters with no result | Transactions | « Aucune opération ne correspond à ces filtres. » and « Effacer les filtres ». |
| Import preview, nothing new | Import dialog | « Toutes les opérations de ce fichier sont déjà présentes. » Confirm disabled. |
| Import preview stale | Import dialog | On `IMPORT_PREVIEW_STALE`, the preview reloads with a notice: « Le compte a changé depuis l'aperçu. Vérifiez avant d'importer. » |
| Lines before the opening date | Import dialog, Rejetées tab | Count and a button « Avancer la date d'ouverture au 3 janvier 2025 ». |
| Possible duplicate | Transaction row and sheet | Warning icon and « Doublon possible ». The sheet offers « Fusionner avec… » and « Ce n'est pas un doublon ». |
| Pending | Transaction row | Muted amount and « En attente » badge; the row sorts at the top of its day. |
| Excluded | Transaction row | Muted amount with an eye-off icon; tooltip « Exclue des rapports ». |
| Account in another currency | Dashboard | A notice under net worth names the account left out of totals. |
| Sync in progress | Bank connection, sidebar | Spinner on the connection's sync button; a second click is refused with « Synchronisation déjà en cours. » |
| Network or server error | Anywhere | Sonner toast, destructive, with the translated message; a failed optimistic update rolls back. |
| Session expired | Anywhere | Redirect to sign-in, then back to the same URL. |

## Interaction Primitives

Keyboard first, as in Linear. The mouse works everywhere; the keyboard is faster.

- `⌘K` / `Ctrl+K`: command palette.
- `g d` dashboard, `g c` accounts, `g o` transactions, `g r` recurring, `g u` rules, `g s` settings.
- In a list: `j` / `k` or arrows move, `x` selects, `Shift` + move extends the selection, `Enter` or `e` opens, `c` category, `m` merchant, `t` tags, `Backspace` deletes after confirmation.
- `n` new transaction in the current account or the last used one, `i` import into the current account.
- `/` focuses the search filter. `Esc` closes the topmost layer or clears the selection.
- `?` shows every shortcut.

Single-letter shortcuts are off while focus is in a text field. Every shortcut has a visible equivalent in a button or a menu, which shows the shortcut in its tooltip.

Banned: infinite scroll (pages of 50, AD-15), drag and drop as the only way to do something, hover-only actions on touch screens, modal stacks deeper than one level, auto-saving a whole form on blur.

## Accessibility Floor

WCAG 2.2 AA on every surface, NFR13.

- Every action is reachable by keyboard, in reading order; focus is always visible with `{colors.ring}`.
- `Esc` closes the topmost layer and returns focus to the element that opened it.
- Amounts never rely on colour: the sign and, for pending or excluded, a badge or an icon with text carry the meaning.
- Each chart has a text summary above it (« Patrimoine net : 84 230 €, +2,1 % sur 3 mois ») and a table alternative.
- Page changes announce the page title; toasts are announced through an `aria-live` region; the import preview announces group counts.
- Targets are at least 24 by 24 px; rows are 36 px high.
- `prefers-reduced-motion` removes chart animations and sheet transitions.
- Tables are real tables with header cells; the transaction list is a grid with row selection announced.

## Responsive & Platform

| Width | Behaviour |
| --- | --- |
| ≥ 1024 px | Sidebar with labels and account balances; transactions as a table. |
| 768–1023 px | Sidebar collapses to icons; the account list moves to the accounts page. |
| < 768 px | Sidebar becomes a sheet from the top bar. Transactions become a list of two-line rows: label and amount, then date and category. The transaction sheet opens full screen. Import and rules show « Disponible sur ordinateur ». |

## Inspiration & Anti-patterns

- **Taken from Sure:** accounts in the sidebar with balances, grouped by assets and liabilities; the transaction drawer; Geist; the net worth chart as the dashboard's centre; since Epic 12, its grey page and white cards, tinted icons for categories and account types, category pills, the outflows donut, the balance sheet weight bar, the greeting and its empty states.
- **Taken from Linear:** the command palette, `g` shortcuts, `j`/`k`, filters as chips.
- **Departure from Sure:** expenses are not red, the primary button is black rather than a colour, and there is no AI assistant surface.
- **Rejected:** onboarding tours and celebratory animations; infinite scroll; showing an amount in red to scold spending; fetched merchant logos, which would send merchant names to a third party.
- **Considered for Epic 12 and set aside:** a ledger direction with an ink accent and a warm home direction with a terracotta accent, both further from Sure; two Evidence-inspired variants, one with Evidence's figures, charts and tables in cards, one turning the dashboard into a monthly report. Their mocks stay in `.working/`.
- **Later candidate:** Sure's privacy mode, which blurs amounts on screen.

## Key Flows

The protagonist is Camille, who runs the household's money and uses Archant on a laptop.

### Flow 1 — First evening: an account and a year of history (Epics 1, 2)

1. Camille opens Archant for the first time and creates the administrator account.
2. The accounts page is empty. They press « Ajouter un compte », name it « Compte joint », pick Compte courant, and set the opening balance at 1 January 2025.
3. On the account, they press `i`, drop the OFX file exported from their bank, and see the preview: 312 à créer, 4 rejetées « avant la date d'ouverture ».
4. They press « Avancer la date d'ouverture au 28 décembre 2024 »; the rejected tab empties.
5. They press « Importer 316 opérations ».
6. **Climax:** The balance chart draws a year of history, and the balance at the top matches the one in their banking app to the cent, because the file's closing balance was recorded as a snapshot.

Failure: the file is a PDF renamed `.ofx`. The dialog says « Ce fichier n'est pas un relevé OFX lisible. » and nothing is written.

### Flow 2 — Cleaning up after an import (Epics 4, 5)

1. Camille opens Opérations, filters on « Sans catégorie » and on the last month: 58 results.
2. They type `/`, search « carrefour », press `x` on the first row, then `Shift+j` to extend the selection to the 9 rows.
3. They press `c`, type « cour », pick Courses, `Enter`. The rows update; a toast offers to undo.
4. They clear the search. A transfer of −500 € to the Livret A shows « Virement » and the savings account's name: it was matched automatically.
5. **Climax:** The « Sans catégorie » count drops to 12, and the filtered total at the right shows what is left to sort.

Failure: a transfer matched the wrong account. In the sheet, Camille presses « Dissocier », then « Ne plus proposer ».

### Flow 3 — Monthly review (Epic 6)

1. On the first Sunday of the month, Camille opens the dashboard.
2. Net worth reads 84 230 €, +2,1 % over 3 months, with the line chart below.
3. The month's flows show income 5 420 €, expenses 3 910 €, then categories by amount.
4. Restaurants is higher than they expected. They click the line.
5. **Climax:** The transactions page opens filtered on Restaurants and last month, and the three dinners that explain the gap sit at the top.

### Flow 4 — Consent renewal (Epic 10)

1. A banner reads « Le consentement de BoursoBank expire le 12 octobre. » with « Renouveler ».
2. Camille presses it, is sent to the bank, approves, and comes back to the connection page.
3. The linked accounts are listed as before; « Synchroniser » runs once.
4. **Climax:** The banner disappears, the connection shows « Dernière synchronisation : à l'instant », and the history is unchanged.

Failure: Camille ignores the banner. After expiry it turns to « Le consentement de BoursoBank a expiré. La synchronisation est arrêtée. » with « Reconnecter »; nothing is deleted.
