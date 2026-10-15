import type { Page } from "@playwright/test";

import { formatShortDate } from "../src/lib/balance-change.ts";
import { formatShare } from "../src/lib/trade-format.ts";
import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

// Story 22.4: an investment account's « Positions », as Sure's holdings
// table, and a position's sheet, as Sure's holding drawer. The suite's server
// keeps price fetching off: a security from a provider is priced by its trades.

const header = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** The name and, below it, the ticker or the ISIN name the row's button. */
const opener = (page: Page, name: string) =>
	page.getByRole("button", {
		name: new RegExp(`^${name.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"),
	});

const positionRow = (page: Page, name: string) =>
	page.getByRole("row").filter({ has: opener(page, name) });

test("« Positions » lists each security by value with its weight, PRU, value and gain, then the cash; its sheet types a price and locks a cost basis", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "9 000,00",
		openingDate: daysAgo(30),
	});
	const fund = uniqueName("Fonds A");
	const free = uniqueName("Parts B");
	const bought = daysAgo(10);
	await api.recordTrade(account.id, {
		security: { source: "manual", name: fund },
		date: bought,
		quantity: "100",
		price: "50",
	});
	// A free share: worth nothing, no book value to measure a gain against.
	await api.recordTrade(account.id, {
		security: { source: "manual", isin: "FR0000120073", name: free },
		date: daysAgo(9),
		quantity: "10",
		price: "0",
	});

	await page.goto(`/accounts/${account.id}?tab=positions`);
	await expect(page.getByRole("tab", { name: "Positions" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const table = page.getByRole("table", { name: "Positions du compte" });
	const sheet = page.getByRole("dialog", { name: fund });

	await test.step("each position at its trade's price, then the cash", async () => {
		await expect(table.getByRole("columnheader")).toHaveText([
			"Titre",
			"Poids",
			"PRU",
			"Valeur",
			"+/- value latente",
		]);
		const cells = positionRow(page, fund).getByRole("cell");
		await expect(cells.nth(1)).toHaveText(formatShare("55.555556"));
		await expect(cells.nth(2)).toHaveText("50,00 €");
		await expect(cells.nth(3)).toContainText(euros(500_000));
		await expect(cells.nth(3)).toContainText("100 × 50,00 €");
		await expect(cells.nth(4)).toContainText(euros(0));
		await expect(positionRow(page, free).getByRole("cell").nth(0)).toContainText("FR0000120073");
		await expect(table.getByRole("row").last().getByRole("cell").nth(0)).toHaveText("Liquidités");
		await expect(table.getByRole("row").last()).toContainText(euros(400_000));
	});

	await test.step("the sheet shows the last price, its day and the trades", async () => {
		await opener(page, fund).click();

		await expect(sheet).toBeVisible();
		// « Titre » first, as Sure's drawer, then the last price.
		await expect(sheet.getByRole("definition").nth(1)).toHaveText(
			`50,00 € le ${formatShortDate(bought)}`,
		);
		await expect(sheet.getByRole("list", { name: "Ordres" })).toContainText(
			"Achat · 100 × 50,00 €",
		);
	});

	await test.step("« Saisir un cours » values the position and the balance at once", async () => {
		const typed = sheet.getByRole("region", { name: "Saisir un cours" });
		const price = typed.getByLabel("Cours", { exact: true });
		await price.fill("0");
		await typed.getByRole("button", { name: "Enregistrer le cours" }).click();
		await expect(price).toHaveAccessibleDescription(
			"Cours invalide : un nombre supérieur à zéro, six décimales au plus. Exemple : 105,20.",
		);

		await price.fill("60");
		await typed.getByRole("button", { name: "Enregistrer le cours" }).click();

		await expect(sheet.getByRole("definition").nth(1)).toHaveText(
			`60,00 € le ${formatShortDate(daysAgo(0))}`,
		);
		await expect(sheet.getByRole("region", { name: "Aperçu" })).toContainText(`+${euros(100_000)}`);
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();

		await expect(header(page, account.name)).toContainText(euros(1_000_000));
		const cells = positionRow(page, fund).getByRole("cell");
		await expect(cells.nth(1)).toHaveText(formatShare("60"));
		await expect(cells.nth(4)).toContainText(`+${euros(100_000)}`);
		await expect(cells.nth(4)).toContainText("+20,0");
		await expect(table.getByRole("row").last().getByRole("cell").nth(1)).toHaveText(
			formatShare("40"),
		);
	});

	await test.step("a cost basis set by hand is locked, then the calculated one comes back", async () => {
		await opener(page, fund).click();
		const costBasis = sheet.getByRole("region", { name: "Prix de revient unitaire" });
		await expect(costBasis.getByLabel("PRU")).toHaveValue("50");
		await costBasis.getByLabel("PRU").fill("40");
		await costBasis.getByRole("button", { name: "Verrouiller le PRU" }).click();

		await expect(costBasis.getByText("Verrouillé : saisi par vous.")).toBeVisible();
		await expect(sheet.getByRole("region", { name: "Aperçu" })).toContainText(`+${euros(200_000)}`);
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();
		const cells = positionRow(page, fund).getByRole("cell");
		await expect(cells.nth(2).getByRole("img", { name: "PRU verrouillé" })).toBeAttached();
		await expect(cells.nth(2)).toContainText("40,00 €");
		await expect(cells.nth(4)).toContainText("+50,0");

		await opener(page, fund).click();
		await costBasis.getByRole("button", { name: "Revenir au PRU calculé" }).click();

		await expect(costBasis.getByText("Verrouillé : saisi par vous.")).toHaveCount(0);
		await expect(costBasis.getByLabel("PRU")).toHaveValue("50");
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();
		await expect(cells.nth(2)).toHaveText("50,00 €");
	});
});

test("a position's sheet remaps it onto a known security, merging the two, and deletes another after confirming", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "9 000,00",
		openingDate: daysAgo(30),
	});
	const wrong = uniqueName("Fonds mal saisi");
	const right = uniqueName("Fonds juste");
	const gone = uniqueName("Fonds supprimé");
	await api.recordTrade(account.id, {
		security: { source: "manual", name: wrong },
		date: daysAgo(10),
		quantity: "10",
		price: "50",
	});
	await api.recordTrade(account.id, {
		security: { source: "manual", name: right },
		date: daysAgo(8),
		quantity: "5",
		price: "50",
	});
	await api.recordTrade(account.id, {
		security: { source: "manual", name: gone },
		date: daysAgo(6),
		quantity: "2",
		price: "50",
	});

	// A security in dollars, which a euro account's position cannot move to (AD-6).
	const dollars = uniqueName("Fonds en dollars");
	const usd = await api.openAccount({ kind: "pea", currency: "USD", openingDate: daysAgo(30) });
	await api.recordTrade(usd.id, {
		security: { source: "manual", name: dollars },
		date: daysAgo(5),
		quantity: "1",
		price: "10",
	});

	await page.goto(`/accounts/${account.id}?tab=positions`);
	const table = page.getByRole("table", { name: "Positions du compte" });

	await test.step("a security in another currency is refused on the field, the sheet left open", async () => {
		await opener(page, wrong).click();
		const sheet = page.getByRole("dialog", { name: wrong });
		await sheet.getByRole("button", { name: "Modifier le titre" }).click();
		await sheet.getByRole("button", { name: "Rechercher un titre" }).click();
		await page.getByRole("combobox", { name: "Rechercher un titre" }).fill(dollars);
		await page.getByRole("option", { name: new RegExp(dollars, "u") }).click();
		await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click();

		await expect(
			sheet.getByRole("button", { name: "Rechercher un titre" }),
		).toHaveAccessibleDescription("Ce titre n'est pas coté dans la devise du compte.");
		await expect(sheet).toBeVisible();
		await sheet.getByRole("button", { name: "Annuler" }).click();
		await expect(sheet.getByRole("button", { name: "Rechercher un titre" })).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();
	});

	await test.step("« Modifier le titre » moves the trades onto a known security, one row left", async () => {
		await opener(page, wrong).click();
		const sheet = page.getByRole("dialog", { name: wrong });
		await expect(sheet.getByRole("definition").first()).toContainText(wrong);
		await sheet.getByRole("button", { name: "Modifier le titre" }).click();
		await sheet.getByRole("button", { name: "Rechercher un titre" }).click();
		const search = page.getByRole("combobox", { name: "Rechercher un titre" });
		await search.fill(right);
		await expect(page.getByRole("option", { name: "Saisir un titre manuellement" })).toHaveCount(0);
		await expect(page.getByRole("status").filter({ hasText: "désactivée" })).toHaveText(
			"La récupération des cours est désactivée : seuls les titres connus sont proposés.",
		);
		await page.getByRole("option", { name: new RegExp(right, "u") }).click();
		await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click();

		await expect(sheet).toBeHidden();
		await expect(page.getByText("Titre mis à jour avec succès.")).toBeVisible();
		await expect(opener(page, wrong)).toHaveCount(0);
		await expect(positionRow(page, right)).toHaveCount(1);
		await expect(positionRow(page, right).getByRole("cell").nth(3)).toContainText("15 × 50,00 €");
	});

	await test.step("« Supprimer la position » deletes it with its trades once confirmed", async () => {
		await opener(page, gone).click();
		const sheet = page.getByRole("dialog", { name: gone });
		const settings = sheet.getByRole("region", { name: "Paramètres" });
		await expect(settings).toContainText("Supprimer la position");
		await settings.getByRole("button", { name: "Supprimer" }).click();
		const confirm = page.getByRole("alertdialog", { name: "Êtes-vous sûr ?" });
		await expect(confirm).toContainText("Cette action ne peut pas être annulée.");
		await confirm.getByRole("button", { name: "Confirmer" }).click();

		await expect(sheet).toBeHidden();
		await expect(page.getByText("Position supprimée")).toBeVisible();
		await expect(opener(page, gone)).toHaveCount(0);
		// The cash is back: 9 000 € less the 750 € of the two others.
		await expect(table.getByRole("row").last()).toContainText(euros(825_000));
	});
});

test("a security its provider prices offers no « Saisir un cours »", async ({ page, api }) => {
	const account = await api.openAccount({ kind: "pea", openingDate: daysAgo(30) });
	const ticker = `P${Date.now().toString(36).toUpperCase()}.PA`;
	await api.recordTrade(account.id, {
		security: {
			source: "listing",
			ticker,
			mic: "XPAR",
			name: "Air Liquide",
			currency: "EUR",
			provider: "yahoo",
		},
		date: daysAgo(4),
		quantity: "1",
		price: "180",
	});

	await page.goto(`/accounts/${account.id}?tab=positions`);
	await opener(page, "Air Liquide").click();
	const sheet = page.getByRole("dialog", { name: "Air Liquide" });

	await expect(sheet.getByRole("region", { name: "Prix de revient unitaire" })).toBeVisible();
	await expect(sheet.getByRole("region", { name: "Saisir un cours" })).toHaveCount(0);
});

test("an investment account that never traded has no « Positions », and a link to it opens « Opérations »", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ kind: "pea", openingDate: daysAgo(30) });
	await api.recordSnapshot(account.id, { date: daysAgo(3), balance: "1 200,00" });

	await page.goto(`/accounts/${account.id}?tab=positions`);

	await expect(page.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("tab", { name: "Ordres" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Positions" })).toHaveCount(0);
});
