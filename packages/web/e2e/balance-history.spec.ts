import { formatTableDate } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, test } from "./fixtures.ts";

// Story 1.3: daily balance history.

const PERIODS = [
	{ label: "3 M", param: "3M", over: "sur 3 mois" },
	{ label: "6 M", param: "6M", over: "sur 6 mois" },
	{ label: "1 A", param: "1Y", over: "sur 1 an" },
	{ label: "Tout", param: "all", over: "depuis l'ouverture" },
] as const;

// Anchored: « 1 septembre 2026 » is also the end of « 11 septembre 2026 ».
const dayRow = (iso: string) => new RegExp(`^${formatTableDate(iso)} `, "u");

test("each period selects, and the summary names it", async ({ page, api }) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(400) });
	await api.addTransaction(account.id, { date: daysAgo(10), label: "Loyer", amount: "-100,00" });

	await page.goto(`/comptes/${account.id}`);
	const periods = page.getByRole("radiogroup", { name: "Période" });
	const summary = page.getByText(/^Solde : /u);

	await expect(periods.getByRole("radio", { name: "1 M" })).toBeChecked();
	await expect(summary).toContainText(euros(90_000));
	await expect(summary).toContainText("sur 1 mois");

	// One after the other: each click must land before the next one.
	await PERIODS.reduce(async (previous, period) => {
		await previous;
		await periods.getByRole("radio", { name: period.label }).click();

		await expect(periods.getByRole("radio", { name: period.label })).toBeChecked();
		await expect(page).toHaveURL(new RegExp(`[?&]period=${period.param}(&|$)`, "u"));
		await expect(summary).toContainText(period.over);
		await expect(summary).toContainText(euros(90_000));
	}, Promise.resolve());

	// The default period is the absent param.
	await periods.getByRole("radio", { name: "1 M" }).click();
	await expect(page).not.toHaveURL(/[?&]period=/u);
	await expect(summary).toContainText("sur 1 mois");
});

test("« Voir les données » shows the series as a table", async ({ page, api }) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(60) });
	await api.addTransaction(account.id, { date: daysAgo(10), label: "Loyer", amount: "-100,00" });

	await page.goto(`/comptes/${account.id}`);
	const toggle = page.getByRole("button", { name: "Voir les données" });

	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");

	const table = page.getByRole("table");
	await expect(table.getByRole("columnheader")).toHaveText(["Date", "Solde"]);
	// Most recent first; a day without transactions carries the previous balance.
	await expect(table.getByRole("row").nth(1)).toContainText(formatTableDate(daysAgo(0)));
	await expect(table.getByRole("row").nth(1)).toContainText(euros(90_000));
	await expect(table.getByRole("row", { name: dayRow(daysAgo(10)) })).toContainText(euros(90_000));
	await expect(table.getByRole("row", { name: dayRow(daysAgo(11)) })).toContainText(euros(100_000));

	await toggle.click();
	await expect(table).toBeHidden();
});

test("an unknown period in the URL falls back to one month", async ({ page, api }) => {
	const account = await api.openAccount();

	await page.goto(`/comptes/${account.id}?period=decennie`);

	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
	await expect(page.getByRole("radio", { name: "1 M" })).toBeChecked();
	await expect(page.getByText(/^Solde : /u)).toContainText("sur 1 mois");
});

test("the period is kept across the pages of the transactions", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });

	await api.addDailyTransactions(account.id, 51, "Jour");

	await page.goto(`/comptes/${account.id}?period=3M`);
	const pages = page.getByRole("navigation", { name: "Pages des opérations" });

	await pages.getByRole("link", { name: "Suivant" }).click();
	await expect(pages).toContainText("Page 2 sur 2");
	await expect(page).toHaveURL(/[?&]period=3M(&|$)/u);
	await expect(page.getByRole("radio", { name: "3 M" })).toBeChecked();

	await pages.getByRole("link", { name: "Précédent" }).click();
	await expect(pages).toContainText("Page 1 sur 2");
	await expect(page).toHaveURL(/[?&]period=3M(&|$)/u);
});
