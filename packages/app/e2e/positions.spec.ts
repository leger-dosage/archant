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
		await expect(sheet.getByRole("definition").first()).toHaveText(
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

		await expect(sheet.getByRole("definition").first()).toHaveText(
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
