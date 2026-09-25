---
name: Archant
description: Self-hosted personal finance for one household. shadcn/ui on Vite, React and Tailwind CSS 4, base colour neutral; this file specifies the brand layer and the money semantics on top of it.
status: final
updated: '2026-09-25'
sources:
  - ../../feature-inventory.md
  - ../../epics.md
  - ../../architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md
colors:
  # Unlisted shadcn tokens (popover, muted, input, secondary, destructive-foreground...) inherit the neutral base.
  background: '#F7F7F7'
  card: '#FFFFFF'
  tray: '#F0F0F0'
  foreground: '#171717'
  muted-foreground: '#737373'
  muted-foreground-on-grey: '#5C5C5C'
  border: '#E7E7E7'
  sidebar: '#F7F7F7'
  primary: '#171717'
  primary-foreground: '#FFFFFF'
  accent-brand: '#444CE7'
  ring: '#444CE7'
  destructive: '#C91313'
  warning: '#B54708'
  money-income: '#067647'
  money-expense: '#171717'
  money-muted: '#737373'
  trend-up: '#12B76A'
  trend-down: '#F13636'
  background-dark: '#0B0B0B'
  card-dark: '#171717'
  tray-dark: '#1F1F1F'
  foreground-dark: '#F7F7F7'
  muted-foreground-dark: '#A3A3A3'
  border-dark: '#242424'
  sidebar-dark: '#0B0B0B'
  primary-dark: '#F7F7F7'
  primary-foreground-dark: '#171717'
  accent-brand-dark: '#8098F9'
  ring-dark: '#8098F9'
  destructive-dark: '#ED4E4E'
  warning-dark: '#FDB022'
  money-income-dark: '#32D583'
  money-expense-dark: '#F7F7F7'
  money-muted-dark: '#A3A3A3'
  type-depository: '#875BF7'
  type-investment: '#1570EF'
  type-property: '#06AED4'
  type-vehicle: '#F23E94'
  type-credit-card: '#F13636'
  type-loan: '#D444F1'
  transfer: '#444CE7'
  uncategorised: '#737373'
  logo: '#171717'
  logo-dark: '#F7F7F7'
typography:
  display:
    fontFamily: 'Geist Variable'
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.25'
    letterSpacing: -0.02em
  title:
    fontFamily: 'Geist Variable'
    fontSize: 15px
    fontWeight: '600'
    lineHeight: '1.4'
  body:
    fontFamily: 'Geist Variable'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: 'Geist Variable'
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
  caption:
    fontFamily: 'Geist Variable'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
  eyebrow:
    fontFamily: 'Geist Variable'
    fontSize: 11px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.04em
  amount:
    fontFamily: 'Geist Variable'
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.5'
  amount-hero:
    fontFamily: 'Geist Variable'
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  code:
    fontFamily: 'Geist Mono Variable'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  full: 9999px
spacing:
  row: 52px
  sidebar: 240px
  sidebar-collapsed: 56px
  content-max: 1200px
  card-padding: 20px
  gap: 16px
components:
  card:
    background: '{colors.card}'
    radius: '{rounded.xl}'
    padding: '{spacing.card-padding}'
    shadow: '0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.05)'
  tray:
    background: '{colors.tray}'
    radius: '{rounded.xl}'
    padding: 4px
    header: '{typography.eyebrow}'
    header-foreground: '{colors.muted-foreground-on-grey}'
  tinted-icon:
    fill: 'color-mix(in oklab, <colour> 10%, transparent)'
    foreground: '<colour>'
    size-sm: 22px
    size-md: 32px
    size-lg: 36px
    radius-sm: '{rounded.sm}'
    radius-md: '{rounded.md}'
    radius-lg: '{rounded.lg}'
  category-pill:
    fill: 'color-mix(in oklab, <colour> 10%, transparent)'
    border: 'color-mix(in oklab, <colour> 25%, transparent)'
    foreground: '<colour darkened to 4.5:1 on its fill>'
    height: 22px
    radius: '{rounded.full}'
    typography: '{typography.caption}'
  sidebar-item-active:
    background: '{colors.card}'
    foreground: '{colors.foreground}'
    shadow: '0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.05)'
    radius: '{rounded.md}'
  money-income:
    foreground: '{colors.money-income}'
    typography: '{typography.amount}'
  money-expense:
    foreground: '{colors.money-expense}'
    typography: '{typography.amount}'
  money-hero:
    foreground: '{colors.foreground}'
    typography: '{typography.amount-hero}'
  transaction-row:
    height: '{spacing.row}'
    divider: '{colors.tray}'
  badge-neutral:
    foreground: '#525252'
    background: '#F5F5F5'
    border: '#E5E5E5'
    radius: '{rounded.full}'
  badge-warning:
    foreground: '{colors.warning}'
    background: '#FFFAEB'
    border: '#FEDF89'
    radius: '{rounded.full}'
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.md}'
  button-outline:
    background: '{colors.card}'
    shadow: '0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.1)'
    radius: '{rounded.md}'
---

## Brand & Style

Archant holds a household's bank history and should read as calmly as Sure does: the same grey page, the same white cards, the same Geist type, and colour that arrives through small tinted icons rather than through large surfaces. The interface stays dense and exact; the difference from Sure lies in what the product does, not in a different look.

What remains Archant's own is small and deliberate: the arch mark, black primary buttons, expenses in the foreground colour rather than red, and French copy. shadcn/ui with the neutral base colour covers every generic component; this file only names what Archant adds or overrides.

→ Visual reference: [mockups/key-direction-a.html](mockups/key-direction-a.html), with the logo in [mockups/logo.svg](mockups/logo.svg). This spine wins on conflict.

## Colors

Surfaces are Sure's greys. The page is `{colors.background}`, content sits in white `{colors.card}` blocks, and lists sit in a `{colors.tray}` tray. The sidebar shares the page grey.

- **Foreground (`#171717` light, `#F7F7F7` dark)** is the text colour and the primary button colour. Primary actions are black on white, as in Sure.
- **Accent indigo (`#444CE7` light, `#8098F9` dark)**, Sure's `indigo.600`, marks the focus ring and links. It never fills a surface.
- **Category colours** are each category's own colour, set in the category settings and drawn from Sure's default palette. They appear only as a 10% tint behind an icon, as a pill, or as a chart segment. **Account type colours** are fixed, from Sure: `{colors.type-depository}` for current and savings accounts, `{colors.type-investment}`, `{colors.type-property}`, `{colors.type-vehicle}`, `{colors.type-credit-card}`, `{colors.type-loan}`. Transfers use `{colors.transfer}`, uncategorised `{colors.uncategorised}`.
- **Money income (`#067647` light, `#32D583` dark)** colours positive amounts in lists, with a plus sign. **Money expense** is the foreground colour: spending is the normal case and is never shown in red.
- **Money muted (`#737373` light, `#A3A3A3` dark)** is for pending and excluded amounts, always paired with a badge or an icon.
- **Trend up and down (`#12B76A`, `#F13636`)** colour only the net worth line and its gradient, by the sign of the change over the chosen period. They never colour text.
- **Destructive (`#C91313` light, `#ED4E4E` dark)** is only for delete actions and errors. **Warning (`#B54708` light, `#FDB022` dark)** is only for consent expiry, stale sync and possible duplicates.

`#737373` fails AA on the page grey and on the tray, so text there uses `{colors.muted-foreground-on-grey}` (5.87:1 on `#F0F0F0`). A category pill's text is the category colour darkened in OKLCH until it reaches 4.5:1 on its own tint; a helper computes it, since the household can pick any colour. Every other text pair meets WCAG 2.2 AA in both modes.

## Typography

Geist and Geist Mono, as in Sure, installed through `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`.

- `{typography.body}` at 14px by default, `{typography.label}` for form labels and muted figure labels, `{typography.caption}` for dates, subtypes and secondary lines.
- `{typography.display}` for the page heading, once per page. `{typography.title}` for card titles.
- `{typography.eyebrow}`, uppercase, for tray headers and the sidebar's « Comptes » label.
- `{typography.amount}` and `{typography.amount-hero}` always set `font-variant-numeric: tabular-nums`. Net worth and an account's balance use `amount-hero`.
- `{typography.code}` for IBAN masks, file names and technical references.

## Layout & Spacing

Tailwind's 4px scale, inherited. A left sidebar of `{spacing.sidebar}` on the page grey holds the logo, the navigation and the accounts grouped under Actifs and Passifs; content sits beside it, up to `{spacing.content-max}` wide. Cards are separated by `{spacing.gap}` and padded by `{spacing.card-padding}`.

Each page opens with a heading row: the heading in `{typography.display}` with one muted sentence under it, and the page's actions on the right. On the dashboard the heading is « Bonjour {prénom} ».

The dashboard stacks the net worth card at full width, then two columns: the month's flow on the left, the balance sheet on the right.

Rows are `{spacing.row}` high. Amount columns are right-aligned; the label column takes the remaining width and truncates with an ellipsis and a tooltip. Below 1024px the sidebar collapses to `{spacing.sidebar-collapsed}` icons; below 768px it becomes a sheet opened from the top bar, and the dashboard's two columns stack.

## Elevation & Depth

Cards, trays' inner blocks, outline buttons and the active sidebar item carry Sure's ring shadow: `0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.05)`. It separates white from grey without a visible border. Popovers, menus, sheets and dialogs keep shadcn's larger shadow. Nothing else has a shadow. In dark mode the ring becomes `0 0 0 1px rgba(255,255,255,.08)`.

## Shapes

`{rounded.sm}` for small tinted icons and checkboxes, `{rounded.md}` for buttons, inputs, medium tinted icons and sidebar items, `{rounded.lg}` for large tinted icons, `{rounded.xl}` for cards, trays, dialogs and sheets. `{rounded.full}` for pills, badges and avatars.

## Components

Used from shadcn/ui unchanged: `Input`, `Select`, `Combobox` built on `Command` and `Popover`, `Dialog`, `Sheet`, `DropdownMenu`, `Tabs`, `Table`, `Checkbox`, `Tooltip`, `Skeleton`, `Sonner` toasts, `Chart`, `Calendar`, `Form`. Icons are `lucide-react`.

Archant components and overrides:

- **Card.** `{components.card}`: a title in `{typography.title}` with an optional link or segmented control on the right, then its content.
- **Tray.** `{components.tray}`: an uppercase header row inside the grey tray, then a white block with the ring shadow holding rows separated by `{colors.tray}` lines. Used for account lists, the category list of the month's flow and the day groups of the transactions list.
- **Tinted icon.** `{components.tinted-icon}`: a lucide icon at half the tile size, in the full colour, on the same colour at 10%. Categories use their own icon and colour; account types use the icons `landmark` (depository), `line-chart` (investment), `home` (property), `car` (vehicle), `credit-card`, `hand-coins` (loan); transfers `arrow-left-right`; uncategorised `circle-dashed`. A merchant without a category shows its first letter in the same style.
- **Category pill.** `{components.category-pill}`: the category's icon at 12px and its name. Uncategorised is a neutral pill, « Sans catégorie ».
- **Badges.** `{components.badge-neutral}` for « En attente », « Récurrent » and « Virement interne », `{components.badge-warning}` for « Doublon possible ». Each has an icon, so meaning never depends on colour.
- **Money.** One component renders every amount through `formatMoney`: `1 234,56 €`. Positive transaction amounts use `{components.money-income}` with a `+`; negative use `{components.money-expense}` with a true minus sign. Balances and totals are never coloured. Pending and excluded amounts use `{colors.money-muted}`.
- **Sidebar item.** A lucide icon at 16px, the label, an optional count or balance on the right. Active: `{components.sidebar-item-active}`. Account rows show a small tinted type icon, the name, the subtype as a caption and the balance.
- **Net worth card.** Label, value in `{components.money-hero}`, then the change over the period with a trend arrow, then Actifs and Passifs totals, a segmented period control on the right, and the chart: a Recharts `Area` with a 2px line in `{colors.trend-up}` or `{colors.trend-down}`, a gradient from 6% to 0% under it, no grid, only the first and last dates on the axis, and a text summary with « Voir le tableau ».
- **Month's flow card.** Income, expenses and « Épargne du mois » in a row, then an outflows donut beside a tray of categories. The donut is a Recharts `Pie` with an inner radius, rounded segment ends, a small padding angle and the total in the centre; segments use the category colours. Each tray row shows the tinted category icon, the name, the amount and its share.
- **Balance sheet card.** For Actifs then Passifs: the group total, a 6px weight bar split by account type in the type colours with a dot legend and percentages, then a tray of accounts with their tinted type icon, subtype and balance.
- **Empty state.** Inside a card: a `lg` tinted icon, a title, one sentence and one primary button, as Sure's `DS::EmptyState`.
- **Logo.** The arch mark of [mockups/logo.svg](mockups/logo.svg), one colour, `{colors.logo}` on light and `{colors.logo-dark}` on dark, at 24px beside « Archant » in the sidebar. The favicon is the same mark as an SVG, with a 32px PNG fallback.

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| Bring colour through tinted icons, pills and chart segments | Fill cards, buttons or backgrounds with a category or brand colour |
| Keep income green and expenses in the foreground colour | Show expenses or negative balances in red |
| Colour the net worth line by its trend | Colour a text amount by its trend |
| Keep tabular figures on every amount | Mix proportional and tabular figures in one column |
| Pair every muted amount and every status with a badge or an icon | Rely on colour alone to say pending, excluded or duplicate |
| Separate white from grey with the ring shadow | Add a heavier shadow to cards or rows |
| Inherit shadcn for every generic component | Restyle shadcn components beyond this file |
