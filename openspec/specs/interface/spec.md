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

- **GIVEN** a transaction drawer with no unsaved changes
- **WHEN** a member presses Escape
- **THEN** the drawer closes and focus returns to its opener.

#### Scenario: Dismissing a transaction editor with unsaved changes

- **GIVEN** a transaction creation dialog or edit drawer with unsaved changes
- **WHEN** a member presses Escape
- **THEN** the editor asks for confirmation before discarding the edits and closing.

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

### Requirement: Sure's layout under Archant's visual style

Archant SHALL use responsive drawers for editing snapshots, trades and transactions, save drawer notes when the field loses focus and keep the loan overview grid on mobile.

#### Scenario: Edit a balance snapshot

- **GIVEN** an existing balance snapshot
- **WHEN** the member opens it
- **THEN** `SnapshotDialog.tsx` « Modifier le solde » becomes a drawer, as Sure's `valuations/show.html.erb`: « Aperçu », « Détails » with « Notes » and « Ajoutez tout détail supplémentaire à ce bilan », « Paramètres » with « Supprimer »; « Ajouter un solde » stays a modal, as `valuations/new.html.erb`.

#### Scenario: Edit a trade

- **GIVEN** an existing trade
- **WHEN** the member opens it
- **THEN** `TradeDialog.tsx` « Modifier l'ordre » becomes a drawer, as Sure's `trades/show.html.erb`: « Détails », « Détails supplémentaires » with « Note » and « Ajoutez tout commentaire supplémentaire ici... », « Paramètres »; « Ajouter un ordre » stays a modal, as `trades/new.html.erb`.

#### Scenario: Save notes on blur

- **GIVEN** a note in a snapshot, trade or transaction drawer
- **WHEN** the member leaves the field
- **THEN** the note saves independently, and other edits still require their own save or reconciliation confirmation.
- **AND** if the write fails, the field keeps the typed note and shows the error so the member can retry.

#### Scenario: Create a transaction

- **WHEN** a member adds a new transaction
- **THEN** a creation dialog opens.

#### Scenario: Lay out drawers and loan cards

- **GIVEN** a drawer at 1024 px or wider
- **WHEN** it opens
- **THEN** it docks right at 550 px; below 1024 px it opens centred, as Sure's `responsive: true`; the drawer retains keyboard dismissal and focus management.

#### Scenario: Read loan summary cards on a narrow screen

- **WHEN** a member opens the loan overview at 390 px
- **THEN** three summary cards fit in a row. Amounts remain readable and cards can reflow on narrower or zoomed displays.
