import type { Page } from "@playwright/test";

import { randomInt } from "node:crypto";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";
import { TIME_ZONE } from "./settings.ts";

// Story 1.2: record transactions by hand.

/** The account's summary, the region its name labels: subtype and current balance. */
const header = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

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
	await expect(
		page.getByRole("heading", { name: "Aucune opération pour l'instant" }),
	).toBeVisible();

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

test("« Revenu », a tab of a new transaction, records an income; an edit keeps the toggle by the amount", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const label = uniqueName("Salaire");

	await page.goto(`/accounts/${account.id}`);
	const sheet = await openNewSheet(page);
	const tabs = sheet.getByRole("group", { name: "Type d'opération" });
	await expect(tabs.getByRole("button")).toHaveText(["Dépense", "Revenu", "Virement"]);
	await sheet.getByLabel("Libellé").fill(label);
	await sheet.getByLabel("Montant").fill("120,00");
	await tabs.getByRole("button", { name: "Revenu" }).click();
	await expect(tabs.getByRole("button", { name: "Revenu" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(row(page, label)).toContainText(euros(12_000));
	await expect(header(page, account.name)).toContainText(euros(100_000 + 12_000));

	await row(page, label).click();
	const editSheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(editSheet.getByRole("group", { name: "Type d'opération" })).toHaveCount(0);
	await expect(
		editSheet
			.getByRole("group", { name: "Sens de l'opération" })
			.getByRole("button", { name: "Revenu" }),
	).toHaveAttribute("aria-pressed", "true");
});

// Story 27.18: Sure's protection indicator, and its unlock.
test("a hand-typed line is protected from sync until the owner lets a sync update it", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(30) });
	const label = uniqueName("Primeur");
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-8,40" });
	const today = new Intl.DateTimeFormat("fr-FR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: TIME_ZONE,
	}).format(new Date());

	await page.goto(`/accounts/${account.id}`);
	await row(page, label).hover();
	await expect(row(page, label).getByTitle("Protégée contre la synchronisation")).toHaveCount(1);
	await row(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	const block = sheet.getByRole("group").filter({ hasText: "Protégée contre la synchronisation" });
	await expect(block).not.toHaveAttribute("open");
	await expect(block.getByText("Champs verrouillés :")).toBeHidden();

	await block.getByText("Protégée contre la synchronisation").click();
	await expect(
		block.getByText(
			"Vos modifications sur cette entrée ne seront pas écrasées par la synchronisation du fournisseur.",
		),
	).toBeVisible();
	await expect(block.getByRole("listitem")).toHaveText([
		`Date${today}`,
		`Montant${today}`,
		`Libellé${today}`,
	]);

	await block
		.getByRole("button", { name: "Autoriser la mise à jour par la synchronisation" })
		.click();
	const confirm = page.getByRole("alertdialog", {
		name: "Autoriser la synchronisation à mettre à jour cette entrée ?",
	});
	await expect(
		confirm.getByText(
			"Vos modifications pourraient être écrasées lors de la prochaine synchronisation.",
		),
	).toBeVisible();
	await confirm.getByRole("button", { name: "Autoriser" }).click();

	await expect(confirm).toBeHidden();
	await expect(
		page.getByText(
			"Entrée déverrouillée. Elle pourra être mise à jour lors de la prochaine synchronisation.",
		),
	).toBeVisible();
	await expect(block).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(row(page, label).getByTitle("Protégée contre la synchronisation")).toHaveCount(0);
	await row(page, label).click();
	await expect(sheet.getByText("Protégée contre la synchronisation")).toHaveCount(0);
});

// Story 28.21: Sure's « Type d'activité » select, saved at once and locked.
test("a PEA line is labelled « Dividende » from its sheet, keeps it, and lists its lock; a checking line offers no label", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "25 000,00",
		openingDate: daysAgo(30),
	});
	const label = uniqueName("Dividende TotalEnergies");
	// An amount of its own: a line of another test, opposite and days apart, would
	// pair with it as a contribution, whose row opens the transfer's drawer.
	const amount = `${String(randomInt(1000, 10_000))},${String(randomInt(10, 100))}`;
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount });
	const today = new Intl.DateTimeFormat("fr-FR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: TIME_ZONE,
	}).format(new Date());
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	const select = sheet.getByRole("combobox", { name: "Type d'activité" });

	await page.goto(`/accounts/${account.id}`);
	await row(page, label).click();
	await expect(select).toHaveText("—");
	await expect(select).toHaveAccessibleDescription(
		"Type d'activité d'investissement (Achat, Vente, Dividende, etc.).",
	);
	await select.click();
	await expect(page.getByRole("option")).toHaveText([
		"—",
		"Achat",
		"Vente",
		"Balayage entrant",
		"Balayage sortant",
		"Dividende",
		"Réinvestissement",
		"Intérêts",
		"Frais",
		"Transfert",
		"Contribution",
		"Retrait",
		"Échange",
		"Autre",
	]);
	const saved = page.waitForResponse(
		(response) => response.request().method() === "PATCH" && response.status() === 200,
	);
	await page.getByRole("option", { name: "Dividende" }).click();
	await saved;
	await expect(select).toHaveText("Dividende");

	// Saved apart from « Enregistrer »: closing asks nothing.
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await row(page, label).click();
	await expect(select).toHaveText("Dividende");
	const block = sheet.getByRole("group").filter({ hasText: "Protégée contre la synchronisation" });
	await block.getByText("Protégée contre la synchronisation").click();
	await expect(block.getByRole("listitem")).toHaveText([
		`Date${today}`,
		`Montant${today}`,
		`Libellé${today}`,
		`Type d'activité${today}`,
	]);
	await page.keyboard.press("Escape");

	// Sure's `investment? || crypto?`: a crypto account's line offers it too.
	const crypto = await api.openAccount({ kind: "exchange", openingDate: daysAgo(30) });
	const purchase = uniqueName("Achat BTC");
	await api.addTransaction(crypto.id, { date: daysAgo(2), label: purchase, amount: "-50,00" });
	await page.goto(`/accounts/${crypto.id}`);
	await row(page, purchase).click();
	await expect(select).toHaveText("—");
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();

	const checking = await api.openAccount({ openingDate: daysAgo(30) });
	const groceries = uniqueName("Primeur");
	await api.addTransaction(checking.id, { date: daysAgo(2), label: groceries, amount: "-8,40" });
	await page.goto(`/accounts/${checking.id}`);
	await row(page, groceries).click();
	await expect(sheet.getByLabel("Libellé")).toHaveValue(groceries);
	await expect(sheet.getByText("Type d'activité")).toHaveCount(0);
});

test("a refused activity label shows the error and puts the saved one back", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "25 000,00",
		openingDate: daysAgo(30),
	});
	const label = uniqueName("Frais de garde");
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-3,00" });
	await page.route("**/api/transactions/*", (route) =>
		route.request().method() === "PATCH"
			? route.fulfill({
					status: 500,
					json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
				})
			: route.fallback(),
	);
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	const select = sheet.getByRole("combobox", { name: "Type d'activité" });

	await page.goto(`/accounts/${account.id}`);
	await row(page, label).click();
	await select.click();
	await page.getByRole("option", { name: "Frais" }).click();

	await expect(
		page.getByText("Une erreur inattendue s'est produite. Réessayez dans un instant."),
	).toBeVisible();
	await expect(select).toHaveText("—");
	await expect(select).toBeEnabled();
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
	// The account's page has the transactions page's list card, column header
	// and day trays, without the account column: every row is this account's.
	// Under the chart card's `h2`, a day is an `h3`.
	const card = page.getByRole("main").locator('[data-slot="list-card"]');
	await expect(card).toHaveCSS("border-radius", "12px");
	await expect(card.locator('[data-slot="column-header"]')).toHaveText(
		/^Opération\s*Catégorie\s*Montant$/u,
	);
	await expect(card.locator('[data-slot="inset-group"]')).toHaveCount(3);
	await expect(card.getByRole("heading", { level: 3 })).toHaveCount(3);
	await expect(card.locator('[data-slot="row-account"]')).toHaveCount(0);
	expect((await page.getByRole("main").getByRole("listitem").first().boundingBox())?.height).toBe(
		56,
	);
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

test("a date before the opening date is saved, the opening balance still setting its day, as Sure", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "100,00", openingDate: daysAgo(10) });
	const label = uniqueName("Avant");

	await page.goto(`/accounts/${account.id}`);

	const sheet = await openNewSheet(page);
	await expect(sheet.getByLabel("Date", { exact: true })).toHaveValue(typed(daysAgo(0)));
	await sheet.getByLabel("Date", { exact: true }).fill(typed(daysAgo(15)));
	await sheet.getByLabel("Libellé").fill(label);
	await sheet.getByLabel("Montant").fill("5,00");
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(row(page, label)).toContainText(euros(-500));
	await expect(header(page, account.name)).toContainText(euros(10_000));
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
	await expect(
		page
			.getByRole("complementary", { name: "Liste des comptes" })
			.getByRole("link", { name: new RegExp(card.name, "u") }),
	).toContainText(euros(53_000));
	await page.goto("/accounts");
	await expect(
		page.getByRole("heading", { level: 2, name: "Passifs" }).locator(".."),
	).toContainText(euros(liabilities + 3000));
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

// Story 23.5: the « À venir » tab, Sure's `transactions/_upcoming`.

const dayMonth = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	timeZone: "UTC",
});

test("« À venir » lists the active series expected within ten days by date, without the filters", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Compte"), openingDate: daysAgo(30) });
	const prefix = uniqueName("Bientôt");
	const declare = (name: string, days: number, kind: "bill" | "income" = "bill") =>
		api.declareBill({
			name: `${prefix} ${name}`,
			amount: kind === "income" ? "1 800,00" : "39,99",
			accountId: account.id,
			firstDueOn: daysAgo(-days),
			kind,
		});
	await declare("Salaire", 0, "income");
	await declare("Internet", 3);
	await declare("Dernier jour", 10);
	await declare("Trop tard", 11);
	await api.setRecurringStatus(await declare("En pause", 1), "inactive");

	await page.goto("/transactions");
	await page.getByRole("tab", { name: "À venir" }).click();

	await expect(page).toHaveURL(/\/transactions\?tab=upcoming$/u);
	await expect(page.getByRole("searchbox", { name: "Rechercher" })).toBeHidden();
	const today = page.getByRole("region", {
		name: dayMonth.format(new Date(`${daysAgo(0)}T00:00:00Z`)),
	});
	const salary = today.getByRole("listitem").filter({ hasText: `${prefix} Salaire` });
	await expect(salary).toContainText("Attendue aujourd'hui");
	await expect(salary).toContainText(`+${euros(180_000)}`);
	const internet = page.getByRole("listitem").filter({ hasText: `${prefix} Internet` });
	await expect(internet).toContainText("Attendue dans 3 jours");
	await expect(internet).toContainText(euros(-3999));
	await expect(
		page.getByRole("listitem").filter({ hasText: `${prefix} Dernier jour` }),
	).toContainText("Attendue dans 10 jours");
	await expect(page.getByRole("listitem").filter({ hasText: `${prefix} Trop tard` })).toHaveCount(
		0,
	);
	await expect(page.getByRole("listitem").filter({ hasText: `${prefix} En pause` })).toHaveCount(0);

	await page.getByRole("tab", { name: "Opérations" }).click();
	await expect(page).toHaveURL(/\/transactions$/u);
	await expect(page.getByRole("searchbox", { name: "Rechercher" })).toBeVisible();
});

test("« À venir » says when no payment is expected", async ({ page }) => {
	await page.route("**/api/recurring/upcoming", (route) => route.fulfill({ json: { data: [] } }));
	await page.goto("/transactions?tab=upcoming");

	await expect(
		page.getByText("Aucun paiement récurrent attendu dans les dix prochains jours."),
	).toBeVisible();
});
