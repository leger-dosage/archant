import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Story 1.2: record transactions by hand.

/** The block under the account's name: subtype and current balance. */
const header = (page: Page, name: string) =>
	page.getByRole("heading", { level: 1, name }).locator("..");

const row = (page: Page, label: string) =>
	page.getByRole("main").getByRole("button", { name: new RegExp(label) });

async function openNewSheet(page: Page) {
	// The empty state repeats the header's button; the header's comes first.
	await page.getByRole("button", { name: "Ajouter une opération" }).first().click();

	return page.getByRole("dialog", { name: "Ajouter une opération" });
}

test("a transaction is added, edited and deleted, and the balance follows each", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const label = uniqueName("Boulangerie");

	await page.goto(`/accounts/${account.id}`);
	await expect(header(page, account.name)).toContainText(euros(100_000));
	await expect(page.getByText("Aucune opération.")).toBeVisible();

	const sheet = await openNewSheet(page);
	await sheet.getByLabel("Date", { exact: true }).fill(typed(daysAgo(2)));
	await sheet.getByLabel("Libellé").fill(label);
	await expect(sheet.getByRole("button", { name: "Dépense" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await sheet.getByLabel("Montant").fill("42,90");
	await sheet.getByLabel("Notes").fill("Pain et croissants");
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(row(page, label)).toContainText(euros(-4290));
	await expect(header(page, account.name)).toContainText(euros(100_000 - 4290));

	await row(page, label).click();
	const editSheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(editSheet.getByLabel("Notes")).toHaveValue("Pain et croissants");
	await editSheet.getByLabel("Montant").fill("50,00");
	await editSheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(editSheet).toBeHidden();
	await expect(row(page, label)).toContainText(euros(-5000));
	await expect(header(page, account.name)).toContainText(euros(100_000 - 5000));

	await row(page, label).click();
	await editSheet.getByRole("button", { name: "Supprimer" }).click();
	const confirm = page.getByRole("alertdialog", { name: `Supprimer l'opération « ${label} » ?` });
	await expect(confirm.getByRole("button", { name: "Annuler" })).toBeFocused();
	await confirm.getByRole("button", { name: "Supprimer" }).click();

	await expect(confirm).toBeHidden();
	await expect(editSheet).toBeHidden();
	await expect(row(page, label)).toHaveCount(0);
	await expect(header(page, account.name)).toContainText(euros(100_000));
});

test("the newest transaction is listed first", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(30) });

	await api.addTransaction(account.id, { date: daysAgo(10), label: "Ancienne", amount: "-1" });
	await api.addTransaction(account.id, { date: daysAgo(3), label: "Récente", amount: "-1" });
	await api.addTransaction(account.id, { date: daysAgo(6), label: "Moyenne", amount: "-1" });

	await page.goto(`/accounts/${account.id}`);

	await expect(page.getByRole("main").getByRole("listitem")).toHaveText([
		/Récente/u,
		/Moyenne/u,
		/Ancienne/u,
	]);
});

test("Esc asks before discarding unsaved changes, and closes at once without any", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const label = uniqueName("Abandonnée");

	await page.goto(`/accounts/${account.id}`);

	let sheet = await openNewSheet(page);
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(page.getByRole("alertdialog")).toHaveCount(0);

	sheet = await openNewSheet(page);
	await sheet.getByLabel("Libellé").fill(label);
	await page.keyboard.press("Escape");

	const discard = page.getByRole("alertdialog", { name: "Abandonner les modifications ?" });
	await expect(discard).toBeVisible();
	await discard.getByRole("button", { name: "Annuler" }).click();
	await expect(discard).toBeHidden();
	await expect(sheet.getByLabel("Libellé")).toHaveValue(label);

	await page.keyboard.press("Escape");
	await discard.getByRole("button", { name: "Abandonner" }).click();
	await expect(sheet).toBeHidden();
	await expect(row(page, label)).toHaveCount(0);
});

test("⌘Enter saves the transaction", async ({ page, api }) => {
	const account = await api.openAccount({ openingBalance: "100,00" });
	const label = uniqueName("Raccourci");

	await page.goto(`/accounts/${account.id}`);

	const sheet = await openNewSheet(page);
	await sheet.getByLabel("Libellé").fill(label);
	await sheet.getByLabel("Montant").fill("12,00");
	await page.keyboard.press("ControlOrMeta+Enter");

	await expect(sheet).toBeHidden();
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(row(page, label)).toContainText(euros(-1200));
	await expect(header(page, account.name)).toContainText(euros(10_000 - 1200));
});

test("a date on the opening date is refused next to the date field", async ({ page, api }) => {
	const openingDate = daysAgo(10);
	const account = await api.openAccount({ openingDate });

	await page.goto(`/accounts/${account.id}`);

	const sheet = await openNewSheet(page);
	await sheet.getByLabel("Date", { exact: true }).fill(typed(openingDate));
	await sheet.getByLabel("Libellé").fill(uniqueName("Trop tôt"));
	await sheet.getByLabel("Montant").fill("5,00");
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet.getByLabel("Date", { exact: true })).toHaveAccessibleDescription(
		"La date doit être postérieure à la date du solde initial du compte.",
	);
	await expect(sheet).toBeVisible();
});

test("a card purchase of -30,00 raises the outstanding balance by 30,00 €", async ({
	page,
	api,
}) => {
	const card = await api.openAccount({ kind: "credit_card", openingBalance: "500,00" });
	const liabilities = await api.groupTotal("liability");

	await page.goto(`/accounts/${card.id}`);
	await expect(header(page, card.name)).toContainText("Carte de crédit");
	await expect(header(page, card.name)).toContainText(euros(50_000));

	const sheet = await openNewSheet(page);
	await sheet.getByLabel("Libellé").fill(uniqueName("Librairie"));
	await sheet.getByLabel("Montant").fill("-30,00");
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(header(page, card.name)).toContainText(euros(53_000));
	await expect(page.getByRole("button", { name: /^Passifs/u })).toContainText(
		euros(liabilities + 3000),
	);
});

test("the list pages at 50 transactions", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });

	await api.addDailyTransactions(account.id, 51, "Lot");

	await page.goto(`/accounts/${account.id}`);
	const rows = page.getByRole("main").getByRole("button", { name: /^Lot \d{2}/u });
	const pages = page.getByRole("navigation", { name: "Pages des opérations" });

	await expect(rows).toHaveCount(50);
	await expect(pages).toContainText("Page 1 sur 2");
	await expect(row(page, "Lot 51")).toHaveCount(0);

	await pages.getByRole("link", { name: "Suivant" }).click();

	await expect(page).toHaveURL(/[?&]page=2/u);
	await expect(pages).toContainText("Page 2 sur 2");
	await expect(rows).toHaveCount(1);
	await expect(row(page, "Lot 51")).toBeVisible();

	await pages.getByRole("link", { name: "Précédent" }).click();
	await expect(page).not.toHaveURL(/[?&]page=/u);
	await expect(rows).toHaveCount(50);
});
