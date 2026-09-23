import type { Page } from "@playwright/test";

import { toMinorUnits } from "@archant/data/money";

import {
	formatSignedMoney,
	formatSignedPercent,
	formatTableDate,
} from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

// Story 6.1: net worth and its history. One database serves the whole run,
// so totals are asserted as a change from what the API reports before.

const card = (page: Page) => page.getByRole("region", { name: "Patrimoine net" });

/** The stat block: the « Patrimoine net » label, the amount and its change. */
const headline = (page: Page) => card(page).getByRole("group", { name: "Patrimoine net" });

const total = (page: Page, label: "Actifs" | "Passifs") =>
	card(page).getByRole("group", { name: label, exact: true });

test("a checking account and a card move net worth, assets and liabilities", async ({
	page,
	api,
}) => {
	const before = await api.netWorth();
	await api.openAccount({ openingBalance: "1 000,00" });
	await api.openAccount({ kind: "credit_card", openingBalance: "300,00" });

	await page.goto("/");

	await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
	await expect(headline(page)).toContainText(euros(before.netWorth + 70_000));
	await expect(total(page, "Actifs")).toContainText(euros(before.assets + 100_000));
	await expect(total(page, "Passifs")).toContainText(euros(before.liabilities + 30_000));
});

test("« 3 M » keeps the period in the URL, and the summary and table follow it", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(200) });
	await api.addTransaction(account.id, { date: daysAgo(10), label: "Loyer", amount: "-100,00" });
	const expected = await api.netWorth("3M");
	const last = expected.points.at(-1);
	const change = expected.change;

	expect(last?.date).toBe(daysAgo(0));
	expect(change?.percent).not.toBeNull();

	await page.goto("/");
	const periods = card(page).getByRole("radiogroup", { name: "Période" });
	await expect(periods.getByRole("radio", { name: "1 M" })).toBeChecked();
	await periods.getByRole("radio", { name: "3 M" }).click();

	await expect(page).toHaveURL(/[?&]period=3M(&|$)/u);
	const amount = formatSignedMoney(toMinorUnits(change?.amount ?? 0), "EUR");
	const percent = formatSignedPercent(change?.percent ?? 0);
	await expect(card(page).getByText(/^Patrimoine net : /u)).toHaveText(
		`Patrimoine net : ${euros(last?.balance ?? 0)}, ${amount} (${percent}) sur 3 mois.`,
	);
	await expect(headline(page)).toContainText(`${amount} (${percent}) sur 3 mois`);

	await card(page).getByRole("button", { name: "Voir les données" }).click();
	const table = card(page).getByRole("table");
	await expect(table.getByRole("columnheader")).toHaveText(["Date", "Patrimoine net"]);
	await expect(table.getByRole("row")).toHaveCount(expected.points.length + 1);
	await expect(table.getByRole("row").nth(1)).toContainText(formatTableDate(daysAgo(0)));
	await expect(table.getByRole("row").nth(1)).toContainText(euros(last?.balance ?? 0));
});

test("an unknown period in the URL falls back to one month, the default absent from the URL", async ({
	page,
	api,
}) => {
	await api.openAccount();

	await page.goto("/?period=decennie");

	await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
	const periods = card(page).getByRole("radiogroup", { name: "Période" });
	await expect(periods.getByRole("radio", { name: "1 M" })).toBeChecked();

	await periods.getByRole("radio", { name: "3 M" }).click();
	await expect(page).toHaveURL(/[?&]period=3M(&|$)/u);
	await periods.getByRole("radio", { name: "1 M" }).click();
	await expect(periods.getByRole("radio", { name: "1 M" })).toBeChecked();
	await expect(page).not.toHaveURL(/[?&]period=/u);
});

test("an account in another currency is named in the notice and left out of the totals", async ({
	page,
	api,
}) => {
	const before = await api.netWorth();
	const dollars = await api.openAccount({
		name: uniqueName("Compte USD"),
		currency: "USD",
		openingBalance: "500,00",
	});

	await page.goto("/");

	await expect(page.getByText(/^Hors des totaux, faute de conversion : /u)).toContainText(
		dollars.name,
	);
	await expect(headline(page)).toContainText(euros(before.netWorth));
	await expect(total(page, "Actifs")).toContainText(euros(before.assets));
});

test("a household without accounts sees the empty state", async ({ page }) => {
	// The shared database already holds other tests' accounts; the empty state
	// is what the API's empty list looks like.
	await page.route("**/api/accounts", (route) =>
		route.fulfill({
			json: {
				data: {
					reportingCurrency: "EUR",
					groups: [
						{ classification: "asset", accounts: [], total: 0, excludedCount: 0 },
						{ classification: "liability", accounts: [], total: 0, excludedCount: 0 },
					],
				},
			},
		}),
	);

	await page.goto("/");

	await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
	await expect(page.getByText("Aucun compte pour l'instant.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Ajouter un compte" })).toBeVisible();
	await expect(card(page)).toHaveCount(0);
});
