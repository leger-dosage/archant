import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Story 1.5: list and filter transactions across accounts. One database
// serves the whole run, so every test narrows the list to its own rows, by a
// unique label prefix or by its own accounts, before asserting on it.

const rows = (page: Page) => page.getByRole("main").getByRole("listitem");

const row = (page: Page, label: string) =>
	page.getByRole("main").getByRole("button", { name: new RegExp(label) });

const summary = (page: Page) => page.getByText(/\d+ résultats? · Total :/u);

const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Rechercher" });

const chip = (page: Page, label: string) =>
	page.getByRole("button", { name: `Retirer le filtre ${label}` });

/** Opens the « Filtrer » menu on one filter's editor. */
async function openFilter(page: Page, kind: "Compte" | "Période" | "Montant") {
	await page.getByRole("button", { name: "Filtrer" }).click();
	const menu = page.getByRole("dialog");
	await menu.getByRole("button", { name: kind, exact: true }).click();

	return menu;
}

async function search(page: Page, text: string) {
	await searchBox(page).fill(text);
	await expect(page).toHaveURL(/[?&]q=/u);
}

/** The rows `<prefix> n`, in the order given. */
const labelled = (prefix: string, ...numbers: number[]) =>
	numbers.map((number) => new RegExp(`${prefix} ${number}`, "u"));

/** A checking account and a card, three transactions each, labelled `<prefix> …`. */
async function twoAccounts(api: Api, prefix: string) {
	const checking = await api.openAccount({ name: uniqueName("Joint"), openingDate: daysAgo(40) });
	const card = await api.openAccount({
		name: uniqueName("Carte"),
		kind: "credit_card",
		openingDate: daysAgo(40),
	});

	// One after the other: each is an `immediate` ledger write.
	await [checking, card, checking, card, checking, card].reduce(
		async (previous, account, index) => {
			await previous;
			await api.addTransaction(account.id, {
				date: daysAgo(12 - index * 2),
				label: `${prefix} ${index + 1}`,
				amount: "-1",
			});
		},
		Promise.resolve(),
	);

	return { checking, card };
}

test("every account's transactions are listed, most recent first, with the account's name", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Croisé");
	const { checking, card } = await twoAccounts(api, prefix);

	await page.goto("/comptes");
	await page.getByRole("link", { name: "Opérations" }).click();
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await search(page, prefix);

	await expect(rows(page)).toHaveText([
		new RegExp(`${prefix} 6.*${card.name}`, "u"),
		new RegExp(`${prefix} 5.*${checking.name}`, "u"),
		new RegExp(`${prefix} 4.*${card.name}`, "u"),
		new RegExp(`${prefix} 3.*${checking.name}`, "u"),
		new RegExp(`${prefix} 2.*${card.name}`, "u"),
		new RegExp(`${prefix} 1.*${checking.name}`, "u"),
	]);
	await expect(summary(page)).toHaveText(`6 résultats · Total : ${euros(-600)}`);
});

test("the text search finds a label or a note, case aside", async ({ page, api }) => {
	const account = await api.openAccount();
	const word = uniqueName("Carrefour").replace(" ", "");
	await api.addTransaction(account.id, { date: daysAgo(3), label: `CB ${word}`, amount: "-1" });
	await api.addTransaction(account.id, {
		date: daysAgo(2),
		label: "Épicerie",
		amount: "-2",
		notes: `chez ${word.toUpperCase()}`,
	});
	await api.addTransaction(account.id, { date: daysAgo(1), label: "Boulangerie", amount: "-3" });

	await page.goto("/operations");
	await search(page, word.toLowerCase());

	await expect(rows(page)).toHaveText([/Épicerie/u, new RegExp(`CB ${word}`, "u")]);
	await expect(summary(page)).toHaveText(`2 résultats · Total : ${euros(-300)}`);
});

test("the account filter narrows the list to the chosen account", async ({ page, api }) => {
	const prefix = uniqueName("Compte");
	const { checking } = await twoAccounts(api, prefix);

	await page.goto(`/operations?q=${encodeURIComponent(prefix)}`);
	await expect(rows(page)).toHaveCount(6);

	const menu = await openFilter(page, "Compte");
	await menu.getByLabel(checking.name).check();
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(chip(page, checking.name)).toBeVisible();
	await expect(rows(page)).toHaveText(labelled(prefix, 5, 3, 1));
	await expect(page).toHaveURL(/[?&]account=/u);
});

test("the period filter keeps the days between its ends, both included", async ({ page, api }) => {
	const prefix = uniqueName("Période");
	await twoAccounts(api, prefix);

	await page.goto(`/operations?q=${encodeURIComponent(prefix)}`);
	const menu = await openFilter(page, "Période");
	await menu.getByLabel("Du", { exact: true }).fill(typed(daysAgo(8)));
	await menu.getByLabel("Au", { exact: true }).fill(typed(daysAgo(4)));
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(chip(page, `Du ${typed(daysAgo(8))} au ${typed(daysAgo(4))}`)).toBeVisible();
	await expect(rows(page)).toHaveText(labelled(prefix, 5, 4, 3));
});

test("a period ending before it starts is refused in the menu", async ({ page }) => {
	await page.goto("/operations");
	const menu = await openFilter(page, "Période");
	await menu.getByLabel("Du", { exact: true }).fill(typed(daysAgo(2)));
	await menu.getByLabel("Au", { exact: true }).fill(typed(daysAgo(5)));
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(menu.getByLabel("Au", { exact: true })).toHaveAccessibleDescription(
		"La date de fin doit suivre la date de début.",
	);
	await expect(page).not.toHaveURL(/[?&]to=/u);
});

test("an amount range the API would refuse is refused in the menu", async ({ page }) => {
	await page.goto("/operations");
	let menu = await openFilter(page, "Montant");
	await menu.getByLabel("Minimum").fill("60");
	await menu.getByLabel("Maximum").fill("50");
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(menu.getByLabel("Maximum")).toHaveAccessibleDescription(
		"Le maximum doit être supérieur ou égal au minimum.",
	);
	await expect(page).not.toHaveURL(/[?&]amountMin=/u);

	await page.keyboard.press("Escape");
	menu = await openFilter(page, "Montant");
	await menu.getByLabel("Minimum").fill("abc");
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(menu.getByLabel("Minimum")).toHaveAccessibleDescription(
		"Montant invalide. Exemple : 1 234,56.",
	);
	await expect(page).not.toHaveURL(/[?&]amountMin=/u);
});

test("the amount filter compares absolute values, expenses and income alike", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const prefix = uniqueName("Montant");
	await api.addTransaction(account.id, {
		date: daysAgo(3),
		label: `${prefix} A`,
		amount: "-42,90",
	});
	await api.addTransaction(account.id, { date: daysAgo(2), label: `${prefix} B`, amount: "45,00" });
	await api.addTransaction(account.id, {
		date: daysAgo(1),
		label: `${prefix} C`,
		amount: "-12,00",
	});

	await page.goto(`/operations?q=${encodeURIComponent(prefix)}`);
	await expect(rows(page)).toHaveCount(3);

	const menu = await openFilter(page, "Montant");
	await menu.getByLabel("Minimum").fill("40");
	await menu.getByLabel("Maximum").fill("50");
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(chip(page, "Montant de 40 à 50")).toBeVisible();
	await expect(rows(page)).toHaveText([
		new RegExp(`${prefix} B`, "u"),
		new RegExp(`${prefix} A`, "u"),
	]);
	await expect(summary(page)).toHaveText(`2 résultats · Total : +${euros(210)}`);
});

test("combined filters survive a reload, and a removed chip widens the list again", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Combiné");
	const { checking } = await twoAccounts(api, prefix);

	await page.goto("/operations");
	await search(page, prefix);
	let menu = await openFilter(page, "Compte");
	await menu.getByLabel(checking.name).check();
	await menu.getByRole("button", { name: "Appliquer" }).click();
	menu = await openFilter(page, "Période");
	await menu.getByLabel("Du", { exact: true }).fill(typed(daysAgo(9)));
	await menu.getByRole("button", { name: "Appliquer" }).click();

	const periodChip = chip(page, `Depuis le ${typed(daysAgo(9))}`);
	await expect(periodChip).toBeVisible();
	await expect(rows(page)).toHaveText(labelled(prefix, 5, 3));

	await page.reload();

	await expect(searchBox(page)).toHaveValue(prefix);
	await expect(chip(page, checking.name)).toBeVisible();
	await expect(periodChip).toBeVisible();
	await expect(rows(page)).toHaveCount(2);

	await periodChip.click();

	await expect(periodChip).toBeHidden();
	await expect(chip(page, checking.name)).toBeVisible();
	await expect(rows(page)).toHaveText(labelled(prefix, 5, 3, 1));
});

test("filters matching nothing say so, and « Effacer les filtres » clears every one", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	await api.addTransaction(account.id, {
		date: daysAgo(1),
		label: uniqueName("Rien"),
		amount: "-1",
	});

	await page.goto(
		`/operations?q=${encodeURIComponent(uniqueName("Introuvable"))}&amountMin=%221%22&from=${daysAgo(5)}`,
	);

	await expect(page.getByText("Aucune opération ne correspond à ces filtres.")).toBeVisible();
	await expect(summary(page)).toHaveText(`0 résultat · Total : ${euros(0)}`);
	await page.getByRole("button", { name: "Effacer les filtres" }).click();

	await expect(page).toHaveURL(/\/operations$/u);
	await expect(searchBox(page)).toHaveValue("");
	await expect(page.getByRole("button", { name: /^Retirer le filtre/u })).toHaveCount(0);
	await expect(rows(page).first()).toBeVisible();
});

test("the total adds the euro rows, excluded ones included, and counts the others", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Total");
	const euro = await api.openAccount();
	const dollars = await api.openAccount({ name: uniqueName("Dollars"), currency: "USD" });
	const excluded = await api.addTransaction(euro.id, {
		date: daysAgo(3),
		label: `${prefix} exclue`,
		amount: "-42,90",
	});
	await api.excludeTransaction(excluded);
	await api.addTransaction(euro.id, {
		date: daysAgo(2),
		label: `${prefix} revenu`,
		amount: "100,00",
	});
	await api.addTransaction(dollars.id, {
		date: daysAgo(1),
		label: `${prefix} dollars`,
		amount: "-10.00",
	});

	await page.goto(`/operations?q=${encodeURIComponent(prefix)}`);

	await expect(summary(page)).toHaveText(`3 résultats · Total : +${euros(5710)}`);
	await expect(
		page.getByText("1 opération dans une autre devise n'est pas comptée dans le total."),
	).toBeVisible();
});

test("the list pages at 50 transactions, and a reload keeps the page", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });
	const prefix = uniqueName("Page");
	await api.addDailyTransactions(account.id, 51, prefix);

	await page.goto(`/operations?q=${encodeURIComponent(prefix)}`);
	const pages = page.getByRole("navigation", { name: "Pages des opérations" });

	await expect(rows(page)).toHaveCount(50);
	await expect(pages).toContainText("Page 1 sur 2");
	await expect(summary(page)).toContainText("51 résultats");

	await pages.getByRole("link", { name: "Suivant" }).click();

	await expect(page).toHaveURL(/[?&]page=2/u);
	await expect(rows(page)).toHaveText([new RegExp(`${prefix} 51`, "u")]);

	await page.reload();

	await expect(pages).toContainText("Page 2 sur 2");
	await expect(rows(page)).toHaveText([new RegExp(`${prefix} 51`, "u")]);
	await expect(searchBox(page)).toHaveValue(prefix);
});

test("a page past the last one goes back to the last page", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });
	const prefix = uniqueName("Au-delà");
	await api.addDailyTransactions(account.id, 51, prefix);

	await page.goto(`/operations?q=${encodeURIComponent(prefix)}&page=5`);
	const pages = page.getByRole("navigation", { name: "Pages des opérations" });

	await expect(pages).toContainText("Page 2 sur 2");
	await expect(rows(page)).toHaveText([new RegExp(`${prefix} 51`, "u")]);
	await expect(page).toHaveURL(/[?&]page=2(&|$)/u);
});

test("a transaction excluded in the sheet is marked on both lists, and the balance stays", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00" });
	const label = uniqueName("Cadeau");
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-42,90" });
	const balance = euros(100_000 - 4290);

	await page.goto(`/operations?q=${encodeURIComponent(label)}`);
	await row(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	const exclude = sheet.getByRole("switch", { name: "Exclure des rapports" });
	await expect(exclude).not.toBeChecked();
	await exclude.click();
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expectExcluded(page, label);

	await page.goto(`/comptes/${account.id}`);
	await expect(
		page.getByRole("heading", { level: 1, name: account.name }).locator(".."),
	).toContainText(balance);
	await expectExcluded(page, label);

	await row(page, label).click();
	await expect(
		page
			.getByRole("dialog", { name: "Modifier l'opération" })
			.getByRole("switch", { name: "Exclure des rapports" }),
	).toBeChecked();
});

async function expectExcluded(page: Page, label: string) {
	const excludedRow = row(page, label);

	await expect(excludedRow).toHaveAccessibleName(/Exclue des rapports/u);
	await expect(excludedRow.getByText(euros(-4290))).toHaveClass(/text-muted-foreground/u);
	await excludedRow.locator('[data-slot="tooltip-trigger"]').hover();
	await expect(page.getByRole("tooltip")).toHaveText("Exclue des rapports");
	// Moves the pointer off, so the tooltip does not cover the next step.
	await page.mouse.move(0, 0);
}
