## ADDED Requirements

### Requirement: Sure's few hotkeys

Archant SHALL support keyboard navigation in settings and the account type picker, and keep transaction saves explicit.

#### Scenario: Transaction save stays explicit

- **GIVEN** the transaction sheet
- **WHEN** the member presses `⌘Enter` or `Ctrl+Enter` in a transaction or transfer form
- **THEN** the key combination does not submit the form. « Enregistrer » submits it.

#### Scenario: Leave settings with Escape

- **GIVEN** « Réglages »
- **WHEN** the member presses `Esc` with no dialog open
- **THEN** they return to the last in-app page outside settings, or the dashboard if they opened settings directly, as in Sure's `settings/_settings_nav.html.erb`, whose « Précédent » link carries an `esc` hint on wide screens.

#### Scenario: Navigate account types

- **GIVEN** the account type list of « Nouveau compte »
- **WHEN** the member presses `j`, `k` or the arrows
- **THEN** focus moves to the next or previous type, `Enter` opens it, and the footer reads « Sélectionnez », « Naviguer » and « Fermer », as Sure's `accounts/new/_container.html.erb`.

#### Scenario: Escape in settings with an open dialog

- **GIVEN** a dismissible dialog or drawer is open in settings
- **WHEN** the member presses Escape
- **THEN** the dialog closes and the current settings page stays open.

#### Scenario: Escape in settings with a dialog that blocks dismissal

- **GIVEN** an open settings dialog blocks dismissal while an operation is pending
- **WHEN** the member presses Escape
- **THEN** the dialog and the current settings page stay open.
