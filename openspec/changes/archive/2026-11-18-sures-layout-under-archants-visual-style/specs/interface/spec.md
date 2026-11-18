## ADDED Requirements

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

## MODIFIED Requirements

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
