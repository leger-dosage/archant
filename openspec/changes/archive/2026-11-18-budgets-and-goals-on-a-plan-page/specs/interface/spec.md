## ADDED Requirements

### Requirement: Budgets and goals on a Plan page

Archant SHALL bring budgets and savings goals together on a Plan page.

#### Scenario: Navigate through Plan

- **GIVEN** the navigation
- **WHEN** it renders
- **THEN** « Plan » at `/plan` replaces « Budgets » and « Objectifs », in the sidebar and the phone bar, active on `/plan`, `/budgets` and `/goals`, as Sure's `plan_nav_item`; the breadcrumbs of a budget or a goal start with « Plan ».

#### Scenario: Read the Plan overview

- **GIVEN** `/plan`
- **WHEN** it renders
- **THEN** it reads « Plan » and « Décidez où va votre argent : ce que vous dépensez et ce que vous épargnez. », then two cards, as Sure's `plans/show.html.erb`: « Ce mois-ci », with « %{percent} % utilisés », « sur %{total} », the days left, « Principales catégories », four at most, and « Voir le budget complet », or « Configurer le budget de ce mois-ci » before the month is set up; « Vos objectifs », with « Objectifs actifs », « sur %{total} tous objectifs confondus », « N en retard » and « N au rythme inconnu » when applicable, or « Tout est dans les temps », « Tous les objectifs » and « Nouvel objectif ». The link to all goals stays visible when only completed or archived goals exist.

#### Scenario: Remove the dashboard goals card

- **GIVEN** the dashboard
- **WHEN** it renders
- **THEN** its « Objectifs » card is gone, as Sure's dashboard has none.

#### Scenario: Show Plan without a preview flag

- **GIVEN** Sure's preview pill on the page
- **WHEN** Archant renders it
- **THEN** no pill shows, since Archant has no preview flag.
