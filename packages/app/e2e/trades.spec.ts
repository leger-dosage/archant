import type { Locator, Page } from "@playwright/test";

import { formatTableDate } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";
import { chooseSubtype, startAccount } from "./new-account.ts";

// Story 22.2: buys and sales on an investment account, under « Ordres ».
// The suite's server keeps price fetching off unless a test turns it on, and
// points `YAHOO_FINANCE_URL` at a closed port: a provider's listings are
// shown by answering `GET /api/securities` here.

const header = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

// Anchored: « 1 septembre 2026 » is also the end of « 11 septembre 2026 ».
const tradeRow = (page: Page, iso: string) =>
	page.getByRole("row", { name: new RegExp(`^${formatTableDate(iso)} `, "u") });

/** Opens the security list and types `search` into it. */
async function searchSecurity(dialog: Locator, search: string) {
	await dialog.getByRole("button", { name: "Titre" }).click();
	await dialog.page().getByRole("combobox", { name: "Rechercher un titre" }).fill(search);
}

async function fillNumbers(
	dialog: Locator,
	{ date, quantity, price, fee }: { date: string; quantity: string; price: string; fee: string },
) {
	await dialog.getByLabel("Date", { exact: true }).fill(typed(date));
	await dialog.getByLabel("Quantité").fill(quantity);
	await dialog.getByLabel("Prix unitaire").fill(price);
	await dialog.getByLabel("Frais").fill(fee);
}

test("a PEA records a buy then a sale from « Ordres », its balance the cash plus what it holds", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "25 000,00",
		openingDate: daysAgo(30),
	});
	const fund = uniqueName("Fonds");
	const bought = daysAgo(5);
	const sold = daysAgo(2);

	await page.goto(`/accounts/${account.id}?tab=trades`);
	await expect(page.getByRole("tab", { name: "Ordres" })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByText("Aucun ordre saisi.")).toBeVisible();

	await test.step("a buy of a security typed by hand", async () => {
		await page.getByRole("button", { name: "Ajouter un ordre" }).click();
		const dialog = page.getByRole("dialog", { name: "Ajouter un ordre" });
		await expect(dialog.getByRole("radio", { name: "Achat" })).toBeChecked();
		await searchSecurity(dialog, fund);
		await page.getByRole("option", { name: "Saisir un titre manuellement" }).click();
		// What was typed in the search becomes the name.
		await expect(dialog.getByLabel("ISIN (facultatif)")).toHaveValue("");
		await expect(dialog.getByLabel("Nom du titre")).toHaveValue(fund);
		await fillNumbers(dialog, { date: bought, quantity: "10", price: "612,40", fee: "2,50" });
		await dialog.getByRole("button", { name: "Enregistrer" }).click();

		await expect(dialog).toBeHidden();
		await expect(tradeRow(page, bought).getByRole("cell")).toHaveText([
			formatTableDate(bought),
			"Achat",
			fund,
			"10 × 612,40 €",
			euros(-612_650),
		]);
		// The 10 shares, worth the buy's price, stay in the balance: only the fee leaves.
		await expect(header(page, account.name)).toContainText(euros(2_500_000 - 612_650 + 612_400));
	});

	await test.step("a sale of part of it, the security found among the known ones", async () => {
		await page.getByRole("button", { name: "Ajouter un ordre" }).click();
		const dialog = page.getByRole("dialog", { name: "Ajouter un ordre" });
		await dialog.getByRole("radio", { name: "Vente" }).click();
		await searchSecurity(dialog, fund.toLowerCase());
		await page.getByRole("group", { name: "Titres connus" }).getByRole("option").click();
		await expect(dialog.getByRole("button", { name: "Titre" })).toHaveText(fund);
		await fillNumbers(dialog, { date: sold, quantity: "4", price: "650", fee: "0" });
		await dialog.getByRole("button", { name: "Enregistrer" }).click();

		await expect(dialog).toBeHidden();
		await expect(tradeRow(page, sold).getByRole("cell")).toHaveText([
			formatTableDate(sold),
			"Vente",
			fund,
			"4 × 650,00 €",
			`+${euros(260_000)}`,
		]);
		// The 6 shares left are worth the sale's 650 €.
		await expect(header(page, account.name)).toContainText(
			euros(2_500_000 - 612_650 + 260_000 + 390_000),
		);
		// Most recent first.
		await expect(page.getByRole("row").nth(1)).toContainText(formatTableDate(sold));
	});
});

test("a sale above what is held saves, and « Positions » lists the position below zero", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ kind: "pea", openingDate: daysAgo(30) });
	const name = uniqueName("Titre");
	const sold = daysAgo(3);
	await api.recordTrade(account.id, {
		security: { source: "manual", name },
		date: daysAgo(5),
		quantity: "10",
		price: "10",
	});

	await page.goto(`/accounts/${account.id}?tab=trades`);
	await page.getByRole("button", { name: "Ajouter un ordre" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un ordre" });
	await dialog.getByRole("radio", { name: "Vente" }).click();
	await searchSecurity(dialog, name);
	await page.getByRole("group", { name: "Titres connus" }).getByRole("option").click();
	await fillNumbers(dialog, { date: sold, quantity: "15", price: "10", fee: "0" });
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	// As Sure's, nothing warns: the sale is saved and the quantity goes below zero.
	await expect(dialog).toBeHidden();
	await expect(tradeRow(page, sold)).toContainText("15 × 10,00 €");
	await expect(tradeRow(page, sold)).toContainText(`+${euros(15_000)}`);

	await page.getByRole("tab", { name: "Positions" }).click();
	const cells = page
		.getByRole("row")
		.filter({ has: page.getByRole("button", { name: new RegExp(`^${name}`, "u") }) })
		.getByRole("cell");
	await expect(cells.nth(2)).toHaveText("—");
	await expect(cells.nth(3)).toContainText(euros(-5_000));
	await expect(cells.nth(3)).toContainText("−5 × 10,00 €");
	await expect(page.getByRole("row").last().getByRole("cell").nth(0)).toHaveText("Liquidités");

	// No cost basis to set on a position sold short, as Sure's server refuses one.
	await page.getByRole("button", { name: new RegExp(`^${name}`, "u") }).click();
	const sheet = page.getByRole("dialog", { name });
	await expect(sheet.getByText("−5", { exact: true })).toBeVisible();
	await expect(sheet.getByRole("region", { name: "Prix de revient unitaire" })).toHaveCount(0);
});

test("a trade opened from its row is edited, then deleted, and the balance follows its fee", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("Compte-titres"),
		kind: "brokerage",
		openingBalance: "1 000,00",
		openingDate: daysAgo(30),
	});
	const date = daysAgo(5);
	await api.recordTrade(account.id, {
		security: { source: "manual", isin: "FR0010315770", name: "Fonds euros" },
		date,
		quantity: "2",
		price: "100",
	});

	await page.goto(`/accounts/${account.id}?tab=trades`);
	// The cash less the buy, plus the two units at its price.
	await expect(header(page, account.name)).toContainText(euros(100_000));
	await tradeRow(page, date)
		.getByRole("button", { name: formatTableDate(date) })
		.click();
	const dialog = page.getByRole("dialog", { name: "Modifier l'ordre" });
	// The security of a recorded trade never changes.
	await expect(dialog.getByLabel("Titre")).toBeDisabled();
	await expect(dialog.getByLabel("Titre")).toHaveValue("Fonds euros");
	await dialog.getByLabel("Quantité").fill("3");
	await dialog.getByLabel("Frais").fill("5");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(tradeRow(page, date)).toContainText("3 × 100,00 €");
	await expect(header(page, account.name)).toContainText(euros(99_500));

	await tradeRow(page, date)
		.getByRole("button", { name: formatTableDate(date) })
		.click();
	await dialog.getByRole("button", { name: "Supprimer" }).click();
	await page
		.getByRole("alertdialog", { name: `Supprimer l'ordre du ${formatTableDate(date)} ?` })
		.getByRole("button", { name: "Supprimer l'ordre" })
		.click();

	await expect(page.getByText("Aucun ordre saisi.")).toBeVisible();
	await expect(header(page, account.name)).toContainText(euros(100_000));
});

test("deleting a buy a later sale needs succeeds, the sale left short", async ({ page, api }) => {
	const account = await api.openAccount({ kind: "pea", openingDate: daysAgo(30) });
	const security = { source: "manual", isin: "FR0010315770", name: "Fonds euros" };
	const bought = daysAgo(5);
	await api.recordTrade(account.id, { security, date: bought, quantity: "10", price: "10" });
	await api.recordTrade(account.id, {
		side: "sell",
		security,
		date: daysAgo(2),
		quantity: "10",
		price: "12",
	});

	await page.goto(`/accounts/${account.id}?tab=trades`);
	await tradeRow(page, bought)
		.getByRole("button", { name: formatTableDate(bought) })
		.click();
	await page
		.getByRole("dialog", { name: "Modifier l'ordre" })
		.getByRole("button", { name: "Supprimer" })
		.click();
	await page
		.getByRole("alertdialog", { name: `Supprimer l'ordre du ${formatTableDate(bought)} ?` })
		.getByRole("button", { name: "Supprimer l'ordre" })
		.click();

	await expect(page.getByRole("dialog", { name: "Modifier l'ordre" })).toBeHidden();
	await expect(tradeRow(page, bought)).toBeHidden();
	await expect(page.getByRole("row")).toHaveCount(2);

	await page.getByRole("tab", { name: "Positions" }).click();
	await expect(page.getByRole("row").filter({ hasText: "Fonds euros" })).toContainText(
		"−10 × 12,00 €",
	);
});

test("the security list says when fetching is off or Yahoo fails, and offers its listings once on", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ kind: "pea", openingDate: daysAgo(30) });
	const ticker = `T${Date.now().toString(36).toUpperCase()}.PA`;
	let state: "off" | "unavailable" | "on" = "off";
	await page.route("**/api/securities?**", (route) =>
		route.fulfill({
			json: {
				data: {
					enabled: state !== "off",
					known: [],
					items:
						state === "on"
							? [{ ticker, name: "Air Liquide", mic: "XPAR", currency: "EUR", provider: "yahoo" }]
							: [],
					unavailable: state === "unavailable",
				},
			},
		}),
	);

	await page.goto(`/accounts/${account.id}?tab=trades`);
	await page.getByRole("button", { name: "Ajouter un ordre" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un ordre" });
	await searchSecurity(dialog, "air");

	await expect(page.getByRole("status").filter({ hasText: "désactivée" })).toHaveText(
		"La récupération des cours est désactivée : seuls les titres connus et la saisie manuelle sont proposés.",
	);
	await expect(page.getByRole("option", { name: "Saisir un titre manuellement" })).toBeVisible();

	state = "unavailable";
	await page.getByRole("combobox", { name: "Rechercher un titre" }).fill("air l");
	await expect(page.getByRole("status").filter({ hasText: "ne répond pas" })).toHaveText(
		"Yahoo Finance ne répond pas : seuls les titres connus et la saisie manuelle sont proposés.",
	);

	state = "on";
	await page.getByRole("combobox", { name: "Rechercher un titre" }).fill("air liquide");
	await page.getByRole("group", { name: "Yahoo Finance" }).getByRole("option").click();
	await expect(dialog.getByRole("button", { name: "Titre" })).toHaveText(`Air Liquide (${ticker})`);
	await fillNumbers(dialog, { date: daysAgo(4), quantity: "1", price: "180", fee: "0" });
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(tradeRow(page, daysAgo(4))).toContainText(`Air Liquide${ticker}`);
});

test("a dividend on a held fund and interest on cash, added from « Ordres », move only the cash", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "25 000,00",
		openingDate: daysAgo(30),
	});
	const fund = uniqueName("Fonds");
	await api.recordTrade(account.id, {
		security: { source: "manual", name: fund },
		date: daysAgo(10),
		quantity: "10",
		price: "612,40",
		fee: "2,50",
	});
	const paid = daysAgo(4);
	const earned = daysAgo(3);
	const before = 2_500_000 - 612_650 + 612_400;

	await page.goto(`/accounts/${account.id}?tab=trades`);
	await expect(header(page, account.name)).toContainText(euros(before));

	await test.step("a dividend, on one of the account's positions", async () => {
		await page.getByRole("button", { name: "Ajouter un ordre" }).click();
		const dialog = page.getByRole("dialog", { name: "Ajouter un ordre" });
		await dialog.getByRole("radio", { name: "Dividende" }).click();
		// An income takes its amount alone.
		await expect(dialog.getByLabel("Quantité")).toHaveCount(0);
		await dialog.getByRole("combobox", { name: "Titre" }).click();
		await expect(page.getByRole("option", { name: "Liquidités" })).toHaveCount(0);
		await page.getByRole("option", { name: fund }).click();
		await dialog.getByLabel("Date", { exact: true }).fill(typed(paid));
		await dialog.getByLabel("Montant").fill("12,34");
		await dialog.getByRole("button", { name: "Enregistrer" }).click();

		await expect(dialog).toBeHidden();
		await expect(tradeRow(page, paid).getByRole("cell")).toHaveText([
			formatTableDate(paid),
			"Dividende",
			fund,
			"",
			`+${euros(1234)}`,
		]);
		await expect(header(page, account.name)).toContainText(euros(before + 1234));
	});

	await test.step("interest, on the account's cash, offered first", async () => {
		await page.getByRole("button", { name: "Ajouter un ordre" }).click();
		const dialog = page.getByRole("dialog", { name: "Ajouter un ordre" });
		await dialog.getByRole("radio", { name: "Intérêts" }).click();
		await expect(dialog.getByRole("combobox", { name: "Titre" })).toHaveText("Liquidités");
		await dialog.getByLabel("Date", { exact: true }).fill(typed(earned));
		await dialog.getByLabel("Montant").fill("3");
		await dialog.getByRole("button", { name: "Enregistrer" }).click();

		await expect(dialog).toBeHidden();
		await expect(tradeRow(page, earned).getByRole("cell")).toHaveText([
			formatTableDate(earned),
			"Intérêts",
			"Liquidités",
			"",
			`+${euros(300)}`,
		]);
		await expect(header(page, account.name)).toContainText(euros(before + 1234 + 300));
	});

	await test.step("the position holds what it held, the dividend in its sheet", async () => {
		await page.getByRole("tab", { name: "Positions" }).click();
		const opener = page.getByRole("button", { name: fund, exact: true });
		// The dividend sets no price: the buy's stays.
		await expect(page.getByRole("row").filter({ has: opener })).toContainText("10 × 612,40 €");
		await opener.click();
		const position = page.getByRole("dialog", { name: fund });
		await expect(position.getByRole("list", { name: "Ordres" })).toContainText("Dividende");
		await expect(position.getByRole("list", { name: "Ordres" })).toContainText(
			"Achat · 10 × 612,40 €",
		);
	});
});

test("an income's amount is edited, its type and security kept", async ({ page, api }) => {
	const account = await api.openAccount({ kind: "pea", openingDate: daysAgo(30) });
	const date = daysAgo(3);
	await api.recordTrade(account.id, { side: "interest", security: null, date, amount: "3" });

	await page.goto(`/accounts/${account.id}?tab=trades`);
	await tradeRow(page, date)
		.getByRole("button", { name: formatTableDate(date) })
		.click();
	const dialog = page.getByRole("dialog", { name: "Modifier l'ordre" });
	await expect(dialog.getByRole("radio", { name: "Intérêts" })).toBeChecked();
	await expect(dialog.getByRole("radio")).toHaveCount(1);
	await expect(dialog.getByLabel("Titre")).toHaveValue("Liquidités");
	await expect(dialog.getByLabel("Montant")).toHaveValue("3,00");
	await dialog.getByLabel("Montant").fill("0");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog.getByLabel("Montant")).toHaveAccessibleDescription(
		"Le montant doit être supérieur à zéro.",
	);
	await dialog.getByLabel("Montant").fill("4,50");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(tradeRow(page, date)).toContainText(`+${euros(450)}`);
});

for (const [kind, name] of [
	["checking", "a checking account"],
	["wallet", "a crypto wallet"],
] as const) {
	test(`${name} has no « Ordres »: only an investment account and a crypto exchange take trades`, async ({
		page,
		api,
	}) => {
		const account = await api.openAccount({ kind });

		await page.goto(`/accounts/${account.id}?tab=trades`);

		await expect(page.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(page.getByRole("tab", { name: "Ordres" })).toHaveCount(0);
	});
}

// Story 28.11: Sure's crypto exchange takes trades at its 18 decimals.
test("a crypto exchange created through the dialog records a buy of 0,000166666666666667 from « Ordres »", async ({
	page,
}) => {
	const name = uniqueName("Plateforme");
	const date = daysAgo(2);

	await page.goto("/accounts");
	const create = await startAccount(
		page,
		page.getByRole("main").getByRole("button", { name: "Ajouter un compte" }),
		"crypto",
	);
	await create.getByLabel("Nom du compte").fill(name);
	await chooseSubtype(page, create, "Plateforme d'échange crypto");
	await expect(create.getByRole("combobox", { name: "Traitement fiscal" })).toHaveText("Imposable");
	await expect(
		create.getByRole("combobox", { name: "Traitement fiscal" }),
	).toHaveAccessibleDescription(
		"La plupart des cryptomonnaies sont détenues dans des comptes imposables. Sélectionnez une autre option si elles sont détenues dans un compte fiscalement avantageux.",
	);
	await create.getByLabel("Solde à la date :").fill("1 000,00");
	await create.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(create).toBeHidden();

	const row = page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) });
	await expect(row.getByText("Plateforme d'échange", { exact: true })).toBeVisible();
	await row.click();
	await page.getByRole("tab", { name: "Ordres" }).click();
	await page.getByRole("button", { name: "Ajouter un ordre" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un ordre" });
	await searchSecurity(dialog, "Bitcoin");
	await page.getByRole("option", { name: "Saisir un titre manuellement" }).click();
	await fillNumbers(dialog, {
		date,
		quantity: "0,000166666666666667",
		price: "60 000",
		fee: "0",
	});
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(tradeRow(page, date)).toContainText("0,000166666666666667 × 60 000,00 €");
	await expect(tradeRow(page, date)).toContainText(euros(-1000));
	// The cash less 10,00 €, plus the position worth them: the balance stays.
	await expect(header(page, name)).toContainText(euros(100_000));

	await page.getByRole("tab", { name: "Positions" }).click();
	const cells = page
		.getByRole("row")
		.filter({ has: page.getByRole("button", { name: /^Bitcoin/u }) })
		.getByRole("cell");
	await expect(cells.nth(3)).toContainText(euros(1000));
	await expect(cells.nth(3)).toContainText("0,000166666666666667 × 60 000,00 €");
});

test("a crypto exchange turned into a wallet keeps « Positions » and « Ordres », its trade there, with no action to record a new one", async ({
	page,
	api,
	request,
}) => {
	const account = await api.openAccount({
		name: uniqueName("Plateforme"),
		kind: "exchange",
		openingBalance: "1 000,00",
		openingDate: daysAgo(30),
	});
	const name = uniqueName("Bitcoin");
	const date = daysAgo(5);
	await api.recordTrade(account.id, {
		security: { source: "manual", name },
		date,
		quantity: "0,01",
		price: "50 000",
	});
	const patched = await request.patch(`/api/accounts/${account.id}`, {
		data: { subtype: "wallet" },
	});
	expect(patched.ok(), `${patched.url()} answered ${await patched.text()}`).toBe(true);

	await page.goto(`/accounts/${account.id}?tab=positions`);
	await expect(page.getByRole("button", { name: new RegExp(`^${name}`, "u") })).toBeVisible();

	await page.getByRole("tab", { name: "Ordres" }).click();
	await expect(tradeRow(page, date)).toContainText("0,01 × 50 000,00 €");
	await expect(page.getByRole("button", { name: "Ajouter un ordre" })).toHaveCount(0);
});
