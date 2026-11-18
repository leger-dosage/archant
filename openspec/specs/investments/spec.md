# investments

## Purpose

Securities, prices, trades, positions and investment income.

## Requirements

### Requirement: Security prices

Archant SHALL use dated prices supplied by the administrator or fetched when the household enables price fetching.

#### Scenario: Valuing a position

- **WHEN** a price is available for a security on the requested date
- **THEN** the position is valued using its units and the applicable price.

### Requirement: Trades and holdings

Archant SHALL track buy and sell transactions, positions, average cost and gains. Purchase fees SHALL contribute to cost basis.

#### Scenario: Recording a purchase with a fee

- **WHEN** an administrator records a purchase of a held security that carries a fee
- **THEN** the holding includes the purchased units and the fee in its cost basis.

### Requirement: Investment activity

Archant SHALL distinguish trades, investment contributions, dividends, interest and fees in the investment ledger.

#### Scenario: Reading investment income

- **WHEN** a member views an account with a recorded dividend
- **THEN** the activity identifies the dividend separately from trades.
