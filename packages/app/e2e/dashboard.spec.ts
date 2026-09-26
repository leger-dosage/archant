import type { Page } from "@playwright/test";

import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";

import {
	formatSignedMoney,
	formatSignedPercent,
	formatTableDate,
} from "../src/lib/balance-change.ts";
import { addMonthsTo, ofMonth } from "../src/lib/dates.ts";
import { daysAgo, euros, expect, rgb, test, uniqueName } from "./fixtures.ts";
import { ADMIN_FIRST_NAME } from "./settings.ts";

// Story 6.1: net worth and its history. One database serves the whole run,
// so totals are asserted as a change from what the API reports before.

const card = (page: Page) => page.getByRole("region", { name: "Patrimoine net" });

/** The stat block: the amount and its change. */
const headline = (page: Page) => card(page).getByRole("group", { name: "Patrimoine net" });

const total = (page: Page, label: "Actifs" | "Passifs") =>
	card(page).getByRole("group", { name: label, exact: true });

/** The 44 px bar that holds the page's `h1` and its actions. */
const titleBar = (page: Page) =>
	page.getByRole("heading", { level: 1, name: "Tableau de bord" }).locator("..");

/** `/api/accounts` answered with `groups`, as the API shapes them. */
async function mockAccounts(page: Page, groups: unknown[]) {
	await page.route("**/api/accounts", (route) =>
		route.fulfill({ json: { data: { reportingCurrency: "EUR", groups } } }),
	);
}

// Story 12.2: the greeting, the title bar action and the balance sheet.

test("the dashboard greets the administrator by first name, above one sentence", async ({
	page,
	api,
}) => {
	await api.openAccount();

	await page.goto("/");

	await expect(page.getByText(`Bonjour ${ADMIN_FIRST_NAME}`, { exact: true })).toBeVisible();
	await expect(page.getByText("Voici où en sont les finances du foyer.")).toBeVisible();
	// A paragraph: the title bar's « Tableau de bord » stays the one `h1`.
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
	await expect(page.getByRole("heading", { name: /^Bonjour/u })).toHaveCount(0);
});

test("without a first name, the greeting is « Bonjour » alone", async ({ page, api }) => {
	await api.openAccount();
	await page.route("**/api/auth/get-session*", async (route) => {
		const response = await route.fetch();
		const session = z
			.object({ user: z.object({ name: z.string() }).loose() })
			.loose()
			.parse(await response.json());

		await route.fulfill({ response, json: { ...session, user: { ...session.user, name: "  " } } });
	});

	await page.goto("/");

	await expect(page.getByText("Bonjour", { exact: true })).toBeVisible();
	await expect(page.getByText(/^Bonjour /u)).toHaveCount(0);
});

test("« Ajouter un compte » in the title bar opens the account dialog", async ({ page, api }) => {
	await api.openAccount();

	await page.goto("/");
	await titleBar(page).getByRole("button", { name: "Ajouter un compte" }).click();

	await expect(page.getByRole("dialog", { name: "Ajouter un compte" })).toBeVisible();
});

test("the net worth shows its trend arrow in the trend colour, and its value uncoloured", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(200) });
	await api.addTransaction(account.id, { date: daysAgo(3), label: "Loyer", amount: "-100,00" });
	const { change } = await api.netWorth();

	expect(change).not.toBeNull();

	await page.goto("/");

	const rising = (change?.amount ?? 0) > 0;
	const arrow = headline(page).locator(
		rising ? "svg.lucide-trending-up" : "svg.lucide-trending-down",
	);
	await expect(arrow).toBeVisible();
	await expect(arrow).toHaveCSS("color", rgb(rising ? "#27a644" : "#eb5757"));
	await expect(headline(page).locator(".amount-hero")).toHaveCSS("color", rgb("#282a30"));
	await expect(total(page, "Actifs")).toBeVisible();
	await expect(total(page, "Passifs")).toBeVisible();
	// Abbreviated labels, « 275 k€ », never an amount to the cent.
	const ticks = card(page).locator(".recharts-cartesian-axis-tick-value", { hasText: /€$/u });
	await expect(ticks.first()).toBeVisible();
	expect(await ticks.allTextContents()).not.toContainEqual(expect.stringMatching(/,\d{2}\s€$/u));
});

const bilan = (page: Page) => page.getByRole("region", { name: "Bilan" });

const sheetGroup = (page: Page, label: "Actifs" | "Passifs") =>
	bilan(page).getByRole("group", { name: label, exact: true });

const shareText = (share: number) =>
	new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 }).format(share);

const summary = (overrides: Record<string, unknown>) => ({
	id: uniqueName("id"),
	subtype: null,
	currency: "EUR",
	active: true,
	excludedFromReports: false,
	...overrides,
});

test("« Bilan » splits each group by account type, and lists its active accounts", async ({
	page,
}) => {
	await mockAccounts(page, [
		{
			classification: "asset",
			total: 10_000_000,
			excludedCount: 1,
			accounts: [
				summary({
					name: "Compte joint",
					type: "depository",
					subtype: "checking",
					balance: 2_500_000,
				}),
				summary({ name: "Maison", type: "property", subtype: "apartment", balance: 7_500_000 }),
				summary({
					name: "Compte USD",
					type: "investment",
					subtype: "pea",
					currency: "USD",
					balance: 500_000,
				}),
				summary({
					name: "Ancien livret",
					type: "depository",
					subtype: "savings",
					balance: 900_000,
					active: false,
				}),
			],
		},
		{
			classification: "liability",
			total: 4_000_000,
			excludedCount: 0,
			accounts: [
				summary({ name: "Carte Visa", type: "credit_card", balance: 1_000_000 }),
				summary({ name: "Prêt auto", type: "loan", subtype: "consumer", balance: 3_000_000 }),
			],
		},
	]);

	await page.goto("/");

	const assets = sheetGroup(page, "Actifs");
	await expect(assets).toContainText(euros(10_000_000));
	await expect(
		assets.getByRole("list", { name: "Répartition par type de compte" }).getByRole("listitem"),
	).toHaveText([`Comptes bancaires ${shareText(0.25)}`, `Bien immobilier ${shareText(0.75)}`]);
	const accountRows = assets.getByRole("list", { name: "Comptes" }).getByRole("link");
	await expect(accountRows).toHaveCount(3);
	await expect(accountRows.nth(0)).toContainText("Compte joint");
	await expect(accountRows.nth(0)).toContainText("Compte courant");
	await expect(accountRows.nth(0)).toContainText(euros(2_500_000));
	await expect(accountRows.nth(0).locator("svg.lucide-landmark")).toBeVisible();
	// Outside the shares, but listed: the net worth notice names it.
	await expect(accountRows.nth(2)).toContainText("Compte USD");
	await expect(assets).not.toContainText("Ancien livret");
	await expect(assets.locator("[data-type]")).toHaveCount(2);

	const liabilities = sheetGroup(page, "Passifs");
	await expect(
		liabilities.getByRole("list", { name: "Répartition par type de compte" }).getByRole("listitem"),
	).toHaveText([`Carte de crédit ${shareText(0.25)}`, `Prêt ${shareText(0.75)}`]);
	await expect(liabilities.getByRole("list", { name: "Comptes" }).getByRole("link")).toHaveCount(2);

	await bilan(page).getByRole("link", { name: "Tous les comptes" }).click();
	await expect(page).toHaveURL(/\/accounts$/u);
});

test("an overdrawn account alone draws no bar, and is still listed", async ({ page }) => {
	await mockAccounts(page, [
		{
			classification: "asset",
			total: -5_000,
			excludedCount: 0,
			accounts: [
				summary({
					name: "Compte à découvert",
					type: "depository",
					subtype: "checking",
					balance: -5_000,
				}),
			],
		},
		{ classification: "liability", accounts: [], total: 0, excludedCount: 0 },
	]);

	await page.goto("/");

	const assets = sheetGroup(page, "Actifs");
	await expect(assets.getByRole("link", { name: /Compte à découvert/u })).toBeVisible();
	await expect(assets.locator("[data-type]")).toHaveCount(0);
	await expect(assets.getByRole("list", { name: "Répartition par type de compte" })).toHaveCount(0);
	await expect(sheetGroup(page, "Passifs")).toHaveCount(0);
});

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

	await card(page).getByRole("button", { name: "Voir le tableau" }).click();
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
	await expect(
		sheetGroup(page, "Actifs").getByRole("link", { name: new RegExp(dollars.name, "u") }),
	).toBeVisible();
});

test("a household without accounts sees the empty state", async ({ page }) => {
	// The shared database already holds other tests' accounts; the empty state
	// is what the API's empty list looks like.
	await mockAccounts(page, [
		{ classification: "asset", accounts: [], total: 0, excludedCount: 0 },
		{ classification: "liability", accounts: [], total: 0, excludedCount: 0 },
	]);

	await page.goto("/");

	await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
	await expect(page.getByText(`Bonjour ${ADMIN_FIRST_NAME}`, { exact: true })).toBeVisible();
	await expect(page.getByText("Archant est prêt. Il ne manque que vos comptes.")).toBeVisible();
	const empty = page.getByRole("region", { name: "Aucun compte pour l'instant" });
	await expect(empty.locator('[data-slot="tinted-icon"] svg.lucide-landmark')).toBeVisible();
	await expect(
		empty.getByText("Connectez une banque ou importez un relevé pour voir votre patrimoine ici."),
	).toBeVisible();
	// The section's button is the only way forward: the title bar has none.
	await expect(page.getByRole("button", { name: "Ajouter un compte" })).toHaveCount(1);
	await expect(card(page)).toHaveCount(0);
	await expect(bilan(page)).toHaveCount(0);

	await empty.getByRole("button", { name: "Ajouter un compte" }).click();
	await expect(page.getByRole("dialog", { name: "Ajouter un compte" })).toBeVisible();
});

// Story 6.2: monthly income and expenses by category. Each test owns a month
// of 2024, which no other test writes to, so its totals are exact.

/** Opened before every month these tests use, so any day of 2024 is accepted. */
const before2024 = { openingBalance: "0", openingDate: "2023-12-01" } as const;

/** « Flux de mars 2024 » for `2024-03`. */
const heading = (month: string) => `Flux ${ofMonth(month)}`;

/** The month's flow section of a `YYYY-MM` month. */
const flows = (page: Page, month: string) => page.getByRole("region", { name: heading(month) });

/** One of the three figures: « Revenus », « Dépenses » or « Épargne du mois ». */
const cell = (page: Page, month: string, label: "Revenus" | "Dépenses" | "Épargne du mois") =>
	flows(page, month).getByRole("group", { name: label, exact: true });

/** The category rows of the side the segmented control shows. */
const rowsOf = (page: Page, month: string, side: "Revenus" | "Dépenses") =>
	flows(page, month)
		.getByRole("list", { name: `${side} par catégorie` })
		.getByRole("link");

const donut = (page: Page, month: string) =>
	flows(page, month).getByRole("img", { name: /^Répartition des /u });

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

	await expect(cell(page, "2024-03", "Revenus")).toContainText(`+${euros(20_000)}`);
	await expect(cell(page, "2024-03", "Dépenses")).toContainText(euros(-4_000));
	await expect(cell(page, "2024-03", "Épargne du mois")).toContainText(euros(16_000));
	await expect(cell(page, "2024-03", "Épargne du mois")).not.toContainText("+");

	// « Dépenses » first, then « Revenus » swaps the rows and the donut.
	const sides = flows(page, "2024-03").getByRole("radiogroup", { name: "Répartition affichée" });
	await expect(sides.getByRole("radio")).toHaveText(["Dépenses", "Revenus"]);
	await expect(sides.getByRole("radio", { name: "Dépenses" })).toBeChecked();
	await expect(rowsOf(page, "2024-03", "Dépenses")).toHaveCount(1);
	await expect(rowsOf(page, "2024-03", "Dépenses")).toContainText(groceries.name);
	// `createCategory` gives the icon `tag`: the row shows it, not the uncategorised one.
	await expect(
		rowsOf(page, "2024-03", "Dépenses").locator('[data-slot="tinted-icon"] svg.lucide-tag'),
	).toBeVisible();
	await expect(donut(page, "2024-03")).toHaveAccessibleName(
		`Répartition des dépenses de mars 2024 : ${euros(4_000)} sur 1 catégorie.`,
	);
	await expect(donut(page, "2024-03")).toContainText(euros(4_000));
	await expect(donut(page, "2024-03").locator(".recharts-pie-sector path")).toHaveAttribute(
		"fill",
		"#e99537",
	);

	await sides.getByRole("radio", { name: "Revenus" }).click();

	await expect(rowsOf(page, "2024-03", "Revenus")).toHaveCount(1);
	await expect(rowsOf(page, "2024-03", "Revenus")).toContainText("Sans catégorie");
	await expect(rowsOf(page, "2024-03", "Revenus")).toContainText(`+${euros(20_000)}`);
	await expect(rowsOf(page, "2024-03", "Dépenses")).toHaveCount(0);
	await expect(donut(page, "2024-03")).toHaveAccessibleName(
		`Répartition des revenus de mars 2024 : ${euros(20_000)} sur 1 catégorie.`,
	);
});

test("a net refund keeps its row, and draws no donut segment", async ({ page, api }) => {
	const account = await api.openAccount(before2024);
	const groceries = await api.createCategory({ name: uniqueName("Courses") });
	const clothes = await api.createCategory({ name: uniqueName("Vêtements"), color: "#4ea7fc" });
	const spent = await api.addTransaction(account.id, {
		date: "2024-08-04",
		label: "Courses",
		amount: "-40,00",
	});
	const refund = await api.addTransaction(account.id, {
		date: "2024-08-05",
		label: "Retour",
		amount: "20,00",
	});
	await api.categorise([spent], groceries.id);
	await api.categorise([refund], clothes.id);

	await page.goto("/?month=2024-08");

	const rows = rowsOf(page, "2024-08", "Dépenses");
	await expect(rows).toHaveCount(2);
	await expect(rows.filter({ hasText: clothes.name })).toContainText(`+${euros(2_000)}`);
	await expect(donut(page, "2024-08").locator(".recharts-pie-sector")).toHaveCount(1);
	await expect(donut(page, "2024-08").locator(".recharts-pie-sector path")).toHaveAttribute(
		"fill",
		"#e99537",
	);
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

	await expect(cell(page, "2024-04", "Dépenses")).toContainText(euros(-10_000));
	const rows = rowsOf(page, "2024-04", "Dépenses");
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText(parent.name);
	await expect(rows.nth(0)).toContainText("60 %");
	await expect(rows.nth(0)).toContainText(euros(-6_000));
	await expect(rows.nth(1)).toContainText("Sans catégorie");
	await expect(rows.nth(1)).toContainText("40 %");
	await expect(rows.nth(1)).toContainText(euros(-4_000));
	await expect(rows.nth(1).locator("svg.lucide-circle-dashed")).toBeVisible();
	await expect(flows(page, "2024-04")).not.toContainText(child.name);

	await rows.nth(1).click();

	await expect(page).toHaveURL(/\/transactions\?/u);
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
	await rowsOf(page, "2024-05", "Dépenses").filter({ hasText: leisure.name }).click();

	await expect(page).toHaveURL(/\/transactions\?/u);
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

	const thisMonth = flows(page, current);
	await expect(thisMonth.getByRole("heading", { name: heading(current) })).toBeVisible();
	await expect(thisMonth.getByRole("button", { name: "Mois suivant" })).toBeDisabled();
	await thisMonth.getByRole("button", { name: "Mois précédent" }).click();

	await expect(page).toHaveURL(new RegExp(`[?&]month=${previous}(&|$)`, "u"));
	const moved = flows(page, previous);
	await expect(moved.getByRole("heading", { name: heading(previous) })).toBeVisible();
	await moved.getByRole("button", { name: "Mois précédent" }).click();
	await expect(page).toHaveURL(new RegExp(`[?&]month=${addMonthsTo(previous, -1)}(&|$)`, "u"));

	const earlier = flows(page, addMonthsTo(previous, -1));
	await earlier.getByRole("button", { name: "Mois suivant" }).click();
	await expect(page).toHaveURL(new RegExp(`[?&]month=${previous}(&|$)`, "u"));
	await moved.getByRole("button", { name: "Mois suivant" }).click();
	await expect(page).not.toHaveURL(/[?&]month=/u);
	await expect(thisMonth.getByRole("heading", { name: heading(current) })).toBeVisible();

	await page.goto("/?month=2024-13");
	await expect(thisMonth.getByRole("heading", { name: heading(current) })).toBeVisible();

	await page.goto("/?month=2024-01");
	await expect(flows(page, "2024-01").getByText("Aucune opération ce mois-ci.")).toBeVisible();
});
