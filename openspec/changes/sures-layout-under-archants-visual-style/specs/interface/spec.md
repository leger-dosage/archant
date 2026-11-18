## ADDED Requirements

### Requirement: Sure's layout under Archant's visual style

Archant SHALL use drawers for editing snapshots and trades, persist drawer notes on blur and keep the loan overview grid on mobile.

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
- **THEN** it saves on its own, as Sure's `auto-submit-form` with `trigger_event_value: "blur"`, with no « Enregistrer »; a new transaction opens a modal, as Sure's `transactions/new.html.erb`, not `TransactionSheet.tsx`.

#### Scenario: Lay out drawers and loan cards

- **GIVEN** a drawer at 1024 px or wider
- **WHEN** it opens
- **THEN** it docks right at 550 px; below 1024 px it opens centred, as Sure's `responsive: true`; `LoanOverview.tsx` keeps three cards a row on a phone, as Sure's `grid-cols-3`.
