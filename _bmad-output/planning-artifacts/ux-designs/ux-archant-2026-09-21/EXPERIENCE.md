---
name: Archant
status: final
updated: '2026-10-03'
sources:
  - ../../feature-inventory.md
  - ../../epics.md
  - ../../../../docs/architecture.md
---

# Archant — Experience Spine

## Foundation

Responsive web, desktop first. A phone can read everything and make quick edits, such as categorising a transaction; importing files and managing rules are laptop tasks. shadcn/ui on Vite, React, TanStack Router and Tailwind CSS 4. `DESIGN.md` is the visual reference; this file specifies behaviour and only the delta over shadcn's components.

One instance serves one household: administrators, and from Epic 20 viewers who read everything and change nothing. The interface is in French, through i18next, with every string in `locales/fr.json`. Routes and search params are English, as in Sure: a URL is not translated, so it must read the same whatever the locale.

Navigation entries appear with the epic that ships them: a surface whose epic has not shipped is absent, never disabled.

## Information Architecture

| Surface | Route | Reached from | Purpose | Epic |
| --- | --- | --- | --- | --- |
| First-launch setup | `/setup` | First visit with no user | Create the administrator | 3 |
| Sign-in | `/sign-in` | Any page without a session | Sign in | 3 |
| Dashboard | `/` | Rail | A greeting, net worth and its history, the month's flow by category, the balance sheet by account type, then, while an active or paused goal exists, « Objectifs », Sure's Plan card: what those goals saved « sur <cible> tous objectifs confondus » in the reporting currency with a bar, « N actifs » and « N en retard » or « Tout est dans les temps », the goals in another currency named, the first five with their status, bar and saved against target, and « Tous les objectifs » | 6, 12, 21 |
| Accounts | `/accounts` | Rail | Accounts grouped under Actifs and Passifs, with totals; add an account | 1 |
| Account detail | `/accounts/:id` | Accounts column, accounts page | Balance, chart, tabs Opérations, Soldes, Ordres on an investment account (`?tab=trades`, its buys, sales, dividends and interest, « Ajouter un ordre » for an administrator, a row opening its edit dialog), Imports, and Positions on an investment account with trades (Epic 22); account actions (Modifier, Exclure des rapports, Désactiver, Supprimer le compte) in the « … » menu beside the name | 1 |
| Import | Dialog over account detail | "Importer" on an account | File, column mapping, preview, confirmation | 2 |
| Transactions | `/transactions` | Rail | All transactions, filters in the URL, bulk actions | 1 |
| Transaction | Sheet over the current page | Row click, or `Enter` on a focused row | Edit every field | 1 |
| Budgets | `/budgets/:month`, `/budgets/:month/edit`, `/budgets/:month/categories` | Rail, between Comptes and Récurrent; `/budgets` opens the current month | A month's budget: arrows, a month picker by year and « Aujourd'hui », months from two years back, or the oldest entry's month, to two years ahead; once set up, the donut of spending by top-level expense category with « <dépensé> sur <budget> » in its centre, or « Budget sur-alloué » with a link to « Catégories » while the categories take more than the total, the summary of income and spending against plan, then a card per category in « Dépassées » and « Dans les clous », each with its status « Dépassé », « Bientôt atteint » or « Dans les clous », filtered by « Toutes, Dépassées, Dans les clous » in `?filter=` when a card is over, and opening a sheet with the month's spending, the monthly average and median, the three latest transactions and a link to `/transactions`; before that, « Définir le budget », a form with « Dépenses prévues », « Revenus attendus » and « Suggérer », or, once an earlier month is set up, « Copier <mois> », which copies the latest one and opens « Catégories », and « Partir de zéro », which opens the form; set-up has two steps, « Budget » then « Catégories », where each expense category's amount saves on change beside its median, a blank subcategory reads « Partagé », a bar shows the share allocated and « Valider » waits while it passes the total; a category that can give some has « Déplacer de l'argent », a dialog with what it can give, « Montant » and « Vers », its parent and children disabled; each expense category has a « Report » switch, saved on change, which carries what it leaves into the next month set up and holds for the later months, a month set up inheriting it; a card that received money shows « +<montant> reporté » beside « Budgété », counted in what remains, and its sheet a « Reporté » figure; month as `YYYY-MM` | 17 |
| Recurring | `/recurring` | Rail | « Nouvelles factures possibles », what detection found, above the active and inactive series with the next date; « Ajouter une facture », « Ajouter un revenu » and each row's « Modifier » open the bill dialog | 9, 23.1, 23.2 |
| Goals | `/goals`, `/goals/:id` | Rail | Goals as cards with a progress ring, active ones by status, then paused and completed ones, each card saying « En pause », « Terminé » or « Archivé » in place of its status, archived ones in a collapsed « Archivés » section below; a goal with its progress, its accounts' shares and, while active or paused, its chart: the saved amount over 90 days, a dashed line at the target and the line to it by its date, a sentence above and the days as a table on demand; « Modifier » and a « … » menu of the events its state allows (« Mettre en pause », « Reprendre », « Marquer comme terminé », « Archiver », « Restaurer », « Rouvrir ») then « Supprimer », completing and archiving confirmed first; a paused, completed or archived goal shows Sure's banner with « Reprendre l'objectif », « Archiver l'objectif » or « Restaurer l'objectif », and a completed one « Atteint le <date> · <montant> » without what remains or the monthly amount; the dialog opens on « Objectif ponctuel » or « Réserve », each with Sure's hint, and « Réserve » hides the date and offers « Un montant fixe » or « Un nombre de mois de dépenses », the latter a « Mois de dépenses » field in place of the amount; a reserve's badge is « Constituée », neutral, or « Entamée », in the warning tint and sorted with goals « En retard »; a reserve in months says « N mois de dépenses » on its card, and on its page names the median it multiplies or says the last computed target stands, calls what remains « À recompléter » and shows no date; « Marquer comme terminé » is never offered to a reserve | 21 |
| Rules | `/rules` | Rail | Rules list and editor | 8 |
| Settings | `/settings/...` | Rail | Banques, Catégories, Marchands, Étiquettes, Sécurité, Assistants IA, Données, Membres, Placements; a viewer sees Sécurité only | 3, 4, 10, 16, 18, 20, 22 |
| Invitation | `/invitations/:token` | A link the administrator sends | Name who invites and the role, set a name and a password | 20 |
| Assistant consent | `/oauth/consent` | An assistant's sign-in, after `/sign-in` | Name the assistant and where it returns, grant read or read and write, or refuse | 16 |

Until Epic 6 ships, `/` redirects to `/accounts`. Since Epic 14 the shell is Sure's: a rail of destinations, an accounts column that lists every active account grouped by type with balances, and a top bar with breadcrumbs. The accounts column shows on every signed-in page but settings, which put their own navigation column in its place. A transaction's sheet gains « Diviser » and « Pièces jointes » with Epic 19; a viewer sees no control that writes, since Epic 20. Dialogs and sheets stack one level deep at most: the import dialog never opens a sheet, and a sheet never opens a dialog except a confirmation.

→ Composition reference: [mockups/sure-proportions-frame-and-font.html](mockups/sure-proportions-frame-and-font.html) with frame A for the shell and the transactions list; [mockups/key-linear-classic-dark.html](mockups/key-linear-classic-dark.html) for the dashboard's content, the empty dashboard, the logo and the favicon, its shell and sizes superseded. This spine and `DESIGN.md` win on conflict.

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
| Rail | Everywhere once signed in | One entry per destination, the current one marked with `aria-current`. The avatar opens the user menu: theme, Réglages, Se déconnecter. |
| Accounts column | Every signed-in page but settings | « Ajouter un compte » opens the creation dialog. Tabs Tout, Actifs, Passifs filter the list. Accounts are grouped by type with the group's total; inactive accounts hidden. Clicking an account opens its detail. The top bar's button folds the column and the choice is remembered on the device. |
| Top bar | Every signed-in page | Breadcrumbs name the page and its parents, each parent a link: « Accueil / Opérations », « Comptes / Compte joint », « Réglages / Catégories ». |
| Transaction row | Transactions, account detail | Click or `Enter` opens the transaction sheet. The category chip opens a combobox in place; choosing saves immediately with an optimistic update and an undo toast. Its checkbox selects it; the bulk bar's ticked checkbox, « Vider la sélection », unticks every row. |
| Transaction sheet | Over any list | Fields: date, label, amount, account (read-only for imported ones), category, merchant, tags, notes, exclude from reports. Saves on `⌘Enter` or the Enregistrer button; `Esc` closes and asks only if changes are unsaved. Shows the source (manuel, import OFX du 12 sept., Enable Banking) and, when relevant, the linked transfer. On an investment account, an administrator sees « Convertir en ordre » when the transaction can become a trade, that is, not a transfer side, pending, excluded, a possible duplicate, split or a split's line; it opens a dialog with type, security, quantity, unit price and the fees computed from the transaction's amount. A viewer does not see it. |
| Trade dialog | Account detail, Ordres | Four types: « Achat », « Vente », « Dividende », « Intérêts ». A buy or a sale takes a security, date, quantity, unit price and fees; a dividend or interest takes « Titre », listing the account's positions, with « Liquidités » first for interest, the date and « Montant ». A row shows « Dividende » or « Intérêts » with no quantity × price, and « Liquidités » for interest on cash. A trade converted from a transaction opens read-only with « Annuler la conversion », which deletes the trade and brings the transaction back; a viewer does not see it. |
| Filter bar | Transactions | Filters as removable chips: compte, période, montant, texte, then catégorie, étiquette, marchand, sens as their epics ship. Every filter is in the URL. The result count and the signed total of the filtered rows show at the right. |
| Bulk bar | Transactions | Appears at the bottom when a row is selected: a ticked checkbox, « Vider la sélection », that unticks every row, then the count, « Tout sélectionner (N résultats) », then Catégorie, Marchand, Étiquettes, Exclure, Supprimer. Supprimer confirms with the count. |
| Import dialog | Account detail | Steps shown at the top: Fichier, Colonnes (CSV only), Aperçu. Drop zone or file picker; the format is detected. The preview shows one tab per group with its count: À créer, Déjà présentes, Rapprochées, Doublons possibles, Rejetées. Confirm button states the count: « Importer 42 opérations ». |
| CSV mapping | Import dialog | First ten rows as a table; a select above each column (Date, Libellé, Montant, Débit, Crédit, Notes, Ignorer). Delimiter, date format, decimal separator and sign convention prefilled with French defaults. The preview below updates as the mapping changes. |
| Combobox | Category, merchant, tags, account, security | Type to filter, arrows to move, `Enter` to pick. A trade's security lists the known securities, then Yahoo's listings, then « Saisir un titre manuellement ». Merchant and tags offer « Créer "…" » as the last option; in the rule dialog, category does too, creating a top-level expense category with the form's defaults, edited later under « Réglages › Catégories ». A merge target offers no « Créer ». Categories show parents with their children indented. |
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
| Sync in progress | Bank connection, accounts column | Spinner on the connection's sync button; a second click is refused with « Synchronisation déjà en cours. » |
| Network or server error | Anywhere | Sonner toast, destructive, with the translated message; a failed optimistic update rolls back. |
| Session expired | Anywhere | Redirect to sign-in, then back to the same URL. |

## Interaction Primitives

No command palette and no keyboard shortcut but one: the interface keeps what the browser and Radix give, and every action has a visible button, link or menu item.

- `Tab` moves through the page in reading order: the rail, the accounts column, the top bar, then the page's controls, then each transaction row.
- `Enter` activates the focused button or link; on a transaction row it opens the sheet.
- Arrow keys move inside menus, tabs and comboboxes, and move a chart's cursor; comboboxes filter as you type and pick with `Enter`.
- `Esc` closes the topmost layer and returns focus to what opened it.
- `⌘Enter` / `Ctrl+Enter` saves the transaction sheet, and the Enregistrer button says so in its `title`.

Banned: infinite scroll (pages of 50, AD-15), drag and drop as the only way to do something, hover-only actions on touch screens, modal stacks deeper than one level, auto-saving a whole form on blur.

## Accessibility Floor

WCAG 2.2 AA on every surface, NFR13.

- Every action is reachable by keyboard, in reading order; focus is always visible with `{colors.ring}`.
- `Esc` closes the topmost layer and returns focus to the element that opened it.
- Amounts never rely on colour: the sign and, for pending or excluded, a badge or an icon with text carry the meaning.
- Each chart has a text summary above it (« Patrimoine net : 84 230 €, +2,1 % sur 3 mois ») and a table alternative.
- Page changes announce the page title; toasts are announced through an `aria-live` region; the import preview announces group counts.
- Targets are at least 24 by 24 px; controls are 36 px high by default and transaction rows 56 px.
- `prefers-reduced-motion` removes chart animations and sheet transitions.
- Tables are real tables with header cells; the transaction list is a grid with row selection announced.

## Responsive & Platform

| Width | Behaviour |
| --- | --- |
| ≥ 1024 px | Rail, accounts column and top bar; transactions as a table with category and account columns. |
| 768–1023 px | A top bar with the menu, the logo and the user menu, as in Sure, and a bottom navigation of four entries, « Accueil », « Opérations », « Budgets » and « Objectifs », then « Plus », a menu of « Comptes », « Récurrent », « Règles » and « Réglages », marked current on one of their pages; eight entries cut their labels at 390 px. The menu opens the accounts column as a full-screen overlay. Transactions keep the category column and drop the account column. |
| < 768 px | As above, every bottom-navigation label whole from 360 px; transactions become two-line rows: label and amount, then date and category. The transaction drawer opens full screen. Import and rules show « Disponible sur ordinateur ». |

## Inspiration & Anti-patterns

- **Taken from Sure:** the accounts column with balances; the transaction drawer; the net worth chart as the dashboard's centre; since Epic 12, tinted icons for categories and account types, category pills, the outflows donut, the balance sheet weight bar, the greeting and its empty states; since Epic 14, the shell (rail, accounts column, top bar with breadcrumbs, bottom navigation on small screens), the page header above the content, Tailwind's default type scale, Sure's control, dialog and drawer sizes, and the inset groups around rows.
- **Taken from Linear:** filters as chips; since Epic 12, its Light and Classic Dark themes, Inter with its alternate glyphs, borders instead of shadows, and an indigo primary button. Epic 14 drops Linear's sidebar, inset panel, title bar, 13px text and 36px rows: the interface read too small.
- **Departure from Sure:** expenses are not red; colours, font and lines are Linear's; transaction rows are 56px instead of 68px; the accounts column neither resizes nor shows sparklines; there is no assistant chat: an assistant the owner connects acts through MCP, and Archant shows only « Réglages › Assistants IA », where it is allowed and disconnected. Below 1024 px the bottom navigation keeps four destinations and a « Plus » menu, where Sure's shows four to six and has no such menu: Archant has eight destinations against Sure's five, and eight cut their labels at 390 px.
- **Rejected:** onboarding tours and celebratory animations; infinite scroll; showing an amount in red to scold spending; fetched merchant logos, which would send merchant names to a third party.
- **Considered for Epic 14 and set aside:** one Linear-like sidebar at Sure's proportions (frame B of the Epic 14 mockup), and Geist, Sure's font.
- **Considered for Epic 12 and set aside:** Sure's own skin (grey page, white shadowed cards, black primary button), first chosen then replaced by Linear's; a ledger direction with an ink accent and a warm home direction with a terracotta accent; two Evidence-inspired variants, one with Evidence's figures, charts and tables in cards, one turning the dashboard into a monthly report; Linear's default near-black Dark, replaced by Classic Dark. Their mocks stay in `.working/`.
- **Later candidate:** Sure's privacy mode, which blurs amounts on screen.

## Key Flows

The protagonist is Camille, who runs the household's money and uses Archant on a laptop.

### Flow 1 — First evening: an account and a year of history (Epics 1, 2)

1. Camille opens Archant for the first time and creates the administrator account.
2. The accounts page is empty. They press « Ajouter un compte », name it « Compte joint », pick Compte courant, and set the opening balance at 1 January 2025.
3. On the account, they press « Importer », drop the OFX file exported from their bank, and see the preview: 312 à créer, 4 rejetées « avant la date d'ouverture ».
4. They press « Avancer la date d'ouverture au 28 décembre 2024 »; the rejected tab empties.
5. They press « Importer 316 opérations ».
6. **Climax:** The balance chart draws a year of history, and the balance at the top matches the one in their banking app to the cent, because the file's closing balance was recorded as a snapshot.

Failure: the file is a PDF renamed `.ofx`. The dialog says « Ce fichier n'est pas un relevé OFX lisible. » and nothing is written.

### Flow 2 — Cleaning up after an import (Epics 4, 5)

1. Camille opens Opérations, filters on « Sans catégorie » and on the last month: 58 results.
2. They search « carrefour », tick the first row, then `Shift`+click the ninth to extend the selection to the 9 rows.
3. They press « Catégorie » in the bulk bar, type « cour », pick Courses with `Enter`. The rows update and a toast states the count.
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
