# interface

## Purpose

Application shell, responsive layout and accessible controls.

## Requirements

### Requirement: Navigation and focus

Archant SHALL expose signed-in navigation, accounts and settings through its application shell and provide keyboard-accessible controls.

#### Scenario: Accessing an account from the shell

- **WHEN** a signed-in member selects a visible account
- **THEN** the app navigates to the corresponding account page.

### Requirement: Dialog dismissal

Archant SHALL support closing an open dialog or drawer with Escape.

#### Scenario: Dismissing a transaction drawer

- **WHEN** a member presses Escape while the drawer is open
- **THEN** the drawer closes.
