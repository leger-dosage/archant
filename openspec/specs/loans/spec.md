# loans

## Purpose

Loan terms, projected amortisation and recorded balances.

## Requirements

### Requirement: Loan terms and amortisation

Archant SHALL let an administrator save loan terms and display an amortisation schedule where the terms support one.

#### Scenario: Opening a loan with complete amortisable terms

- **WHEN** a member opens the loan overview
- **THEN** they can see projected principal and interest and how the recorded balance compares to the plan.

### Requirement: Non-amortisable loan terms

Archant SHALL allow otherwise valid loan terms to be saved when no amortisation schedule can be computed.

#### Scenario: Saving a loan with a payment too low to amortise

- **WHEN** an administrator saves the terms
- **THEN** the terms remain available and no amortisation schedule is shown.
