## ADDED Requirements

### Requirement: Explain a goal's state on its page

Archant SHALL explain a goal's state and projection and show the relevant actions.

#### Scenario: Read the goal status

- **GIVEN** an active goal's page
- **WHEN** it renders
- **THEN** the header reads « Objectif : %{amount} d'ici le %{date} » with « N jours restants », « Objectif : %{amount} · attendu le %{date} » once the date has passed, or « Cible : %{amount} »; then one status line, Sure's `Goal#status_callout_context`: « atteindra l'objectif vers %{date} », « épargnez %{amount}/mois de plus pour rattraper le retard », « définissez une date cible pour projeter une date de fin », or the depleted reserve's line.

#### Scenario: See the action for the current state

- **GIVEN** the state panel
- **WHEN** the goal is behind, reached but not closed, a reserve whole or short, or without a date
- **THEN** it shows Sure's `Goals::LifecyclePanelComponent` card: « Épargnez %{amount}/mois de plus pour rattraper le retard » with « Ajuster l'objectif à la place »; « Vous avez atteint votre cible, à %{saved} sur %{target}. » with « Clôturer cet objectif »; « Réserve constituée »; « Réserve sous son solde cible »; « Ajouter une date cible » with « Définir la date cible ».

#### Scenario: Read the projection summary

- **GIVEN** the « Projection » chart
- **WHEN** its subtitle renders
- **THEN** it reads Sure's `Goal#projection_summary`, « Au rythme actuel, vous atteindrez cet objectif vers le %{date}. », « Insuffisant au rythme actuel. » or the sentence for no date, no deposit, a reserve or a reached goal, in place of « Pour l'atteindre le {{date}}, il faut épargner … ».
