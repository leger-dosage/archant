## MODIFIED Requirements

### Requirement: Amounts and reporting currency

Archant SHALL store amounts as integer minor units with a currency code. Cross-account totals SHALL use the household's base currency and identify accounts excluded because their currency differs. Setup SHALL record the base currency and household preferences SHALL expose the supported settings.

#### Scenario: Choose household settings at setup

- **GIVEN** `/setup`
- **WHEN** the first administrator is created
- **THEN** the page also asks « Pays », « Devise » and « Format de date », as Sure's `onboardings/show.html.erb` and `onboardings/preferences.html.erb`; the country proposes its currency, as `Family.default_currency_for_country`.

#### Scenario: Edit household preferences

- **GIVEN** « Réglages › Préférences »
- **WHEN** the administrator opens it
- **THEN** « Général » edits « Fuseau horaire », « Format de date » among Sure's `Family::DATE_FORMATS` and « Pays »; « Budget » edits « Le mois budgétaire commence le », 1 to 28, with its hint; the currency shows as « Devise de base », read-only; only an administrator saves, as `users_controller.rb:116`.

#### Scenario: Use stored settings after upgrade

- **GIVEN** the stored settings
- **WHEN** the server computes today or totals
- **THEN** it reads the household's time zone, which replaces `APP_TIMEZONE`, and `getReportingCurrency()` in `services/settings.ts` reads the household's currency; an upgrade sets them from `APP_TIMEZONE` and `EUR`; dates Sure writes through `format_date` follow the format; Story 35.1 applies the month start day to budgets.

#### Scenario: Reporting on an account in another currency

- **WHEN** a member loads household totals with an account whose currency differs from the household's base currency
- **THEN** the account retains its own currency and is reported as excluded from the totals.
