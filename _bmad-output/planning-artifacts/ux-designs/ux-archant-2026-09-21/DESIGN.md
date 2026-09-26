---
name: Archant
description: Self-hosted personal finance for one household. shadcn/ui on Vite, React and Tailwind CSS 4, base colour neutral; this file specifies the brand layer and the money semantics on top of it.
status: final
updated: '2026-09-26'
sources:
  - ../../feature-inventory.md
  - ../../epics.md
  - ../../architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md
colors:
  # Unlisted shadcn tokens (popover, input, secondary, destructive-foreground...) inherit the neutral base.
  # Light is Linear Light, read from linear.app's stylesheets. Dark is derived in LCH from the inputs
  # Linear's client passes its Classic Dark theme (base #1F2023, accent #5E6AD2, contrast 30).
  # AA wins over a hex: light muted-foreground, money-muted, money-income and link, and dark
  # destructive, are moved in OKLCH, lightness only, to the least change that passes 4.5:1.
  background: '#F8F8F8'
  panel: '#FFFFFF'
  section: '#FFFFFF'
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
  panel-dark: '#1F2023'
  section-dark: '#252629'
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
  display:
    fontFamily: 'Inter Variable'
    fontSize: 20px
    fontWeight: '590'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  title:
    fontFamily: 'Inter Variable'
    fontSize: 14px
    fontWeight: '590'
    lineHeight: '1.4'
  body:
    fontFamily: 'Inter Variable'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: 'Inter Variable'
    fontSize: 13px
    fontWeight: '510'
    lineHeight: '1.4'
  caption:
    fontFamily: 'Inter Variable'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
  amount:
    fontFamily: 'Inter Variable'
    fontSize: 13px
    fontWeight: '510'
    lineHeight: '1.5'
  amount-hero:
    fontFamily: 'Inter Variable'
    fontSize: 28px
    fontWeight: '590'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  code:
    fontFamily: 'Geist Mono Variable'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  sm: 5px
  md: 6px
  lg: 8px
  xl: 10px
  full: 9999px
spacing:
  row: 36px
  nav-item: 28px
  control: 28px
  title-bar: 44px
  panel-margin: 8px
  sidebar: 240px
  sidebar-collapsed: 56px
  content-max: 1200px
  content-padding: 24px 28px
  gap: 16px
components:
  panel:
    background: '{colors.panel}'
    border: '{colors.border}'
    radius: '{rounded.xl}'
    margin: '{spacing.panel-margin}'
  title-bar:
    height: '{spacing.title-bar}'
    divider: '{colors.line}'
    typography: '{typography.label}'
  section:
    background: '{colors.section}'
    border: '{colors.border}'
    radius: '{rounded.lg}'
  tinted-icon:
    fill: 'color-mix(in oklab, <colour> 10% light / 17% dark, transparent)'
    foreground: '<colour adjusted to 3:1 on the hover row>'
    size-sm: 20px
    size-md: 22px
    size-lg: 32px
    radius: '{rounded.md}'
  category-pill:
    fill: 'color-mix(in oklab, <colour> 10% light / 17% dark, transparent)'
    foreground: '<colour adjusted to 4.6:1 light, 6.5:1 dark, on the hover row>'
    height: 20px
    radius: '{rounded.full}'
    typography: '{typography.caption}'
  badge:
    background: '{colors.badge}'
    foreground: '{colors.foreground-secondary}'
    height: 20px
    radius: '{rounded.sm}'
  sidebar-item:
    height: '{spacing.nav-item}'
    radius: '{rounded.md}'
    icon: '{colors.muted-foreground}'
  sidebar-item-active:
    background: '{colors.active}'
    foreground: '{colors.foreground}'
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
    radius: '{rounded.md}'
  button-secondary:
    background: '{colors.section}'
    border: '{colors.border}'
    foreground: '{colors.foreground}'
    height: '{spacing.control}'
    radius: '{rounded.md}'
---

## Brand & Style

Archant holds a household's bank history and should feel like a precise tool: quiet surfaces, fine lines, compact rows, and colour kept for what carries meaning. The skin is Linear's: Linear Light in light mode, Linear Classic Dark in dark mode, Inter with Linear's alternate glyphs, and an indigo that marks the one action that matters on each screen. The content is Sure's: a greeting, net worth with its history, the month's flow by category, the balance sheet by account type, and colour that arrives through small tinted icons.

What is Archant's own: the arch mark, expenses in the text colour rather than red, and French copy. shadcn/ui with the neutral base colour covers every generic component; this file only names what Archant adds or overrides.

→ Visual reference: [mockups/key-linear-classic-dark.html](mockups/key-linear-classic-dark.html), with the logo in [mockups/logo.svg](mockups/logo.svg). This spine wins on conflict.

## Colors

The light values are Linear Light's, read from linear.app's stylesheets on 2026-09-26. The dark values are derived in LCH from the inputs Linear's client gives its Classic Dark theme, a charcoal base `#1F2023` and the indigo `#5E6AD2`: same hue and chroma, lightness stepped. They are consistent approximations, not copies.

- **Surfaces.** `{colors.background}` behind the sidebar, `{colors.panel}` for the inset panel that holds the page, `{colors.section}` for bordered sections inside it, `{colors.hover}` under a hovered row, `{colors.active}` for the active sidebar item, `{colors.selection}` for selected rows. Dark mode steps the charcoal the same way: sidebar `#1A1B1E`, panel `#1F2023`, section `#252629`, hover `#2B2D30`.
- **Text.** `{colors.foreground}` primary, `{colors.foreground-secondary}` for secondary text and badges, `{colors.muted-foreground}` for captions, axis labels and icons. Linear's quaternary text colour fails AA and is not used for text.
- **Indigo.** The primary button is `#5E6AD2` with white text (4.70:1) in both modes. In light mode the accent `#7170FF` only marks focus, selection and the chart line, since it reaches 3.84:1 on white; links use `#5A65CC`, the indigo darkened to 4.5:1 on a selected row. In dark mode the accent and links are `#818AF6`, the indigo lightened to 4.54:1 on a hovered row.
- **Category colours** are each category's own, set in the category settings. They appear only as a tint behind an icon, as a pill, or as a chart segment. The palette offered for a new category follows Linear's register: orange `#FC7840`, yellow `#F0BF00`, blue `#4EA7FC`, teal `#00B8CC`, green `#27A644`, indigo `#5E6AD2`, red `#EB5757`, violet `#9D6FE8`, pink `#E2609C`, magenta `#C95FD8`. Existing categories keep the colour they have. **Account type colours** are fixed: `{colors.type-depository}`, `{colors.type-investment}`, `{colors.type-property}`, `{colors.type-vehicle}`, `{colors.type-credit-card}`, `{colors.type-loan}`. Transfers use `{colors.transfer}`; uncategorised uses the muted text colour.
- **Money.** Income is `#1D7F34` in light (Linear's green darkened to 4.5:1 on a selected row) and `#2BA947` in dark, with a plus sign. Expenses are the text colour: spending is the normal case and is never shown in red. Pending and excluded amounts use `{colors.money-muted}`, always paired with a badge or an icon.
- **Trend up and down (`#27A644`, `#EB5757`)** only colour the arrow beside the net worth change. They never colour an amount.
- **Destructive** is only for delete actions and errors. **Warning** is only for consent expiry, stale sync and possible duplicates, drawn as an orange-tinted badge.

A category pill's text and icon colours are computed per mode by one helper, since the household can pick any colour: the text is adjusted in OKLCH to 4.6:1 in light and 6.5:1 in dark, the icon to 3:1, both measured on the hover row, the least favourable background. Every other text pair meets WCAG 2.2 AA in both modes.

## Typography

Inter, as in Linear, installed through `@fontsource-variable/inter`, with `font-feature-settings: "cv01", "ss03"` on the root. Geist Mono stays for code, through `@fontsource-variable/geist-mono`. Weights are Linear's: 400, 510 and 590.

- `{typography.body}` at 13px by default, `{typography.label}` for labels, navigation and buttons, `{typography.caption}` for dates, subtypes and axis labels.
- `{typography.display}` for the page heading, once per page. `{typography.title}` for section titles.
- `{typography.amount}` and `{typography.amount-hero}` always set `font-variant-numeric: tabular-nums`. Net worth and an account's balance use `amount-hero`.
- `{typography.code}` for IBAN masks, file names and technical references.

## Layout & Spacing

Tailwind's 4px scale, inherited. The sidebar of `{spacing.sidebar}` sits directly on `{colors.background}`, with no border: the logo and « Archant », search and a new-item button, the navigation, then « Comptes » with the accounts grouped under Actifs and Passifs, and the user at the bottom.

The page lives in one inset panel, `{components.panel}`, with `{spacing.panel-margin}` around it. Its `{components.title-bar}` shows the page icon and title, or a breadcrumb, with the page actions on the right. The content below is padded by `{spacing.content-padding}`, up to `{spacing.content-max}` wide, with sections separated by `{spacing.gap}`.

The dashboard opens with « Bonjour {prénom} » in `{typography.display}` and one muted sentence, then the net worth section at full width, then two columns: the month's flow on the left, the balance sheet on the right.

Rows are `{spacing.row}` high and sidebar items `{spacing.nav-item}`. Amount columns are right-aligned; the label column takes the remaining width and truncates with an ellipsis and a tooltip. Below 1024px the sidebar collapses to `{spacing.sidebar-collapsed}` icons; below 768px it becomes a sheet opened from the title bar, the panel loses its margin and border, and the dashboard's two columns stack.

## Elevation & Depth

No shadows on the page. Hierarchy comes from background levels and 1px borders: the panel over the base, sections inside the panel, lines between rows. Popovers, menus, sheets and dialogs keep shadcn's shadow, with a `{colors.border}` border.

## Shapes

`{rounded.sm}` for badges and checkboxes, `{rounded.md}` for buttons, inputs, tinted icons and sidebar items, `{rounded.lg}` for sections, `{rounded.xl}` for the panel, dialogs and sheets. `{rounded.full}` for pills and avatars.

## Components

Used from shadcn/ui unchanged: `Input`, `Select`, `Combobox` built on `Command` and `Popover`, `Dialog`, `Sheet`, `DropdownMenu`, `Tabs`, `Table`, `Checkbox`, `Tooltip`, `Skeleton`, `Sonner` toasts, `Chart`, `Calendar`, `Form`. Icons are `lucide-react` at 16px in navigation and 12 to 14px inside controls.

Archant components and overrides:

- **App shell.** The sidebar on the base background and the inset `{components.panel}` with its `{components.title-bar}`. Every signed-in page renders inside it.
- **Section.** `{components.section}`: a header row with a title in `{typography.title}` and an optional link or segmented control, a line, then its content. Lists inside a section have no second border.
- **Tinted icon.** `{components.tinted-icon}`: a lucide icon in the adjusted colour on the same colour's tint. Categories use their own icon and colour; account types use `landmark` (depository), `line-chart` (investment), `home` (property), `car` (vehicle), `credit-card`, `hand-coins` (loan); transfers `arrow-left-right`; uncategorised `circle-dashed`. A merchant without a category shows its first letter.
- **Category pill.** `{components.category-pill}`: the category's icon at 12px and its name. Uncategorised is a muted pill, « Sans catégorie ».
- **Badges.** `{components.badge}` with an icon for « En attente », « Récurrent » and « Virement interne »; « Doublon possible » uses the orange tint with a warning icon. Meaning never depends on colour.
- **Money.** One component renders every amount through `formatMoney`: `1 234,56 €`. Positive transaction amounts use `{components.money-income}` with a `+`; negative use `{components.money-expense}` with a true minus sign. Balances and totals are never coloured.
- **Sidebar item.** `{components.sidebar-item}`: icon, label, optional count or balance on the right. Active: `{components.sidebar-item-active}`. Account rows show a small tinted type icon, the name and the balance.
- **Transaction row.** `{components.transaction-row}`: checkbox, tinted icon, label with its caption and badges, category pill, account with its type icon, amount. Day headers are rows on `{colors.section}` with the day, the count and the day's subtotal. Hover uses `{colors.hover}`, selection `{colors.selection}` with an accent bar on the left edge.
- **Net worth section.** Value in `{components.money-hero}`, the change with a trend arrow and the period, Actifs and Passifs totals on the right, a segmented period control in the header, then a Recharts `Area`: a 1.5px line in the accent, a very faint gradient under it, horizontal gridlines in `{colors.grid}`, abbreviated axis labels « 275 k€ » in the muted text colour, and the text summary with « Voir le tableau ».
- **Month's flow section.** Income, expenses and « Épargne du mois » in a row of cells separated by lines, then a thin outflows donut in the category colours with the total in its centre, beside a list of categories with tinted icon, amount and share.
- **Balance sheet section.** For Actifs then Passifs: the group total, a 4px weight bar split by account type in the type colours with a dot legend and percentages, then the accounts with their tinted type icon, subtype and balance.
- **Empty state.** Inside a section: a `lg` tinted icon, a title, one sentence and one primary button.
- **Logo.** The arch mark of [mockups/logo.svg](mockups/logo.svg), one colour, `{colors.logo}` on light and `{colors.logo-dark}` on dark, at 20px beside « Archant » in the sidebar. The favicon is the same mark as an SVG that follows the colour scheme, with a 32px PNG fallback.

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| Separate surfaces with background levels and 1px borders | Add shadows to the panel, sections or rows |
| Keep indigo for the primary action, focus, selection and links | Fill sections or backgrounds with indigo |
| Bring colour through tinted icons, pills and chart segments | Fill a section with a category colour |
| Keep income green and expenses in the text colour | Show expenses or negative balances in red |
| Keep tabular figures on every amount | Mix proportional and tabular figures in one column |
| Pair every muted amount and every status with a badge or an icon | Rely on colour alone to say pending, excluded or duplicate |
| Inherit shadcn for every generic component | Restyle shadcn components beyond this file |
