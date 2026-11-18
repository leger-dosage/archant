## ADDED Requirements

### Requirement: Filter, search and summarise goals

Archant SHALL filter and search goals and show contribution and progress indicators.

#### Scenario: Filter by status

- **GIVEN** `/goals`
- **WHEN** it renders
- **THEN** chips filter the grid of active and completed goals, as Sure's `goals/index.html.erb`: « Tous », then « En retard », « En bonne voie », the open-ended status, « En pause » and « Terminé », each worded as Archant's cards word that status; « Archivés » stays apart and unfiltered; an empty result reads « Aucun objectif ne correspond à ce filtre. ».

#### Scenario: Search by name

- **GIVEN** more than six goals in the grid
- **WHEN** the owner types in « Rechercher des objectifs… »
- **THEN** goals filter by name, the chips still applying, and an empty result reads Sure's `goals.index.search` text, « Aucun objectif ne correspond à "%{query}". » among them.

#### Scenario: Read the goal indicators

- **GIVEN** the indicator strip
- **WHEN** it renders
- **THEN** it shows « Contribué · 30 derniers jours », the net inflow into goal-linked accounts with « ↑ N % vs 30 jours précédents » or its down and flat forms; « Requis ce mois-ci », the monthly amounts of the goals behind their pace, with « N objectifs en retard »; « Objectifs en bonne voie » as « %{on_track} sur %{total} », paused goals, reserves, reached and open-ended goals out of the total, as Sure's `GoalsController#kpi_payload`.
