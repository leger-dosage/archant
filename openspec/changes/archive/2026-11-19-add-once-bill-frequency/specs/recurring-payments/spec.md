## ADDED Requirements

### Requirement: Schedule a one-off bill or income

Archant SHALL let administrators schedule a bill or income once on a valid date through Bills and the existing bill assistant tools. This schedule SHALL have one due date and SHALL use the existing occurrence and payment contracts.

#### Scenario: A dated obligation in planning views

- **WHEN** the administrator declares a bill or an income with the Once frequency
- **THEN** Bills shows the selected date and the relevant Upcoming and budget views apply their existing date, status and direction rules to that occurrence.
- **AND** subsequent generation adds no other scheduled date, even in a later year.
- **AND** the occurrence contributes its amount on its date without a monthly or annual equivalent.

#### Scenario: An overdue one-off

- **WHEN** the selected date is already overdue
- **THEN** Bills shows the open occurrence on that date for payment.

#### Scenario: Editing the date

- **WHEN** the administrator moves an open, unallocated one-off to another date
- **THEN** the new date replaces its original occurrence even if it was overdue.
- **AND** earlier obligations kept from a repeating schedule remain payable.

#### Scenario: Preserving payment history

- **WHEN** the administrator tries to move a one-off whose occurrence is closed or carries an allocation
- **THEN** Archant refuses the date change and preserves the occurrence and its allocations.

#### Scenario: Changing frequency

- **WHEN** the administrator changes a repeating schedule to Once without supplying a date
- **THEN** the schedule uses the current due date and preserves earlier obligations under the existing regeneration rules.
- **WHEN** the administrator switches back to a repeating frequency
- **THEN** future dates follow the selected cadence without the one-occurrence limit.

#### Scenario: Importing an archived one-off schedule

- **WHEN** an archive contains a compatible one-off bill or income
- **THEN** Archant reads its existing rule, anchor and count as a Once schedule.
