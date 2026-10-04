import type { Locator, Page } from "@playwright/test";

import { formatTableDate } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

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

test("a PEA records a buy then a sale from « Ordres », and its balance moves by both", async ({
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
		await expect(header(page, account.name)).toContainText(euros(2_500_000 - 612_650));
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
		await expect(header(page, account.name)).toContainText(euros(2_500_000 - 612_650 + 260_000));
		// Most recent first.
		await expect(page.getByRole("row").nth(1)).toContainText(formatTableDate(sold));
	});
});

test("a sale above what is held is refused on its quantity, and nothing is written", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ kind: "pea", openingDate: daysAgo(30) });
	const name = uniqueName("Titre");
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
	await fillNumbers(dialog, { date: daysAgo(3), quantity: "11", price: "10", fee: "0" });
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog.getByLabel("Quantité")).toHaveAccessibleDescription(
		"Le compte ne détient pas assez de ce titre, à cette date ou pour une vente qui suit.",
	);
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(page.getByRole("row")).toHaveCount(2);
});

test("a trade opened from its row is edited, then deleted, and the balance follows", async ({
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
	await expect(header(page, account.name)).toContainText(euros(80_000));
	await tradeRow(page, date)
		.getByRole("button", { name: formatTableDate(date) })
		.click();
	const dialog = page.getByRole("dialog", { name: "Modifier l'ordre" });
	// The security of a recorded trade never changes.
	await expect(dialog.getByLabel("Titre")).toBeDisabled();
	await expect(dialog.getByLabel("Titre")).toHaveValue("Fonds euros");
	await dialog.getByLabel("Quantité").fill("3");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(tradeRow(page, date)).toContainText("3 × 100,00 €");
	await expect(header(page, account.name)).toContainText(euros(70_000));

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

test("deleting a buy a later sale needs is refused, and both rows stay", async ({ page, api }) => {
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

	await expect(
		page.locator("[data-sonner-toast]").filter({
			hasText:
				"Le compte ne détient pas assez de ce titre : une vente, à sa date ou plus tard, dépasserait ce qu'il détient.",
		}),
	).toBeVisible();
	const dialog = page.getByRole("dialog", { name: "Modifier l'ordre" });
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("row")).toHaveCount(3);
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

test("only an investment account has « Ordres »", async ({ page, api }) => {
	const account = await api.openAccount();

	await page.goto(`/accounts/${account.id}?tab=trades`);

	await expect(page.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("tab", { name: "Ordres" })).toHaveCount(0);
});
