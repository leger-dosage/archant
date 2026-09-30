---
name: Archant
description: Self-hosted personal finance for one household. shadcn/ui on Vite, React and Tailwind CSS 4, base colour neutral; this file specifies the brand layer and the money semantics on top of it.
status: final
updated: '2026-09-29'
sources:
  - ../../feature-inventory.md
  - ../../epics.md
  - ../../../../docs/architecture.md
colors:
  # Unlisted shadcn tokens (popover, input, secondary, destructive-foreground...) inherit the neutral base.
  # Light is Linear Light, read from linear.app's stylesheets. Dark is derived in LCH from the inputs
  # Linear's client passes its Classic Dark theme (base #1F2023, accent #5E6AD2, contrast 30).
  # AA wins over a hex: light muted-foreground, money-muted, money-income and link, and dark
  # destructive, are moved in OKLCH, lightness only, to the least change that passes 4.5:1.
  # Surfaces follow Sure's layering since Epic 14: background for the page, the rail and the accounts
  # column; container for cards; inset for the grey tray that groups rows.
  background: '#F8F8F8'
  container: '#FFFFFF'
  inset: '#F2F2F3'
  hover: '#F4F4F4'
  active: '#EEEDEF'
  badge: '#F4F2F4'
  selection: '#F1F1FF'
  foreground: '#282A30'
  foreground-secondary: '#3C4149'
  muted-foreground: '#6C6B73'
  border: '#E9E8EA'
  border-strong: '#DCDBDD'
  line: '#EAEAEB'
  grid: '#F0F0F1'
  primary: '#5E6AD2'
  primary-foreground: '#FFFFFF'
  accent-brand: '#7170FF'
  link: '#5A65CC'
  ring: '#7170FF'
  destructive: '#C91313'
  warning: '#A64F2A'
  money-income: '#1D7F34'
  money-expense: '#282A30'
  money-muted: '#6C6B73'
  trend-up: '#27A644'
  trend-down: '#EB5757'
  background-dark: '#1A1B1E'
  container-dark: '#1F2023'
  inset-dark: '#252629'
  hover-dark: '#2B2D30'
  active-dark: '#27282B'
  badge-dark: '#303134'
  selection-dark: '#292C3F'
  foreground-dark: '#EEEFF1'
  foreground-secondary-dark: '#CBCCCE'
  muted-foreground-dark: '#929496'
  border-dark: '#323336'
  border-strong-dark: '#3F4044'
  line-dark: '#2D2E31'
  grid-dark: '#292A2E'
  primary-dark: '#5E6AD2'
  primary-foreground-dark: '#FFFFFF'
  accent-brand-dark: '#818AF6'
  link-dark: '#818AF6'
  ring-dark: '#818AF6'
  destructive-dark: '#FE5C5A'
  warning-dark: '#FEBCA0'
  money-income-dark: '#2BA947'
  money-expense-dark: '#EEEFF1'
  money-muted-dark: '#929496'
  type-depository: '#9D6FE8'
  type-investment: '#4EA7FC'
  type-property: '#00B8CC'
  type-vehicle: '#E2609C'
  type-credit-card: '#EB5757'
  type-loan: '#C95FD8'
  transfer: '#5E6AD2'
  logo: '#282A30'
  logo-dark: '#EEEFF1'
typography:
  # Tailwind's default scale, as in Sure. Weights stay Linear's: 510 for medium, 590 for semibold.
  greeting:
    fontFamily: 'Inter Variable'
    fontSize: 30px
    fontWeight: '510'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  page-title:
    fontFamily: 'Inter Variable'
    fontSize: 24px
    fontWeight: '510'
    lineHeight: '1.33'
    letterSpacing: -0.01em
  section-title:
    fontFamily: 'Inter Variable'
    fontSize: 18px
    fontWeight: '510'
    lineHeight: '1.55'
  card-title:
    fontFamily: 'Inter Variable'
    fontSize: 16px
    fontWeight: '510'
    lineHeight: '1.5'
  body:
    fontFamily: 'Inter Variable'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.43'
  label:
    fontFamily: 'Inter Variable'
    fontSize: 14px
    fontWeight: '510'
    lineHeight: '1.43'
  caption:
    fontFamily: 'Inter Variable'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.33'
  overline:
    fontFamily: 'Inter Variable'
    fontSize: 12px
    fontWeight: '510'
    lineHeight: '1.33'
    letterSpacing: 0.02em
    textTransform: uppercase
  rail-label:
    fontFamily: 'Inter Variable'
    fontSize: 11px
    fontWeight: '510'
    lineHeight: '1.27'
  amount:
    fontFamily: 'Inter Variable'
    fontSize: 14px
    fontWeight: '510'
    lineHeight: '1.43'
  amount-summary:
    fontFamily: 'Inter Variable'
    fontSize: 20px
    fontWeight: '510'
    lineHeight: '1.4'
  amount-hero:
    fontFamily: 'Inter Variable'
    fontSize: 30px
    fontWeight: '510'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  code:
    fontFamily: 'Geist Mono Variable'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  # Tailwind's defaults, as in Sure.
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  rail: 84px
  rail-tile: 32px
  accounts-column: 320px
  settings-nav: 256px
  top-bar: 69px
  content-padding: 40px
  content-padding-mobile: 12px
  settings-content-max: 896px
  gap: 24px
  card-padding: 16px
  inset-padding: 4px
  row: 56px
  control-sm: 28px
  control: 36px
  control-lg: 48px
  dialog-sm: 300px
  dialog: 550px
  dialog-lg: 700px
  drawer: 550px
  menu-min: 200px
components:
  rail-item:
    tile: '{spacing.rail-tile}'
    radius: '{rounded.lg}'
    icon: '{colors.muted-foreground}'
    typography: '{typography.rail-label}'
  rail-item-active:
    tile-background: '{colors.container}'
    tile-border: '{colors.border}'
    foreground: '{colors.foreground}'
  card:
    background: '{colors.container}'
    border: '{colors.border}'
    radius: '{rounded.xl}'
    padding: '{spacing.card-padding}'
  inset-group:
    background: '{colors.inset}'
    radius: '{rounded.xl}'
    padding: '{spacing.inset-padding}'
    header: '{typography.overline}'
    inner-background: '{colors.container}'
    inner-border: '{colors.border}'
    inner-radius: '{rounded.lg}'
  tinted-icon:
    fill: 'color-mix(in oklab, <colour> 10% light / 17% dark, transparent)'
    foreground: '<colour adjusted to 3:1 on the hover row>'
    size-sm: 20px
    size-md: 28px
    size-lg: 36px
    radius: '{rounded.md} at sm, {rounded.lg} at md, 10px at lg'
  category-pill:
    fill: 'color-mix(in oklab, <colour> 10% light / 17% dark, transparent)'
    foreground: '<colour adjusted to 4.6:1 light, 6.5:1 dark, on the hover row>'
    height: 24px
    radius: '{rounded.full}'
    typography: '{typography.caption}'
  badge:
    background: '{colors.badge}'
    foreground: '{colors.foreground-secondary}'
    height: 22px
    radius: '{rounded.md}'
  transaction-row:
    height: '{spacing.row}'
    divider: '{colors.line}'
    hover: '{colors.hover}'
    selected: '{colors.selection}'
  money-income:
    foreground: '{colors.money-income}'
    typography: '{typography.amount}'
  money-expense:
    foreground: '{colors.money-expense}'
    typography: '{typography.amount}'
  money-hero:
    foreground: '{colors.foreground}'
    typography: '{typography.amount-hero}'
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    height: '{spacing.control}'
    radius: '{rounded.lg}'
  button-outline:
    background: '{colors.container}'
    border: '{colors.border}'
    foreground: '{colors.foreground}'
    height: '{spacing.control}'
    radius: '{rounded.lg}'
  input:
    background: '{colors.container}'
    border: '{colors.border}'
    height: '{spacing.control}'
    radius: '{rounded.lg}'
    typography: '{typography.body}'
---

## Brand & Style

Archant holds a household's bank history and should read comfortably: Sure's pages, proportions and type scale, with room around the figures, and colour kept for what carries meaning. Since Epic 14, Linear is a light layer over Sure rather than the skin: Linear Light and Linear Classic Dark for the colours, Inter with Linear's alternate glyphs, 1px lines instead of shadows, and an indigo that marks the one action that matters on each screen. The content is Sure's: a greeting, net worth with its history, the month's flow by category, the balance sheet by account type, and colour that arrives through tinted icons.

What is Archant's own: the arch mark, expenses in the text colour rather than red, and French copy. shadcn/ui with the neutral base colour covers every generic component; this file names what Archant adds or overrides, including shadcn's control sizes, which move to Sure's.

→ Visual reference: [mockups/sure-proportions-frame-and-font.html](mockups/sure-proportions-frame-and-font.html) with frame A and Inter (`?frame=a&font=inter`); its frame B was rejected. The dashboard's content and the dark palette stay illustrated by [mockups/key-linear-classic-dark.html](mockups/key-linear-classic-dark.html), whose shell and sizes are superseded. The logo is [mockups/logo.svg](mockups/logo.svg). This spine wins on conflict.

## Colors

The light values are Linear Light's, read from linear.app's stylesheets on 2026-09-26. The dark values are derived in LCH from the inputs Linear's client gives its Classic Dark theme, a charcoal base `#1F2023` and the indigo `#5E6AD2`: same hue and chroma, lightness stepped. They are consistent approximations, not copies.

- **Surfaces.** Sure's layering in Linear's values. `{colors.background}` under the page, the rail and the accounts column; `{colors.container}` for cards, inner row blocks, dialogs and the drawer; `{colors.inset}` for the grey tray that groups rows and for column headers; `{colors.hover}` under a hovered row; `{colors.active}` for the active entry of the accounts column and the settings navigation; `{colors.selection}` for selected rows. Dark mode steps the charcoal the same way: background `#1A1B1E`, container `#1F2023`, inset `#252629`, hover `#2B2D30`. `{colors.inset}` in light, `#F2F2F3`, is the lightest grey that keeps muted text, income and links at 4.5:1.
- **Text.** `{colors.foreground}` primary, `{colors.foreground-secondary}` for secondary text and badges, `{colors.muted-foreground}` for captions, axis labels and icons. Linear's quaternary text colour fails AA and is not used for text.
- **Indigo.** The primary button is `#5E6AD2` with white text (4.70:1) in both modes. In light mode the accent `#7170FF` only marks focus, selection and the chart line, since it reaches 3.84:1 on white; links use `#5A65CC`, the indigo darkened to 4.5:1 on a selected row. In dark mode the accent and links are `#818AF6`, the indigo lightened to 4.54:1 on a hovered row.
- **Category colours** are each category's own, set in the category settings. They appear only as a tint behind an icon, as a pill, or as a chart segment. The palette offered for a new category follows Linear's register: orange `#FC7840`, yellow `#F0BF00`, blue `#4EA7FC`, teal `#00B8CC`, green `#27A644`, indigo `#5E6AD2`, red `#EB5757`, violet `#9D6FE8`, pink `#E2609C`, magenta `#C95FD8`. Existing categories keep the colour they have. **Account type colours** are fixed: `{colors.type-depository}`, `{colors.type-investment}`, `{colors.type-property}`, `{colors.type-vehicle}`, `{colors.type-credit-card}`, `{colors.type-loan}`. Transfers use `{colors.transfer}`; uncategorised uses the muted text colour.
- **Money.** Income is `#1D7F34` in light (Linear's green darkened to 4.5:1 on a selected row) and `#2BA947` in dark, with a plus sign. Expenses are the text colour: spending is the normal case and is never shown in red. Pending and excluded amounts use `{colors.money-muted}`, always paired with a badge or an icon.
- **Trend up and down (`#27A644`, `#EB5757`)** only colour the arrow beside the net worth change. They never colour an amount.
- **Destructive** is only for delete actions and errors. **Warning** is only for consent expiry, stale sync and possible duplicates, drawn as an orange-tinted badge.

A category pill's text and icon colours are computed per mode by one helper, since the household can pick any colour: the text is adjusted in OKLCH to 4.6:1 in light and 6.5:1 in dark, the icon to 3:1, both measured on the hover row, the least favourable background. Every other text pair meets WCAG 2.2 AA in both modes.

## Typography

Inter, installed through `@fontsource-variable/inter`, with `font-feature-settings: "cv01", "ss03"` on the root. Geist Mono stays for code, through `@fontsource-variable/geist-mono`. Weights are Linear's, 400, 510 and 590; sizes are Tailwind's defaults, as in Sure, and no `--text-*` token is overridden.

- `{typography.body}` at 14px by default, `{typography.label}` for labels, navigation, buttons and row labels, `{typography.caption}` for the line under a row label, subtypes, dates and axis labels.
- `{typography.page-title}` once per page, in the page header; the dashboard's greeting uses `{typography.greeting}`. `{typography.section-title}` for a section inside a page, `{typography.card-title}` for a card's header.
- `{typography.overline}`, uppercase 12px, for column headers, day groups, account groups and settings groups, as in Sure.
- `{typography.rail-label}` only under the rail's icons.
- `{typography.amount}`, `{typography.amount-summary}` and `{typography.amount-hero}` always set `font-variant-numeric: tabular-nums`. Net worth and an account's balance use `amount-hero`; the figures of a summary strip use `amount-summary`.
- `{typography.code}` for IBAN masks, file names and technical references.

## Layout & Spacing

Tailwind's 4px scale, inherited. The shell is Sure's, from 1024px up:

- **Rail.** `{spacing.rail}` wide on `{colors.background}`, with a 1px `{colors.border}` on its right: the arch logo at 28px, then one `{components.rail-item}` per destination (Accueil, Opérations, Comptes, Récurrent, Règles, Réglages), each a `{spacing.rail-tile}` tile holding a 16px icon, its label under it, then the user's avatar at the bottom.
- **Accounts column.** `{spacing.accounts-column}` wide on `{colors.background}`, with a 1px border on its right, and collapsible from the top bar. « Ajouter un compte » at the top, tabs Tout, Actifs, Passifs, then accounts grouped by type under an `{typography.overline}` header with the group's total, each row an 8px-radius item with a `md` tinted type icon, the name over the subtype, and the balance.
- **Top bar.** Sticky, on `{colors.background}`, `{spacing.top-bar}` high with a 1px `{colors.line}` under it: the button that folds the accounts column, then breadcrumbs in `{typography.label}`, the current page in the foreground colour and its parents muted.
- **Content.** Full width, padded by `{spacing.content-padding}` on each side and 24px under the top bar, with no maximum width. It opens with the page header: the title in `{typography.page-title}`, an optional muted sentence under it, and the page actions on the right as 36px buttons. Blocks below are separated by `{spacing.gap}`.
- **Settings.** The accounts column is replaced by a `{spacing.settings-nav}` navigation column; the settings content is centred and at most `{spacing.settings-content-max}` wide.

The dashboard opens with « Bonjour {prénom} » in `{typography.greeting}` and one muted sentence in the page header, then its cards in one column, two columns from 1536px: on a 1440px screen the rail and the accounts column leave about 950px, too narrow for two.

Rows of the transactions list are `{spacing.row}` high: 10px of vertical padding around a 36px tinted icon. That is the one proportion improved over Sure, whose rows reach 68px. Amount columns are right-aligned; the label column takes the remaining width and truncates with an ellipsis and a tooltip.

Below 1024px, as in Sure: a top bar with the menu button, the logo and the user menu; a fixed bottom navigation on `{colors.background}` with the rail's entries; the accounts column opens as a full-screen overlay; content padding drops to `{spacing.content-padding-mobile}` and leaves room above the bottom navigation.

## Elevation & Depth

No shadows on the page. Hierarchy comes from background levels and 1px borders: cards on the background, the inset tray around a block of rows, lines between rows. This is where Linear overrides Sure, whose cards carry a ring shadow. Popovers, menus, the drawer and dialogs keep shadcn's shadow, with a `{colors.border}` border.

## Shapes

`{rounded.sm}` for checkboxes, `{rounded.md}` for badges, small buttons, menu items and `sm` tinted icons, `{rounded.lg}` for buttons, inputs, tabs, menus, the inner block of an inset group and the rail's tiles, `{rounded.xl}` for cards, inset trays, dialogs and the drawer. `{rounded.full}` for pills and avatars.

## Components

Used from shadcn/ui: `Input`, `Select`, `Combobox` built on `Command` and `Popover`, `Dialog`, `Sheet`, `DropdownMenu`, `Tabs`, `Table`, `Checkbox`, `Tooltip`, `Skeleton`, `Sonner` toasts, `Chart`, `Calendar`, `Form`. Their sizes follow this file: buttons `{spacing.control-sm}`, `{spacing.control}` by default and `{spacing.control-lg}`, with a 36px square icon button; inputs and select triggers `{spacing.control}`; dialogs `{spacing.dialog}` wide by default, `{spacing.dialog-sm}` for confirmations and `{spacing.dialog-lg}` for import and rules; menus at least `{spacing.menu-min}`; tabs as Sure's, a grey `{colors.inset}` track with 4px padding and the active tab on `{colors.container}`. Icons are `lucide-react` at 16px, 12 to 14px inside pills and badges.

Archant components and overrides:

- **App shell.** The rail, the accounts column and the top bar of Layout & Spacing. Every signed-in page renders inside it; the sign-in, setup and error pages do not.
- **Page header.** Title, optional sentence, actions on the right. One per page, never inside a card.
- **Card.** `{components.card}`: an optional header row with a title in `{typography.card-title}` and a link or segmented control on the right, then its content. Replaces Epic 12's section.
- **Inset group.** `{components.inset-group}`: a grey tray holding an `{typography.overline}` header, the group's name or day on the left and its total on the right, above a white bordered block of rows separated by `{colors.line}`. Used for the transactions' day groups, the accounts page's groups, the balance sheet, recurring, rules and settings lists.
- **Summary strip.** A card split into equal cells by lines, each with a muted label over a figure in `{typography.amount-summary}`: Opérations, Revenus, Dépenses on the transactions page, and the month's flow on the dashboard.
- **Tinted icon.** `{components.tinted-icon}`: a lucide icon in the adjusted colour on the same colour's tint, `lg` in transaction rows and empty states, `md` in the accounts column and the balance sheet, `sm` beside an account name inside a row. Categories use their own icon and colour; account types use `landmark` (depository), `line-chart` (investment), `home` (property), `car` (vehicle), `credit-card`, `hand-coins` (loan); transfers `arrow-left-right`; uncategorised `circle-dashed`. A merchant without a category shows its first letter.
- **Category pill.** `{components.category-pill}`: the category's icon at 12px and its name. Uncategorised is a muted pill, « Sans catégorie ».
- **Badges.** `{components.badge}` with an icon for « En attente », « Récurrent » and « Virement interne »; « Doublon possible » uses the orange tint with a warning icon. Meaning never depends on colour.
- **Money.** One component renders every amount through `formatMoney`: `1 234,56 €`. Positive transaction amounts use `{components.money-income}` with a `+`; negative use `{components.money-expense}` with a true minus sign. Balances and totals are never coloured.
- **Transaction row.** `{components.transaction-row}`: checkbox, `lg` tinted icon, label over its caption with badges, category pill, account with its `sm` type icon, amount. Rows sit in the day's inset group, whose header holds the day, the count and the day's subtotal. Hover uses `{colors.hover}`, selection `{colors.selection}` with an accent bar on the left edge. An `{typography.overline}` column header on `{colors.inset}` sits above the first group.
- **Transaction drawer.** The transaction sheet is a `{spacing.drawer}` drawer on the right, inset 12px from the viewport edges with `{rounded.xl}` corners, as Sure's; full screen below 768px.
- **Net worth card.** Value in `{components.money-hero}`, the change with a trend arrow and the period, Actifs and Passifs totals on the right, a segmented period control in the header, then a Recharts `Area` 208px high: a 1.5px line in the accent, a very faint gradient under it, horizontal gridlines in `{colors.grid}`, abbreviated axis labels « 275 k€ » in the muted text colour, and the text summary with « Voir le tableau ».
- **Month's flow card.** A summary strip of income, expenses and « Épargne du mois », then a thin outflows donut in the category colours with the total in its centre, beside a list of categories with tinted icon, amount and share.
- **Balance sheet card.** For Actifs then Passifs: the group total, a 6px weight bar split by account type in the type colours with a dot legend and percentages, then an inset group of the accounts with their `md` tinted type icon, subtype and balance.
- **Empty state.** Inside a card: an `lg` tinted icon, a title, one sentence and one primary button.
- **Logo.** The arch mark of [mockups/logo.svg](mockups/logo.svg), one colour, `{colors.logo}` on light and `{colors.logo-dark}` on dark, at 28px at the top of the rail and at 32px on the pages outside the shell. The favicon is the same mark as an SVG that follows the colour scheme, with a 32px PNG fallback.

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| Keep Tailwind's default type scale and Sure's control sizes | Shrink text below 14px for body copy, or controls below 28px |
| Put the page title in the page header, above the content | Put the page title in a bar or inside a card |
| Separate surfaces with background levels and 1px borders | Add shadows to cards, trays or rows |
| Keep indigo for the primary action, focus, selection and links | Fill cards or backgrounds with indigo |
| Bring colour through tinted icons, pills and chart segments | Fill a card with a category colour |
| Keep income green and expenses in the text colour | Show expenses or negative balances in red |
| Keep tabular figures on every amount | Mix proportional and tabular figures in one column |
| Pair every muted amount and every status with a badge or an icon | Rely on colour alone to say pending, excluded or duplicate |
| Inherit shadcn for every generic component, at this file's sizes | Restyle shadcn components beyond this file |
