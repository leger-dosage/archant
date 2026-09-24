# Manual QA scenarios

A manual pass over all ten epics that checks three things at once: the application works, the documentation is enough to guide a self-hoster, and the interface is clear.

## How to use this document

- Use only the repository's documentation (`README.md`, `docs/`, `.env.example`) and what the interface shows. The scenarios deliberately never say which button, menu, command, variable or address to use. If you have to read the source code or guess to get through, the scenario fails its "also judge" line, even when the goal is met.
- Run the environments in order: A, then the journeys J on the instance A started, then B, then C. Inside each section, scenarios build on the state the previous one left. Each scenario's "Start from" line says what it needs.
- "Done when" lists outcomes you can observe and prove false. Amounts are in euros, French format. When a figure differs, write down the figure you saw.
- The sample files are in [`manual-qa-files/`](manual-qa-files/). Their dates run from 1 July to 20 September 2026. Every figure below holds whatever day you run the pass, except the recurring items in J15, which assume you run J15 before 1 October 2026 (the detection only looks three months back).
- Record each result on the scenario's "Result" line, with notes, then copy the verdicts into the tally at the end.

Result legend. Combine them when needed, for instance `PASS DOC`.

| Code | Meaning |
| --- | --- |
| PASS | Every "Done when" outcome holds. |
| FAIL | At least one outcome is false. Note which one and what you saw. |
| BLOCKED | You could not reach the goal. Note where you stopped. |
| DOC | The goal was reached, but the documentation was missing, wrong or misleading. |
| UX | The goal was reached, but the interface confused you, or a message did not say what to do. |

## Known issues

Do not spend time rediscovering these.

1. A manual account created with the default opening date refuses a transaction dated today: `CreateAccountDialog.tsx` pre-fills the opening date with today, and `domain/statement.ts` refuses any line dated on or before the opening date.
2. The automatic transfer matcher also pairs excluded transactions and transactions of deactivated accounts: `candidateOf` in `services/ledger.ts` filters on neither.
3. Enable Banking: a failing balance call fails the whole account's sync, because `fetchStatement` in `connectors/enable-banking/client.ts` awaits the balance after reading the lines; and a `WRONG_TRANSACTIONS_PERIOD` refusal is not retried with a shorter period, since no code handles it.

Found while preparing this document, each reproduced on a scratch instance:

4. Renaming a recurring series or setting its merchant makes the next detection list it a second time, and the old item stays until it goes stale: `services/recurring.ts` keys an item on its merchant, or else its label.
5. Reverting an import that moved the opening date keeps the moved date with the original amount, so importing the same file again raises the balance by the file's total: Livret A goes from 9 100,00 to 10 200,00.
6. In the import preview, the explanation under the matched group says those operations were entered by hand, even when they came from another file.

## Sample files

| File | Format | Used in |
| --- | --- | --- |
| `01-compte-joint-2026-07-08.ofx` | OFX 1.0.2 SGML, Windows-1252, decimal commas, closing balance of 2 251,43 on 31/08/2026, 26 lines | J2, J3 |
| `02-compte-joint-2026-08-09.ofx` | OFX 2.1.1 XML, UTF-8, no closing balance; August again (same ids) plus 1 to 20 September, 22 lines | J4 |
| `03-compte-joint-2026-07.csv` | CSV, Windows-1252, `;`, two lines before the header, `dd/mm/yyyy`, separate debit and credit columns; July as the same bank exports it, cash withdrawals dated one day later | J5 |
| `04-compte-joint-2026-08-dates-iso.csv` | Same layout, UTF-8 with BOM, dates written `yyyy-mm-dd` | J6 |
| `05-livret-a.qif` | QIF `Bank`, Windows-1252, every date readable both ways, an opening-balance record | J8 |
| `06-carte-visa.qif` | QIF `CCard`, UTF-8 with BOM | J9 |
| `90-releve-session-expiree.ofx` | An HTML "session expired" page saved as `.ofx` | J7 |
| `91-portefeuille-titres.qif` | QIF `Invst`, an unsupported type | J7 |
| `c1-modele-rapprochement.csv` | An empty CSV with the header of file 03, for you to fill in C9 | C9 |

---

## Environment A: local development from a fresh clone

Start from a new clone of the repository on a machine that meets the prerequisites, with the README as your only guide. No bank connection is configured in this environment.

### A1: From a fresh clone to a running application

- Goal: "I just cloned Archant and want to see it running on my machine."
- Start from: a new clone, no `.env`, no database file.
- Done when:
  - Starting the server before you configured anything stops it with an error that names what is missing.
  - Once configured, the interface opens in the browser and lands on a page that creates the administrator.
  - A database file appears at the repository root, with no separate migration step on your part.
- Also judge: could you do it from the README alone? Did any step assume knowledge the README does not give?
- Result: · Notes:

### A2: First launch, sign-out and sign-in

- Goal: "I am the only user of this instance. I create my account, and nobody else can create one after me."
- Start from: A1.
- Done when:
  - The administrator is created and you land in the application, on an empty dashboard.
  - Going back to the account-creation page afterwards sends you to sign-in, even in a private window.
  - After signing out, reloading any page sends you to sign-in, and signing in brings you back.
- Also judge: does the creation form say what a valid password is before you get it wrong?
- Result: · Notes:

### A3: Wrong password, several times

- Goal: "I mistyped my password a few times in a row."
- Start from: A2, signed out.
- Done when:
  - A wrong password gets a message that does not say whether the email or the password was wrong.
  - Within ten seconds, the attempt after the third one (successful attempts count too) is refused with a message asking you to wait a few seconds.
  - About ten seconds later, the right password works.
- Also judge: is the rate-limit message understandable to someone who has never heard the term?
- Result: · Notes:

### A4: No bank connection configured

- Goal: "I have not set up any bank access. I want to know what Archant expects before I try."
- Start from: A2.
- Done when:
  - The banks page in the settings says bank connection is not configured and lists the three settings to provide, with a way to the documentation.
  - Every other page works.
- Also judge: from that page and the documentation it points to, could you tell what to do next?
- Result: · Notes:

### A5: The server goes away

- Goal: "I stopped the server by accident while the interface was open."
- Start from: A2, signed in, with only the interface's development server running.
- Done when:
  - Loading data or saving shows a message saying the server is not answering and asking you to check it is started, never a blank page or a raw error.
  - Once the server is back, the same action works without reloading the browser.
- Result: · Notes:

### A6: Change the password from the interface

- Goal: "I think someone saw my password. I change it, and I want the session I left open on another device closed."
- Start from: A2, signed in on two browsers, for instance a normal and a private window.
- Done when:
  - The change is refused with a precise message when the current password is wrong, and when the two new passwords differ.
  - After the change, the other browser is sent to sign-in on its next action, and the old password no longer works.
- Result: · Notes:

### A7: Forgotten password, reset from the machine

- Goal: "I forgot my password. There is no email reset, but I have a shell on the machine running Archant."
- Start from: A6, signed out.
- Done when:
  - The reset asks for the new password twice, never shows it, and refuses two different entries.
  - The old password is refused and the new one works.
  - A session left open in another browser is closed.
- Also judge: did the documentation tell you where to run it from and what it needs?
- Result: · Notes:

---

## Cross-feature journeys

Run J1 to J17 in order, on the instance of environment A. Together they build one household's first three months, and each journey starts from the state the previous one left. Appendix A lists the household data they rely on, and appendix B the figures you should end with.

### J1: Set up the household before importing anything

Epics 1, 4 and 8.

- Goal: "We keep a joint current account and a deferred-debit Visa card. Before importing anything, I want groceries and fuel filed automatically as they arrive."
- Start from: A7, signed in, no account.
- Done when:
  - The accounts page lists « Compte joint » under assets at 1 250,00 and « Carte Visa » under liabilities at 0,00, each group with its total; the sidebar shows both.
  - The categories page shows the 15 default categories, 1 income and 14 expenses.
  - « Carburant » exists as a sub-category of « Transports » and shows its parent's colour.
  - Two rules exist and are enabled: one that files any label containing CARREFOUR or MONOPRIX under « Courses », written as a single rule, and one that files labels containing TOTAL ACCESS under « Carburant ».
- Also judge: did the rule form make the difference between "all conditions" and "at least one" clear?
- Result: · Notes:

### J2: Import July and August from an OFX file

Epics 2 and 8. File 01.

- Goal: "My bank gave me an OFX file for July and August. I want those operations in, and the balance to match the bank."
- Start from: J1.
- Done when:
  - The preview lists 26 operations to create and nothing in the other groups, and says the statement's balance of 2 251,43 on 31/08/2026 will be recorded.
  - After confirming, « Compte joint » shows 2 251,43, and its snapshots list holds that balance on 31/08/2026 with no gap.
  - The EDF label reads « PRLV SEPA EDF CLIENTS PARTICULIERS Échéancier électricité », accents intact.
  - The four Carrefour and Monoprix lines are already in « Courses », with no edit on your part.
  - The balance history, shown as data, reads 1 250,00 on 30/06/2026, 2 450,10 on 31/07/2026 and 2 251,43 on 31/08/2026.
- Also judge: did the preview explain what would happen before you confirmed?
- Result: · Notes:

### J3: Import the same file again

Epic 2. File 01.

- Goal: "I am not sure I imported that file. I import it again to be safe."
- Start from: J2.
- Done when:
  - The preview puts all 26 operations under already present, says the statement balance is already recorded, and there is nothing to import.
  - The balance stays at 2 251,43 and the list holds no duplicate.
- Result: · Notes:

### J4: Two uncashed cheques, then the September file

Epics 1, 2 and 10 (story 10.6). File 02.

- Goal: "On 14/09 I wrote a 60,00 € cheque to the plumber and on 16/09 another 60,00 € one for piano lessons; the bank has not cashed them yet. I record them, then import the file that runs to 20 September."
- Start from: J3.
- Done when:
  - The two cheques are in the account, dated 14/09/2026 and 16/09/2026.
  - The file's preview reads: 8 to create, 13 already present (the August lines), 0 matched, 1 possible duplicate (« CB GARAGE DU CENTRE » of 15/09, 60,00, which sits between the two cheques), 0 rejected. It mentions no statement balance, since this file has none.
  - After confirming, « Compte joint » shows 3 483,90, and the garage line carries a possible-duplicate warning that is not shown by colour alone.
  - Telling Archant the garage line is not a duplicate removes the warning; the balance stays 3 483,90 and the three 60,00 lines remain.
- Also judge: once flagged, did the interface tell you why and what your two choices would do?
- Result: · Notes:

### J5: The same July, exported as CSV

Epics 2 and 10 (story 10.6). File 03.

- Goal: "I also downloaded July as CSV from the bank's other export. I import it into the same account without getting anything twice."
- Start from: J4.
- Done when:
  - Because this is the account's first CSV, you are asked to describe the columns. With the right settings (two lines to skip, a header, debit and credit columns, `dd/mm/yyyy`, decimal comma), the preview reads 0 to create, 0 present, 12 matched, 1 possible duplicate (the 11/07 cash withdrawal of 50,00), 0 rejected.
  - Accented labels in the column step read correctly, for instance « PRÉLÈVEMENT EDF ».
  - After confirming, the matched operations keep their OFX labels, and the balance stays 3 483,90.
  - The snapshots list now shows a 50,00 gap on 31/08/2026.
  - Merging the flagged withdrawal offers exactly one candidate, the 10/07 withdrawal. After the merge, the account has two 50,00 withdrawals in July (10/07 and 12/07), the gap is gone, and the balance is still 3 483,90.
- Also judge: were the CSV settings understandable without knowing the file format? Did the matched group's explanation describe what happened (see known issue 6)?
- Result: · Notes:

### J6: A CSV whose dates are written another way

Epic 2, error path. File 04.

- Goal: "I exported August in CSV too, but this time the dates came out as 2026-08-01."
- Start from: J5.
- Done when:
  - The saved column settings apply straight away, and the preview rejects all 13 lines for an unreadable date, naming lines 4 to 16 of the file.
  - After you change only the date format, the preview reads 13 matched and nothing else.
  - After confirming, the balance is unchanged at 3 483,90.
- Also judge: did the rejection tell you what to fix and where?
- Result: · Notes:

### J7: Files Archant cannot read

Epic 2, error path. Files 90 and 91.

- Goal: "I try the file my bank's site gave me after my session expired, then an export of my securities account."
- Start from: J6.
- Done when:
  - File 90 is refused with a message saying it is not a readable bank statement.
  - File 91 is refused with a message naming the unsupported type « Invst ».
  - The account's import history holds no new entry, and no balance changed.
- Result: · Notes:

### J8: A savings account known only by today's balance

Epics 1, 2 and 5. File 05.

- Goal: "My Livret A shows 9 100,00 € today. I create it with that balance and today's date, then import its history."
- Start from: J7.
- Done when:
  - The first preview rejects the 3 transfers as dated on or before the account's opening, and rejects the opening-balance record as such.
  - It offers to move the opening date to 01/07/2026 with an opening balance of 8 000,00, and states that today's balance does not change.
  - It lets you choose the date order, day first by default, because every date in the file reads both ways.
  - Once you accept the move, the preview reads 3 to create and 1 rejected (the opening balance).
  - After confirming, « Livret A » shows 9 100,00 with an opening date of 01/07/2026.
  - The three transfers (02/07 for 300,00, 03/08 for 500,00, 02/09 for 300,00) are linked to their « Compte joint » counterparts on their own, and both sides of each show as a transfer.
- Also judge: was the offer to move the opening date clear about what would change?
- Result: · Notes:

### J9: The card file, in the wrong account first

Epics 2, 5 and 8. File 06.

- Goal: "I imported the Visa file into the current account by mistake. I undo it, then import it where it belongs."
- Start from: J8.
- Done when:
  - Imported into « Compte joint », the file creates 8 operations and the account shows 3 346,80.
  - Undoing that import asks for confirmation, stating that 8 operations will be deleted; afterwards « Compte joint » is back at 3 483,90, and its history shows the import as undone with its date.
  - Imported into « Carte Visa », the preview reads 8 to create and offers no date-order choice. After confirming, the card owes 137,10.
  - The two TOTAL ACCESS lines are already in « Carburant ».
  - The card's 31/08 payment of 493,69 and the current account's 31/08 line of the same amount are linked as a card repayment.
  - Asking to undo the July CSV import of J5 says that no operation will be deleted. Undo it; the balance stays 3 483,90.
- Also judge: before confirming the undo, did you know exactly what would be removed?
- Result: · Notes:

### J10: Mortgage, PEA, flat and car

Epics 5 and 7.

- Goal: "I want our whole household in the net worth: the mortgage, the PEA, the flat and the car."
- Start from: J9. Account data in appendix A.
- Done when:
  - « Prêt immobilier » is listed under liabilities and shows the amount borrowed, the rate and the end date.
  - The three 950,00 repayments you record on the loan (05/07, 05/08, 05/09) each link on their own to the current account's « ECHEANCE PRET IMMO 0042 » line of the same day, as a loan repayment.
  - The 1 000,00 you record on the PEA on 10/08 links on its own to « VIR VERS PEA BOURSORAMA », as a contribution.
  - With the lender's figure of 180 105,32 owed on 05/09/2026 recorded, the loan shows 180 105,32.
  - With the PEA valued 16 240,00 on 31/08/2026, the PEA shows 16 240,00. With the car valued 9 100,00 on 01/09/2026, « Clio » shows 9 100,00. « Appartement » shows 420 000,00.
- Also judge: when recording a repayment on the loan, was it obvious which direction to choose?
- Result: · Notes:

### J11: File three months of spending

Epic 4.

- Goal: "I want every operation of July to September filed as in appendix A, with as few individual edits as possible."
- Start from: J10.
- Done when:
  - Every operation matches appendix A: categories, the « Carrefour » merchant on the three Carrefour lines, the tag « Vacances Bretagne » on three card lines, and the 14/08 Dupont transfer excluded from reports but still in the list. Leave the Netflix lines for J12, and file « CB BOULANGERIE PAUL » by hand rather than through a rule.
  - You created the merchants « Free » (on the August and September lines) and « Free Mobile » (on July), then merged « Free » into « Free Mobile », which now holds 3 operations.
  - The tag filter « Vacances Bretagne » shows 3 results for a total of −463,70.
  - A search for « carrefour » shows 3 results for a total of −252,02.
  - An amount range of 55 to 100 shows 11 results for a total of −785,62.
  - The « Courses » filter over all dates shows a total of −336,57.
  - The transfer direction shows 12 operations.
  - A reload keeps the filters, each shown as a removable chip.
- Also judge: were bulk edits discoverable? Did the merchant and tag pages say how to create one?
- Result: · Notes:

### J12: A rule for the past, and a rule that must not win

Epic 8.

- Goal: "Netflix should read « Netflix » under « Abonnements », including the three past months. And a rule must never overwrite what I set by hand."
- Start from: J11.
- Done when:
  - After saving a rule that files NETFLIX labels under « Abonnements » and renames them « Netflix », Archant says 3 operations will change. Applying it changes 3, and the three lines read « Netflix ».
  - The rules page lists that run with 3 matches and 3 changed.
  - A new rule that would file BOULANGERIE labels under « Restaurants », applied to existing operations, says no operation will change: you filed that line by hand in J11. Delete that rule afterwards.
- Also judge: did the rules page explain the order rules run in and what "by hand" protects?
- Result: · Notes:

### J13: Undo and redo a transfer by hand

Epic 5.

- Goal: "I want to check that unlinking a savings transfer really makes it count as spending, then put it back."
- Start from: J12.
- Done when:
  - Unlinking the 03/08 Livret A transfer turns both sides into ordinary operations. August then shows 3 350,00 of income and 3 168,67 of expenses.
  - Linking them again by hand offers the other side among the candidates. August is back to 2 850,00 and 2 668,67.
- Result: · Notes:

### J14: Month-end review on the dashboard

Epic 6.

- Goal: "Where do we stand, and where did the money go each month?"
- Start from: J13.
- Done when:
  - Net worth reads 277 681,48, with 457 923,90 of assets and 180 242,42 of liabilities. The accounts page group totals agree.
  - July, August and September match appendix B line by line.
  - In August, « Santé » shows +23,00 on the expense side, a refund that lowers expenses. Neither the Dupont transfer nor the Livret A or card transfers appear.
  - Choosing a category line opens the operations list filtered on that category and that month, and its total equals the line.
  - Excluding « Clio » from reports brings net worth to 268 581,48 while « Clio » stays listed. Deactivating it removes it from the lists and the totals too, and showing inactive accounts brings it back. Restore it included and active.
  - The net worth chart offers the periods 1 month to all, and its data table agrees with the headline for today.
- Also judge: would a household member understand the refund line and the difference between excluding and deactivating?
- Result: · Notes:

### J15: Subscriptions and bills

Epic 9. Run before 1 October 2026.

- Goal: "What comes back every month, and when is the next one due?"
- Start from: J14.
- Done when:
  - The detected items include the salary (+2 850,00, next 01/10/2026), EDF (−78,00, next 04/10/2026), the loan repayment (−950,00, next 05/10/2026), Free Mobile (−19,99, next 07/10/2026) and Netflix (−13,49, next 15/10/2026), sorted by next date. Known issue 4 may add a second Netflix and a second Free Mobile.
  - Confirming EDF and the loan marks them confirmed. Dismissing the salary asks for confirmation, then hides it, and running detection again does not bring it back.
  - Adding « FRAIS TENUE DE COMPTE » from one of its operations lists it as added by hand, with a next date on the 30th or the 31st.
- Also judge: did the page explain why an item was detected and what dismissing does?
- Result: · Notes:

### J16: A session without the mouse

Epic 1 (story 1.8).

- Goal: "I want to file the three September card purchases and add a cash expense without touching the mouse."
- Start from: J15.
- Done when:
  - Starting from the dashboard, you reached the card's operations, moved from row to row, changed a category and a tag, and selected several rows, all from the keyboard.
  - You added a 12,00 € « Marché » expense on 19/09/2026 to « Compte joint » from the keyboard, then deleted it the same way. The balance is back to 3 483,90.
  - Leaving an operation with unsaved changes asks before discarding them.
  - A typed letter inside a text field never triggers a shortcut.
  - The list of shortcuts can be opened from the keyboard, and each shortcut also has a visible equivalent.
- Also judge: how did you discover the shortcuts?
- Result: · Notes:

### J17: Account housekeeping

Epic 1 (story 1.6).

- Goal: "I opened a test account to try things. I rename it, then delete it."
- Start from: J16.
- Done when:
  - A « Compte test » checking account with two operations can be renamed and its type changed to savings.
  - Deleting it asks for confirmation, stating it holds 2 operations; afterwards it is gone from every list, and net worth is back to 277 681,48.
- Result: · Notes:

---

## Environment B: the container

The reference deployment: one container, reached directly at its own address with no reverse proxy in front. Work in a separate clone, or stop the development servers first so the ports do not clash. Scenarios run in order.

### B1: First start of the container

- Goal: "I want Archant on my home server, the way the documentation recommends."
- Start from: a clone, Docker installed, nothing configured.
- Done when:
  - Starting without the sign-in secret is refused before anything runs, with a message saying what to set.
  - With the secret set, the start command returns once the application is healthy, and the address from the documentation opens the administrator creation page.
  - The health endpoint answers that it is fine; an unknown API address answers a "not found" error in JSON, not the interface's page.
- Also judge: were the README and the deployment guide enough? Did you know which secret to keep safe, and why?
- Result: · Notes:

### B2: Move the household from the checkout into the container

- Goal: "I tried Archant on my laptop. Now I want the same data on the server."
- Start from: B1, and the checkout of environment A at the end of J17.
- Done when:
  - You took a consistent copy of the checkout's database with the method the documentation gives, and restored it into the container with the documented procedure.
  - The container asks you to sign in again, and the password from A7 works.
  - Net worth reads 277 681,48, and « Compte joint » 3 483,90.
- Also judge: did the documentation cover the checkout-to-container case, or did you have to combine two procedures yourself?
- Result: · Notes:

### B3: Backup and restore, round trip

- Goal: "I want to be sure that my backups actually restore."
- Start from: B2.
- Done when:
  - You took a backup while the container kept running, and got a single file out of it.
  - You then created an account « À supprimer » at 100,00, and net worth rose to 277 781,48.
  - After the documented restore, « À supprimer » is gone and net worth is back to 277 681,48.
- Also judge: did the documentation say why copying the database file directly is not enough?
- Result: · Notes:

### B4: Forgotten password, in the container

- Goal: "I forgot the password again, and this time Archant runs in a container."
- Start from: B3.
- Done when:
  - The same guarantees as A7 hold: asked twice, never shown, old password refused, sessions closed.
- Result: · Notes:

### B5: Upgrade without losing anything

- Goal: "A new version is out. I upgrade and keep my data."
- Start from: B4.
- Done when:
  - You followed the documented upgrade, including its advice to back up first. The image was rebuilt and the start command returned once healthy.
  - No separate migration step was needed; your data and your session survive.
- Also judge: did the documentation say how to go back if the upgrade fails?
- Result: · Notes:

### B6: Stop and start again

- Goal: "I stop Archant for server maintenance, then start it again."
- Start from: B5.
- Done when:
  - Stopping takes about a second, not ten.
  - After starting again, everything is as it was. If you can, reboot the host: Archant comes back on its own.
- Result: · Notes:

### B7: From the phone, on the home network

- Goal: "I want to check the balance from my phone on the Wi-Fi, with no reverse proxy."
- Start from: B6, a phone on the same network as the server.
- Done when:
  - With the default configuration, signing in from the phone at the server's network address is refused.
  - After following the documentation, signing in from the phone works.
  - On the phone, the dashboard and the accounts are usable, while the import and the rules page say they are available on a computer.
- Also judge: did the documentation cover access from another device without a reverse proxy? What did you have to guess?
- Result: · Notes:

---

## Environment C: Enable Banking sandbox

Run it on the container of environment B, at its default local address. The bank accounts it adds change the dashboard totals, so the figures of appendix B no longer hold afterwards. Scenarios run in order.

### C1: Register a sandbox application and plug it in

- Goal: "I want to try bank synchronisation with Enable Banking's test bank before using my real accounts."
- Start from: B7, an Enable Banking account with no application.
- Done when:
  - You registered a sandbox application with the right return address, and gave Archant its three settings with the documented method.
  - The banks page no longer says the connection is not configured; France is the default country, and its list includes Enable Banking's Mock ASPSP.
- Also judge: could you do it from the deployment guide alone? Was the key conversion clear?
- Result: · Notes:

### C2: A mistyped setting

- Goal: "I pasted the private key wrong."
- Start from: C1.
- Done when:
  - With a malformed private key or encryption key, the container does not become healthy, and its output names the faulty setting.
  - Putting the right value back restores C1's state.
- Also judge: did the documentation tell you where to read why the container would not start?
- Result: · Notes:

### C3: Connect the test bank and link its accounts

- Goal: "I connect the test bank and follow its main account in a new Archant account."
- Start from: C1.
- Done when:
  - Consent on the test bank's page brings you back to Archant, then to the connection's page, with a consent end date about 90 days away, or sooner if the bank allows less.
  - Each bank account shows its name, a masked account number and its currency. You created a new account « Sandbox courant » for the first one and ignored the others.
  - « Sandbox courant » holds the bank's operations of the last 90 days, each marked as synchronised from Enable Banking, and its balance equals the bank's.
  - The connection page shows a last sync time and no error.
- Also judge: during the round trip to the bank, did you always know where you were?
- Result: · Notes:

### C4: Sync on demand

- Goal: "I want the latest operations now."
- Start from: C3, within the hour after linking.
- Done when:
  - Syncing right away is refused with a message saying the bank synced less than an hour ago.
  - More than an hour later, syncing reports it finished, the last sync time moves, and no operation appears twice.
- Also judge: did the refusal surprise you right after linking? Does the documentation mention it?
- Result: · Notes:

### C5: Scheduled sync

- Goal: "I want Archant to sync every morning without me."
- Start from: C4.
- Done when:
  - You enabled the protected sync route and called it the way the documentation describes, first by hand.
  - Without the secret, or with a wrong one, it answers "unauthorised" and nothing changes.
  - With the secret, it answers with one entry per connection: `skipped` within the hour after a sync, `synced` after that.
  - You set up a recurring call on the host, and the next morning the connection's last sync time reflects it.
- Also judge: could you choose and set up a scheduler from the documentation alone?
- Result: · Notes:

### C6: Card payments not yet booked

- Goal: "I want to see the card payments the bank has not booked yet."
- Start from: C5. Only if the test bank returns such operations; otherwise write "not provided by the sandbox".
- Done when:
  - Those operations carry a pending marker, count in the account's balance, and are absent from the dashboard's monthly income and expenses.
  - After a later sync that books them, each is still a single operation, now without the marker.
- Result: · Notes:

### C7: Renew consent

- Goal: "The consent will end one day. I renew it ahead of time."
- Start from: C5.
- Done when:
  - Renewing goes through the bank's page again and brings you back to the same connection, with the same linked account and all its history, and a later consent end date.
  - Syncing right after the renewal is allowed, even within the hour.
- Result: · Notes:

### C8: Disconnect

- Goal: "I stop synchronising this bank, but I keep what was imported."
- Start from: C7.
- Done when:
  - Disconnecting asks for confirmation, stating that the linked account becomes a manual account and keeps its history.
  - Afterwards, the connection is gone, « Sandbox courant » is still listed with the same balance, the same operations and the same balance history, and you can add an operation to it by hand.
- Result: · Notes:

### C9: A file first, then the bank

- Goal: "I fed an account from files for months. Now I link it to the bank, and I want no duplicates."
- Start from: C8. Pick five operations of « Sandbox courant » from the last 60 days, each with an amount that appears only once in that account within a week. Call them L1 to L5, and write down the account's balance.
- Prepare:
  - Create a manual checking account « Sandbox fichier » with an opening date at least four months back.
  - Copy `c1-modele-rapprochement.csv` and fill it with seven lines: L1, L2 and L3 exactly as they read, then for L4 and for L5 two lines each with the same amount, dated the day before and the day after. Import it into « Sandbox fichier »: 7 to create.
  - Connect the test bank again, and link the same bank account to « Sandbox fichier » as an existing account.
- Done when:
  - After the first sync, L1 to L3 exist once each: the bank matched them to the file lines instead of adding new ones.
  - L4 and L5 were added and each carries a possible-duplicate warning, since two file lines sit at the same distance from them.
  - Merging L4 into one of its two file lines deletes L4 and keeps that file line with its own date and label.
  - Declaring L5 not a duplicate removes its warning, and the next sync (after the hour) does not raise it again.
  - The balance of « Sandbox fichier » equals the balance you wrote down, whatever the file lines, because the bank's balance is now the reference.
- Also judge: did the choice between creating an account and linking an existing one say what linking would do to its balance?
- Result: · Notes:

### What the sandbox cannot exercise

Write "not run" for these, unless you have a real bank to try them with:

- The warning 14 days before consent ends, and the stopped sync once it has ended, because the test consent lasts about 90 days. The warning that sync has been stopped for 48 hours does show if you leave the instance two days without any sync.
- A bank refusing the requested period, and a failing balance call (known issue 3).
- Pending operations, unless the test bank returns some (C6).
- A consent withdrawn from the bank's side.

---

## Appendix A: household data

Accounts, in euros, for the "Start from" lines of J1, J8, J10 and J17.

| Account | Type | Opening balance or value | At |
| --- | --- | --- | --- |
| Compte joint | Current account | 1 250,00 | 30/06/2026 |
| Carte Visa | Credit card | 0,00 owed | 31/07/2026 |
| Livret A | Savings | 9 100,00 | today (J8 moves it) |
| Prêt immobilier | Mortgage, 200 000,00 borrowed, rate 1,35 %, ending 30/06/2044 | 182 400,00 owed | 30/06/2026 |
| PEA | Investment, PEA | 15 000,00 | 30/06/2026 |
| Appartement | Property, apartment | 420 000,00 | 30/06/2026 |
| Clio | Vehicle | 9 500,00 | 30/06/2026 |

How each operation should end up after J11 and J12. The match is on the label.

| Label contains | Category | Other |
| --- | --- | --- |
| VIR SALAIRE ACME SAS | Revenus | |
| EDF | Énergie et eau | |
| ECHEANCE PRET IMMO | Logement | Loan repayment |
| FREE MOBILE | Abonnements | Merchant « Free Mobile » |
| NETFLIX | Abonnements | Renamed « Netflix » in J12 |
| CARREFOUR | Courses | Merchant « Carrefour » |
| MONOPRIX, BOULANGERIE PAUL | Courses | |
| LE PETIT BISTROT, CRÊPERIE DU PORT | Restaurants | Crêperie tagged « Vacances Bretagne » |
| PHARMACIE, HARMONIE MUTUELLE | Santé | |
| FRAIS TENUE DE COMPTE | Frais bancaires | |
| VIR VERS PEA BOURSORAMA | Épargne et placements | PEA contribution |
| HOTEL LES GOELANDS | Voyages | Tagged « Vacances Bretagne » |
| TOTAL ACCESS | Transports › Carburant | Rennes tagged « Vacances Bretagne » |
| GARAGE DU CENTRE | Transports | |
| UGC CINE, cheque for piano lessons | Loisirs | |
| cheque to the plumber | Logement | |
| RETRAIT DAB, AMAZON, DECATHLON | none | |
| VIR M DUPONT REMB WEEK-END | none | Excluded from reports |
| Both sides of every transfer (Livret A, card payment, loan and PEA inflows) | none | |

## Appendix B: expected figures

Balances after J12, and after J14 to J17, which restore them:

| Account | Balance |
| --- | --- |
| Compte joint | 3 483,90 |
| Livret A | 9 100,00 |
| PEA | 16 240,00 |
| Appartement | 420 000,00 |
| Clio | 9 100,00 |
| Carte Visa | 137,10 owed |
| Prêt immobilier | 180 105,32 owed |
| Assets | 457 923,90 |
| Liabilities | 180 242,42 |
| Net worth | 277 681,48 |

Monthly income and expenses by category. September counts operations up to 20/09 plus the two cheques. Expense lines are money out, except the August « Santé » refund.

| Line | July | August | September |
| --- | --- | --- | --- |
| Income, « Revenus » | 2 850,00 | 2 850,00 | 2 850,00 |
| Épargne et placements | | 1 000,00 | |
| Logement | 950,00 | 950,00 | 1 010,00 |
| Voyages | | 364,00 | |
| Courses | 126,52 | 134,00 | 76,05 |
| Transports | | 61,20 | 118,40 |
| Loisirs | | | 83,80 |
| Énergie et eau | 78,00 | 78,00 | 78,00 |
| Restaurants | 46,50 | 38,50 | |
| Abonnements | 33,48 | 33,48 | 33,48 |
| Sans catégorie | 100,00 | 29,99 | 54,90 |
| Santé | 12,90 | +23,00 (refund) | |
| Frais bancaires | 2,50 | 2,50 | |
| Total expenses | 1 349,90 | 2 668,67 | 1 454,63 |

## Tally

| Scenario | Result | Scenario | Result | Scenario | Result | Scenario | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | | J1 | | B1 | | C1 | |
| A2 | | J2 | | B2 | | C2 | |
| A3 | | J3 | | B3 | | C3 | |
| A4 | | J4 | | B4 | | C4 | |
| A5 | | J5 | | B5 | | C5 | |
| A6 | | J6 | | B6 | | C6 | |
| A7 | | J7 | | B7 | | C7 | |
| |  | J8 | |  | | C8 | |
| |  | J9 | |  | | C9 | |
| |  | J10 | |  | |  | |
| |  | J11 | |  | |  | |
| |  | J12 | |  | |  | |
| |  | J13 | |  | |  | |
| |  | J14 | |  | |  | |
| |  | J15 | |  | |  | |
| |  | J16 | |  | |  | |
| |  | J17 | |  | |  | |
