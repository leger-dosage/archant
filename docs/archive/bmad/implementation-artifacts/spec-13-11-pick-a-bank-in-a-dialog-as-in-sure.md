---
title: 'Story 13.11: Pick a bank in a dialog, as in Sure'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '3549820e1396b56db0e8ed0d46d5ccd520c1cc19'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** « Réglages › Banques » lists every bank of the chosen country on the page itself, under « Connecter une banque » and above « Banques connectées », so the owner scrolls past the whole country to reach their own banks.

**Approach:** Follow Sure's `enable_banking_items/select_bank`: the page shows « Banques connectées » first, then the country and a « Choisir une banque » button that opens a dialog. The dialog has the search focused, a list that scrolls inside it (Sure's `max-h-80 overflow-y-auto`), each bank with its logo, name and BIC, and a click on a bank starts the consent flow at once, as Sure's `button_to authorize` does.

## Boundaries & Constraints

**Always:**
- Page order: title, « Banques connectées », « Connecter une banque » (the « Pays » select and the « Choisir une banque » button), then the credentials section. The country stays on the page, as Sure asks it before opening the picker.
- « Choisir une banque » in the empty « Banques connectées » opens the same dialog, for the selected country, instead of focusing « Pays ». Its description no longer says « ci-dessus ».
- Dialog title « Choisir une banque », description naming the country. « Rechercher une banque » gets the focus on open. The list keeps its accessible name « Banques disponibles », its rows keep « Connecter {{name}} », and it scrolls inside the dialog with a bounded height; the empty-search message stays inside the dialog.
- « Confirm » in the epic's criterion means choosing a row, by click or by Enter on it: Sure has no separate confirm step. `useStartBankConnection` and the `onSuccess`/`onError` handling move unchanged.
- The dialog content unmounts on close, so every opening starts with an empty search. Institutions are fetched when the dialog opens for a country, not on page load; the one-hour `staleTime` keeps a reopening free.
- Escape, the close button and « Annuler » close it with nothing started. While a chosen bank's request is pending, the dialog ignores closing, since the browser is about to leave for the bank.
- Keyboard only works end to end: Tab to the button, Enter opens, type, Tab to a row, Enter starts; Escape returns focus to the button (Radix does this).

**Never:** no change to the API, to `matches`/`folded`, to the country list, to the callback or renewal flow; no new dependency; no confirm step; no Sure beta pill.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | France selected, click « Choisir une banque » | dialog open, search focused, every fake bank listed | N/A |
| Search | « neobanque », then « introuvable » | one row, then « Aucune banque ne correspond à cette recherche. » | N/A |
| Cancel | Escape, or « Annuler » | dialog closed, no `POST /api/bank-connections` | N/A |
| Choose | Enter on « Connecter Banque Démo » | consent flow as today, lands on the connection page | provider refusal: toast as today, dialog stays open, rows enabled again |
| Other country | « Belgique », then open | only « Banque BE » | N/A |
| Provider down | institutions request fails | error and « Réessayer » inside the dialog | as today |

</frozen-after-approval>

## Code Map

- `packages/app/src/routes/_authed.settings.banks.tsx` -- `BanksPage:570` renders the picker section before `Connections`; swap them. `ConnectBank:630` keeps the `Select` and replaces `<Institutions key={country}>` with the button and a `BankPickerDialog`. `Institutions:407` becomes the dialog body: `useInstitutions(country, open)`, search input with `autoFocus`, list in a `max-h-80 overflow-y-auto` box. `InstitutionButton:357`, `matches:103`, `folded:95` stay as they are. `Connections:491`'s `onChooseBank` opens the dialog; the `pickerRef` focus trick goes away, so dialog `open` state lives in `BanksPage` or `ConnectBank` with the country.
- `packages/app/src/components/ui/dialog.tsx` -- shadcn `Dialog`; `DialogContent` defaults to `sm:max-w-sm`, widen to `sm:max-w-md` with `className`. `DialogFooter` for « Annuler » (`DialogClose`).
- `packages/app/src/components/MerchantDialog.tsx` -- house style for a dialog: `open`/`onOpenChange` props, `DialogHeader`, `DialogTitle`, `DialogDescription`.
- `packages/app/src/locales/fr.json` `banks` -- add `chooseBank` (« Choisir une banque »), `pickerDescription` (« Pays : {{country}}. Vous donnerez votre accord sur le site de la banque. »), reuse `common.cancel` (« Annuler »); fix `noConnections.description`.
- `packages/app/e2e/bank-connections.spec.ts` -- `banks(page):38` and `connect:271` open the dialog first (add an `openPicker(page)` helper); rewrite the tests at `:233` and `:258`; `:175` and `:375` go through the helper.
- `packages/app/e2e/empty-states.spec.ts:64` -- « Choisir une banque » now opens the dialog: assert the dialog and the focused search.
- `packages/app/e2e/fake-enable-banking.ts:67` -- `FAKE_BANKS` has eight French banks, enough to overflow `max-h-80`: no new fake needed.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/e2e/bank-connections.spec.ts` -- write first: page order (« Banques connectées » region before « Connecter une banque », no « Banques disponibles » list on load); open the dialog, search focused, name and BIC on each row, list `scrollHeight > clientHeight` with the dialog within the viewport; empty search; Escape and « Annuler » close with no request to `/api/bank-connections` (via `page.on("request")`); a keyboard-only run from Tab to the bank's consent; adapt `openPicker`, `connect` and the country test -- the epic asks every criterion in `pnpm test:e2e`
- [x] `packages/app/e2e/empty-states.spec.ts` -- the empty state's button opens the dialog -- behaviour changed
- [x] `packages/app/src/routes/_authed.settings.banks.tsx` -- move the list into `BankPickerDialog`, reorder the page, wire the empty state, ignore closing while a start is pending -- the story
- [x] `packages/app/src/locales/fr.json` -- new keys, fixed empty-state text -- visible text

**Acceptance Criteria:**
- Given a provider refusal on start, when the toast shows, then the dialog stays open and another bank can be chosen.
- Given a reload after the change, when the page loads, then no institutions request is sent until the dialog opens.

## Implementation Notes

- The Boundaries claim that Radix returns focus to the opener is false here: it only does so for a `DialogTrigger`, and two plain buttons open the picker. `BanksPage` keeps the clicked button (`event.currentTarget`, since a click does not focus a button in Safari) and `onCloseAutoFocus` focuses it.
- `pickerDescription` reads « Pays : {{country}}. … »: « Banques disponibles en {{country}} » gave « en Pays-Bas ».
- A start that succeeded keeps `picked` until the browser leaves; a `pageshow` with `persisted` resets it, so a page restored by Back is not stuck with a dialog that refuses to close. No automated test: Playwright does not replay a back/forward cache restore simply.
- `docs/deployment.md` « 4. Connect a bank » step 2 describes the dialog.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| `docs/deployment.md:235` still names « Banques disponibles » on the page | medium | Doc no longer matched the interface; patched |
| `picked` survives a back/forward cache restore, dialog cannot close | medium | `index.html` is not `no-store`, so the page is bfcache-eligible after `window.location.assign`; patched with `pageshow` |
| Escape test passes during the exit animation | medium | `toBeVisible` succeeds while Radix keeps the closing node 100ms; patched to `data-state="open"` |
| Close button (X) untested | low | Spec names it as a close path; patched, one open/close added |
| `openPicker` reads `document.activeElement`, `body` after a click in Safari | low | Real in Safari and Firefox on macOS; patched with `event.currentTarget` |
| Dialog overflows a viewport under ~550px | low | Header, search, 320px list and footer exceed it; patched with `max-h-[90vh] overflow-y-auto`, as `RuleDialog` |
| Outside click untested | low | Goes through the same `onOpenChange` guard as Escape and X; rejected, no extra complexity |
| Focus return from the empty-state button untested | low | Same `openPicker` path as the tested button; rejected |
| Opener unmounted while the dialog is open | low | Connections do not change while the picker is open in normal use; rejected |
| Spec `in-review` vs sprint `in-progress` | false | Workflow state: sprint status moves to `review` at hand-off |
| « Réessayer » not clicked in the provider-down test | low | Retry button behaviour is unchanged from before the story; rejected |
| Heading-order test depends on credentials state | false | Both `CredentialsForm` and `EnvironmentCredentials` render « Application Enable Banking » |
| Future tense in `pickerDescription` vs present in `banks.description` | low | The consent is a future step once the dialog is open; rejected |

## Verification

**Commands:**
- `pnpm --filter @archant/app exec playwright test bank-connections empty-states` -- expected: green
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: green, no tracked file modified afterwards
