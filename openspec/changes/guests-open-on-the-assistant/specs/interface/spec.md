## ADDED Requirements

### Requirement: Guests open on the assistant

Archant SHALL give guests a dedicated sign-in landing page and navigation.

#### Scenario: Land on Intro as a guest

- **GIVEN** a guest
- **WHEN** they sign in or open the dashboard
- **THEN** the layout is Sure's `intro`, as `apply_role_based_ui_defaults` in `user.rb:753-765` sets it: no sidebar, the navigation reduced to Sure's home and « Intro » items (`layouts/application.html.erb`), and the dashboard sends them on, as `pages_controller.rb#dashboard`; Sure sends them to its chat, which Archant does not have, so they land on « Intro ».

#### Scenario: Restrict Intro to guests

- **GIVEN** the « Intro » page
- **WHEN** a guest opens it
- **THEN** it shows Sure's card, « Bienvenue ! » and « Expérience d'introduction à venir » (`pages/fr.yml`); anyone else who opens it goes back to the dashboard with « L'intro n'est disponible que pour les utilisateurs invités. », as `ensure_intro_guest!`.

#### Scenario: Restore the dashboard after promotion

- **GIVEN** a guest promoted to member
- **WHEN** they next load a page
- **THEN** the layout is the dashboard again with its sidebar, as `leaving_guest_role?`.
