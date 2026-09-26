# Epic 12 Context: A warmer interface, close to Sure

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The owner's manual QA of 2026-09-25 found the interface austere next to Sure: little colour, few icons, plain charts, no favicon. Epic 12 gives Archant Sure's look: the grey page and white cards, colour through tinted icons and category pills, a donut and a trend-coloured net worth chart, a balance sheet by account type, and an arch logo with a favicon. The owner chose this direction, the one closest to Sure, from several HTML mocks. `DESIGN.md` and `EXPERIENCE.md` in `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/` specify it, with `mockups/key-direction-a.html` and `mockups/logo.svg` as the visual reference. The spines win on conflict with the mock. The epic is a visual refresh only: no story adds a feature, an endpoint or a requirement, and every figure shown is already served by the API. It revises UX-DR1.

## Stories

- Story 12.1: The brand foundation
- Story 12.2: The dashboard
- Story 12.3: Transactions and accounts
- Story 12.4: The remaining screens

## Requirements & Constraints

- No new API route, no new served figure. Screens recompose existing data: net worth and its history over 1 M, 3 M, 6 M, 1 A and Tout, the month's income and expenses by category with uncategorised apart, accounts grouped by type with balances.
- WCAG 2.2 AA contrast in light and dark mode for every text pair, checked by a Vitest test over the theme's token pairs (Story 12.4). The interface stays keyboard-usable with visible focus, 24 px minimum targets, focus return on `Esc`, and no chart animation under `prefers-reduced-motion`.
- Meaning never depends on colour alone. Every status badge has an icon. Muted amounts (pending, excluded) always carry a badge or an icon.
- Charts keep their text summary above them and their table alternative (« Voir le tableau » / « Voir les données »), plus a keyboard-movable cursor.
- Every visible string goes through i18next (`locales/fr.json`). The copy is French with « vous », infinitive-verb buttons, no exclamation marks.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest. The pill-text contrast helper gets its own Vitest test. No test reaches the network.
- A new dependency, such as the `@fontsource-variable/geist` fonts if not yet present, needs a reason in the pull request.

## Technical Decisions

- Tokens live in the interface's Tailwind CSS 4 stylesheet on top of shadcn/ui's neutral base, for light and dark mode. Dark mode follows the system with a manual override. Tokens not listed in `DESIGN.md` inherit the neutral base. Generic shadcn components stay unchanged. Only what `DESIGN.md` names is overridden.
- Surfaces: page `#F7F7F7`, card `#FFFFFF`, tray `#F0F0F0`, sidebar on the page grey. Dark mode has its own values in `DESIGN.md`. Sure's ring shadow `0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.05)` sits on cards, trays' inner blocks, outline buttons and the active sidebar item. In dark mode it becomes `0 0 0 1px rgba(255,255,255,.08)`. Nothing else gets a shadow except shadcn's popovers, menus, sheets and dialogs.
- Radii: 6 for small tinted icons and checkboxes, 8 for buttons, inputs, medium icons and sidebar items, 10 for large icons, 12 for cards, trays, dialogs and sheets, full for pills, badges and avatars.
- Muted text on the grey page or tray uses `muted-foreground-on-grey` `#5C5C5C`, because `#737373` fails AA there.
- Tinted icon: a lucide icon at half the tile size (22, 32 or 36 px), in the full colour, on that colour mixed at 10% (`color-mix(in oklab, ...)`). Account type icons and colours are fixed:
  - depository: `landmark`, `#875BF7`
  - investment: `line-chart`, `#1570EF`
  - property: `home`, `#06AED4`
  - vehicle: `car`, `#F23E94`
  - credit card: `credit-card`, `#F13636`
  - loan: `hand-coins`, `#D444F1`

  Transfers use `arrow-left-right` in `#444CE7`. Uncategorised uses `circle-dashed` in `#737373`. A merchant without a category shows its first letter in the same style.
- Category pill: 22 px high, the category icon at 12 px and its name. Fill at 10%, border at 25%. The text is the category colour darkened in OKLCH until it reaches 4.5:1 on its own tint. One helper computes it, since the household can pick any colour. Uncategorised is a neutral « Sans catégorie » pill.
- Money: expenses in the foreground colour, never red. Income is green (`#067647` / `#32D583`) with `+`. A negative amount uses a true minus sign. Balances and totals are never coloured. Every amount renders through the one `<Money>` component and `formatMoney`, in tabular figures. Trend colours `#12B76A` and `#F13636` colour only the net worth line and its gradient, never text.
- Accent indigo `#444CE7` (dark `#8098F9`) is only for the focus ring and links, never a fill. Primary buttons are black. Destructive and warning colours keep their narrow uses.
- Typography: Geist and Geist Mono variable fonts. `display` 24 px once per page, `title` 15 px for card titles, uppercase `eyebrow` 11 px for tray headers and the sidebar's « Comptes » label, `amount-hero` 32 px for net worth and an account's balance, `code` for IBAN masks and file names.
- Charts use Recharts through shadcn `Chart`. Net worth is an `Area` with a 2 px line and a 6% to 0% gradient in the period's trend colour, no grid, and only the first and last dates on the axis. The outflows donut is a `Pie` with an inner radius, rounded ends, a small padding angle, the total in the centre, and category colours.
- Logo: a one-colour arch mark from `mockups/logo.svg`, `#171717` light and `#F7F7F7` dark, at 24 px beside « Archant ». The favicon is the same mark as an SVG following the current mode, with a 32 px PNG fallback.
- Interface conventions: shadcn copies live in `packages/app/src/components/ui/`, domain components in `components/`. Server state goes through TanStack Query. URLs stay English.

## UX & Interaction Patterns

- Layout: a 240 px sidebar with the logo, lucide-iconed navigation, and accounts under Actifs and Passifs, each with a tinted type icon, subtype caption and balance. The active entry is a white raised tile. Content is up to 1200 px wide. Cards have 20 px padding and 16 px gaps. Below 1024 px the sidebar collapses to 56 px icons. Below 768 px it becomes a sheet and the dashboard columns stack.
- Page heading row: the `display` heading, one muted sentence under it, and the page's actions on the right. The dashboard heading is « Bonjour {prénom} » followed by two actions.
- Dashboard: a full-width net worth card, then two columns. The month's flow sits on the left: income, expenses, « Épargne du mois », the donut and a tray of categories with amount and share. The balance sheet sits on the right: Actifs and Passifs totals, a 6 px weight bar split by account type with a dot legend and percentages, and a tray of accounts.
- Tray: an uppercase header inside the grey tray, then a white block of rows separated by tray-coloured lines. Trays hold account lists, the flow's category list and the transaction day groups, each group with its day subtotal. Rows are 52 px high.
- Transaction row: a tinted category icon or the merchant's letter, the label with a caption, the category pill, the account and the amount. Badges come in two kinds:
  - neutral: « En attente », « Récurrent », « Virement interne »
  - warning: « Doublon possible »

  Every badge has an icon.
- Empty state: a card with a large tinted icon, a title, one sentence and one primary button, as Sure's `DS::EmptyState`. With no account, it reads « Aucun compte pour l'instant » with « Ajouter un compte ».
- The settings navigation gets a lucide icon per entry, as Sure's does. The sign-in and setup pages show the arch logo.
- Do not fill cards, buttons or backgrounds with a category or brand colour. Do not add heavier shadows. Do not restyle shadcn beyond `DESIGN.md`.

## Cross-Story Dependencies

- Story 12.1 goes first. It supplies the tokens, the tinted icon and pill components, the pill contrast helper, the logo, the favicon and the sidebar. Stories 12.2 to 12.4 build on them in any order.
- The epic starts from the interface as Epic 11 left it. The package is `packages/app` (`@archant/app`) since Story 11.10. The command palette and single-key shortcut hints are gone since Story 11.13, so no screen shows them. Account actions sit in the « … » menu from Story 11.11.
- The dashboard restyles Epic 6's reports. The badges reflect Epic 9's recurring series, Epics 5 and 7's transfers, and Epic 10's pending entries and duplicates. Epic 10's banners (UX-DR10) and Epic 2's import dialog (UX-DR8) are restyled in Story 12.4.
