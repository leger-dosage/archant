import type { Page } from "@playwright/test";

import { toMinorUnits } from "@archant/data/money";

import {
	formatSignedMoney,
	formatSignedPercent,
	formatTableDate,
} from "../src/lib/balance-change.ts";
import { addMonthsTo, monthHeading } from "../src/lib/dates.ts";
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

// Story 6.2: monthly income and expenses by category. Each test owns a month
// of 2024, which no other test writes to, so its totals are exact.

/** Opened before every month these tests use, so any day of 2024 is accepted. */
const before2024 = { openingBalance: "0", openingDate: "2023-12-01" } as const;

const flows = (page: Page, heading: string) => page.getByRole("region", { name: heading });

const side = (page: Page, heading: string, label: "Revenus" | "Dépenses") =>
	flows(page, heading).getByRole("group", { name: label, exact: true });

test("« Revenus » and « Dépenses » count only the month's counted rows", async ({ page, api }) => {
	const checking = await api.openAccount(before2024);
	const livret = await api.openAccount({ ...before2024, kind: "savings" });
	const creditCard = await api.openAccount({ ...before2024, kind: "credit_card" });
	const excludedAccount = await api.openAccount(before2024);
	await api.excludeAccount(excludedAccount.id);
	const groceries = await api.createCategory({ name: uniqueName("Courses") });
	const spent = await api.addTransaction(checking.id, {
		date: "2024-03-05",
		label: "Courses",
		amount: "-40,00",
	});
	await api.categorise([spent], groceries.id);
	await api.addTransaction(checking.id, { date: "2024-03-06", label: "Prime", amount: "200,00" });
	const excluded = await api.addTransaction(checking.id, {
		date: "2024-03-07",
		label: "Exclue",
		amount: "-13,00",
	});
	await api.excludeTransaction(excluded);
	// Linked as an internal move on creation: same amount, opposite signs, a day apart.
	await api.addTransaction(checking.id, {
		date: "2024-03-10",
		label: "VIR LIVRET",
		amount: "-517,00",
	});
	await api.addTransaction(livret.id, { date: "2024-03-11", label: "VIR", amount: "517,00" });
	// Linked as « Remboursement de carte » on creation, the inflow being on a card.
	await api.addTransaction(checking.id, {
		date: "2024-03-14",
		label: "PRLV CARTE",
		amount: "-233,00",
	});
	await api.addTransaction(creditCard.id, {
		date: "2024-03-14",
		label: "PAIEMENT",
		amount: "233,00",
	});
	await api.addTransaction(excludedAccount.id, {
		date: "2024-03-12",
		label: "Ailleurs",
		amount: "-77,00",
	});

	await page.goto("/?month=2024-03");

	await expect(side(page, "Mars 2024", "Revenus")).toContainText(`+${euros(20_000)}`);
	await expect(side(page, "Mars 2024", "Dépenses")).toContainText(euros(-4_000));
	await expect(flows(page, "Mars 2024").getByRole("link")).toHaveCount(2);
});

test("a parent line rolls up its sub-category, beside « Sans catégorie »", async ({
	page,
	api,
}) => {
	const account = await api.openAccount(before2024);
	const parent = await api.createCategory({ name: uniqueName("Maison") });
	const child = await api.createCategory({ name: uniqueName("Jardin"), parentId: parent.id });
	const inParent = await api.addTransaction(account.id, {
		date: "2024-04-03",
		label: "Meuble",
		amount: "-30,00",
	});
	const inChild = await api.addTransaction(account.id, {
		date: "2024-04-04",
		label: "Graines",
		amount: "-30,00",
	});
	await api.categorise([inParent], parent.id);
	await api.categorise([inChild], child.id);
	const uncategorised = uniqueName("Divers");
	await api.addTransaction(account.id, {
		date: "2024-04-05",
		label: uncategorised,
		amount: "-40,00",
	});

	await page.goto("/?month=2024-04");

	const expenses = side(page, "Avril 2024", "Dépenses");
	await expect(expenses).toContainText(euros(-10_000));
	const rows = expenses.getByRole("link");
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText(parent.name);
	await expect(rows.nth(0)).toContainText("60 %");
	await expect(rows.nth(0)).toContainText(euros(-6_000));
	await expect(rows.nth(1)).toContainText("Sans catégorie");
	await expect(rows.nth(1)).toContainText("40 %");
	await expect(rows.nth(1)).toContainText(euros(-4_000));
	await expect(expenses).not.toContainText(child.name);

	await rows.nth(1).click();

	await expect(page).toHaveURL(/\/operations\?/u);
	await expect(page).toHaveURL(/[?&]category=[^&]*none/u);
	await expect(page).toHaveURL(/[?&]direction=[^&]*expense/u);
	await expect(page).toHaveURL(/[?&]from=2024-04-01(&|$)/u);
	await expect(page).toHaveURL(/[?&]to=2024-04-30(&|$)/u);
	await expect(page.getByText(uncategorised)).toBeVisible();
});

test("a category line opens its rows of the month in « Opérations »", async ({ page, api }) => {
	const account = await api.openAccount(before2024);
	const leisure = await api.createCategory({ name: uniqueName("Loisirs") });
	const cinema = await api.createCategory({ name: uniqueName("Cinéma") });
	const label = uniqueName("Cinéma");
	const id = await api.addTransaction(account.id, { date: "2024-05-17", label, amount: "-25,00" });
	await api.categorise([id], leisure.id);
	await api.addTransaction(account.id, {
		date: "2024-05-18",
		label: uniqueName("Autre"),
		amount: "-9,00",
	});

	await page.goto("/?month=2024-05");
	await side(page, "Mai 2024", "Dépenses").getByRole("link", { name: leisure.name }).click();

	await expect(page).toHaveURL(/\/operations\?/u);
	await expect(page).toHaveURL(new RegExp(leisure.id, "u"));
	await expect(page).toHaveURL(/[?&]from=2024-05-01(&|$)/u);
	await expect(page).toHaveURL(/[?&]to=2024-05-31(&|$)/u);
	await expect(page.getByText(label)).toBeVisible();
	await expect(page.getByText(/^Autre /u)).toHaveCount(0);

	// The dashboard's cash flow is cached under `transactions.all` too: the
	// row's optimistic update must leave it alone.
	const row = page.getByRole("main").getByRole("listitem").filter({ hasText: label });
	await row.getByRole("button", { name: `Catégorie : ${leisure.name}`, exact: true }).click();
	await page.getByRole("combobox", { name: "Rechercher une catégorie" }).fill(cinema.name);
	await page.keyboard.press("Enter");

	await expect(
		page.locator("[data-sonner-toast]").filter({ hasText: "Catégorie modifiée" }),
	).toBeVisible();
	await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
	// Now in another category, the row leaves the list filtered on the first.
	await expect(row).toHaveCount(0);
});

test("« Mois précédent » moves the month in the URL and the heading", async ({ page, api }) => {
	await api.openAccount();
	const current = daysAgo(0).slice(0, 7);
	const previous = addMonthsTo(current, -1);

	await page.goto("/");

	const thisMonth = flows(page, "Ce mois-ci");
	await expect(thisMonth.getByRole("button", { name: "Mois suivant" })).toBeDisabled();
	await thisMonth.getByRole("button", { name: "Mois précédent" }).click();

	await expect(page).toHaveURL(new RegExp(`[?&]month=${previous}(&|$)`, "u"));
	const moved = flows(page, monthHeading(previous));
	await expect(moved.getByRole("heading", { name: monthHeading(previous) })).toBeVisible();
	await moved.getByRole("button", { name: "Mois précédent" }).click();
	await expect(page).toHaveURL(new RegExp(`[?&]month=${addMonthsTo(previous, -1)}(&|$)`, "u"));

	const earlier = flows(page, monthHeading(addMonthsTo(previous, -1)));
	await earlier.getByRole("button", { name: "Mois suivant" }).click();
	await expect(page).toHaveURL(new RegExp(`[?&]month=${previous}(&|$)`, "u"));
	await moved.getByRole("button", { name: "Mois suivant" }).click();
	await expect(page).not.toHaveURL(/[?&]month=/u);
	await expect(thisMonth.getByRole("heading", { name: "Ce mois-ci" })).toBeVisible();

	await page.goto("/?month=2024-13");
	await expect(thisMonth.getByRole("heading", { name: "Ce mois-ci" })).toBeVisible();

	await page.goto("/?month=2024-01");
	await expect(flows(page, "Janvier 2024").getByText("Aucune opération ce mois-ci.")).toBeVisible();
});
