## ADDED Requirements

### Requirement: Sure's few hotkeys

Archant SHALL support keyboard navigation in settings and the account type picker, and keep transaction saves explicit.

#### Scenario: Transaction save stays explicit

- **GIVEN** the transaction sheet
- **WHEN** the member presses `⌘Enter` or `Ctrl+Enter`
- **THEN** nothing saves: the shortcut in `TransactionForm.tsx` goes, since no Sure form binds it; « Enregistrer » saves.

#### Scenario: Leave settings with Escape

- **GIVEN** « Réglages »
- **WHEN** the member presses `Esc` with no dialog open
- **THEN** they leave for the page they came from, as Sure's `settings/_settings_nav.html.erb`, whose « Précédent » link carries an `esc` hint on wide screens.

#### Scenario: Navigate account types

- **GIVEN** the account type list of « Nouveau compte »
- **WHEN** the member presses `j`, `k` or the arrows
- **THEN** focus moves to the next or previous type, `Enter` opens it, and the footer reads « Sélectionnez », « Naviguer » and « Fermer », as Sure's `accounts/new/_container.html.erb`.

#### Scenario: Dismiss an open dialog

- **GIVEN** any dialog or drawer
- **WHEN** the member presses `Esc`
- **THEN** it closes, as Sure's `DS::Dialog` hotkey; the reports page's `←` and `→` come with Story 34.7.
