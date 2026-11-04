import type { Page } from "@playwright/test";

import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";

import {
	formatSignedMoney,
	formatShortDate,
	formatSignedPercent,
	formatTableDate,
	formatTick,
} from "../src/lib/balance-change.ts";
import { ofMonth } from "../src/lib/dates.ts";
import {
	daysAgo,
	euros,
	expect,
	periodPicker,
	pickPeriod,
	rgb,
	test,
	uniqueName,
} from "./fixtures.ts";
import { ADMIN_FIRST_NAME } from "./settings.ts";

// Story 6.1: net worth and its history. One database serves the whole run,
// so totals are asserted as a change from what the API reports before.

const card = (page: Page) => page.getByRole("region", { name: "Patrimoine net" });

/** The stat block: the amount and its change. */
const headline = (page: Page) => card(page).getByRole("group", { name: "Patrimoine net" });

const total = (page: Page, label: "Actifs" | "Passifs") =>
	card(page).getByRole("group", { name: label, exact: true });

/** The page header that holds the page's `h1` and its actions. */
const pageHeader = (page: Page) =>
	page.getByRole("heading", { level: 1, name: `Bonjour ${ADMIN_FIRST_NAME}` }).locator("..");

/** `/api/accounts` answered with `groups`, as the API shapes them. */
async function mockAccounts(page: Page, groups: unknown[]) {
	await page.route("**/api/accounts", (route) =>
		route.fulfill({ json: { data: { reportingCurrency: "EUR", defaultAccountId: null, groups } } }),
	);
}

// Story 12.2: the greeting, the page header's action and the balance sheet.

test("the dashboard greets the administrator by first name, above one sentence", async ({
	page,
	api,
}) => {
	await api.openAccount();

	await page.goto("/");

	// As in Sure, the greeting is the page's one `h1`, its sentence under it;
	// the breadcrumb « Accueil » says where the page is.
	await expect(pageHeader(page).getByText("Voici où en sont les finances du foyer.")).toBeVisible();
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
	await expect(page.getByRole("heading", { name: "Tableau de bord" })).toHaveCount(0);
	await expect(page.getByRole("navigation", { name: "Fil d'Ariane" })).toHaveText("Accueil");
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

	await expect(page.getByRole("heading", { level: 1, name: "Bonjour", exact: true })).toBeVisible();
	await expect(page.getByText(/^Bonjour /u)).toHaveCount(0);
});

test("« Ajouter un compte » in the page header opens the account dialog", async ({ page, api }) => {
	await api.openAccount();

	await page.goto("/");
	await pageHeader(page).getByRole("button", { name: "Ajouter un compte" }).click();

	await expect(page.getByRole("dialog", { name: "Que voulez-vous ajouter ?" })).toBeVisible();
});

test("the net worth shows its trend arrow in the trend colour, and its value uncoloured", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(200) });
	await api.addTransaction(account.id, { date: daysAgo(3), label: "Loyer", amount: "-100,00" });
	const { change, points } = await api.netWorth();

	expect(change).not.toBeNull();

	await page.goto("/");

	const rising = (change?.amount ?? 0) > 0;
	const arrow = headline(page).locator(
		rising ? "svg.lucide-trending-up" : "svg.lucide-trending-down",
	);
	await expect(arrow).toBeVisible();
	await expect(arrow).toHaveCSS("color", rgb(rising ? "#27a644" : "#eb5757"));
	await expect(headline(page).locator(".amount-hero")).toHaveCSS("color", rgb("#282a30"));
	await expect(headline(page).locator(".amount-hero")).toHaveCSS("font-size", "30px");
	await expect(card(page).locator('[data-slot="chart"]')).toHaveCSS("height", "208px");
	await expect(total(page, "Actifs")).toBeVisible();
	await expect(total(page, "Passifs")).toBeVisible();
	// Sure's axes: no vertical label and no grid, the first and last dates
	// only, each inside its edge of the chart.
	const chart = card(page).locator('[data-slot="chart"]');
	await expect(chart.locator(".recharts-yAxis")).toHaveCount(0);
	await expect(chart.getByText(/€$/u)).toHaveCount(0);
	await expect(chart.locator(".recharts-cartesian-grid")).toHaveCount(0);
	const dates = chart.locator('[data-slot="axis-date"]');
	await expect(dates).toHaveText([
		formatShortDate(points[0]!.date),
		formatShortDate(points.at(-1)!.date),
	]);
	const plot = (await chart.locator(".recharts-surface").boundingBox())!;
	const first = (await dates.first().boundingBox())!;
	const last = (await dates.last().boundingBox())!;
	expect(first.x).toBeGreaterThanOrEqual(plot.x - 0.5);
	expect(last.x + last.width).toBeLessThanOrEqual(plot.x + plot.width + 0.5);
});

const bilan = (page: Page) => page.getByRole("region", { name: "Bilan" });

const sheetGroup = (page: Page, label: "Actifs" | "Passif") =>
	bilan(page).getByRole("group", { name: label, exact: true });

/** A type's row: its `summary` opens and closes it. */
const typeRow = (scope: ReturnType<Page["getByRole"]>, name: string) =>
	scope.locator("summary", { hasText: name });

/** A weight as Sure's `number_to_percentage(precision: 0)` reads it. */
const shareText = (share: number) =>
	new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 }).format(share);

/** An amount in whole euros, as Sure's `precision: 0`. */
const wholeEuros = (amount: number) =>
	new Intl.NumberFormat("fr-FR", {
		style: "currency",
		currency: "EUR",
		maximumFractionDigits: 0,
	}).format(amount / 100);

const summary = (overrides: Record<string, unknown>) => ({
	id: uniqueName("id"),
	subtype: null,
	currency: "EUR",
	active: true,
	excludedFromReports: false,
	...overrides,
});

test("« Bilan » groups each side by account type, each row opening on its accounts", async ({
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
					balance: 2_500_049,
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
				summary({ name: "Prêt auto", type: "loan", subtype: "auto", balance: 3_000_000 }),
			],
		},
	]);

	await page.goto("/");

	const assets = sheetGroup(page, "Actifs");
	await expect(assets.getByRole("heading", { level: 3 })).toContainText(wholeEuros(10_000_000));
	await expect(
		assets.getByRole("list", { name: "Répartition par type de compte" }).getByRole("listitem"),
	).toHaveText([`Comptes bancaires ${shareText(0.25)}`, `Bien immobilier ${shareText(0.75)}`]);
	await expect(assets.locator("[data-type]")).toHaveCount(2);
	await expect(assets.locator("[data-type]").first()).toHaveCSS("height", "6px");
	await Promise.all(
		["Nom", "Poids", "Valeur"].map((column) =>
			expect(assets.getByText(column, { exact: true })).toHaveCSS("text-transform", "uppercase"),
		),
	);

	// One closed row per type, in Sure's order, the inactive account left out.
	const rows = assets.locator("summary");
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toContainText("Comptes bancaires");
	await expect(rows.nth(0)).toContainText(shareText(0.25));
	// Whole units, rounded half up: 25 000,49 € reads 25 000 €.
	await expect(rows.nth(0)).toContainText(wholeEuros(2_500_000));
	await expect(rows.nth(1)).toContainText("Investissement");
	await expect(rows.nth(2)).toContainText("Bien immobilier");
	await expect(rows.nth(2)).toContainText(shareText(0.75));
	await expect(assets.getByRole("link", { name: "Compte joint" })).toBeHidden();
	await expect(assets).not.toContainText("Ancien livret");

	// Sure's five bars: 25 % lights two, the other three at 20 % opacity.
	const bars = rows.nth(0).locator('[data-slot="weight-bar"]');
	await expect(bars).toHaveCount(5);
	await Promise.all(
		["1", "1", "0.2", "0.2", "0.2"].map((opacity, index) =>
			expect(bars.nth(index)).toHaveCSS("opacity", opacity),
		),
	);

	await rows.nth(0).click();
	const checking = assets.getByRole("list", { name: "Comptes bancaires" }).getByRole("listitem");
	await expect(checking).toHaveCount(1);
	await expect(checking.getByRole("link", { name: "Compte joint" })).toBeVisible();
	await expect(checking).toContainText(shareText(0.25));
	await expect(checking).toContainText(wholeEuros(2_500_000));
	await expect(checking.locator("svg.lucide-landmark")).toBeVisible();

	// A foreign account is listed with its own balance, and no weight.
	await rows.nth(1).click();
	const dollars = assets.getByRole("list", { name: "Investissement" }).getByRole("listitem");
	await expect(dollars.getByRole("link", { name: "Compte USD" })).toBeVisible();
	await expect(dollars).toContainText(
		new Intl.NumberFormat("fr-FR", {
			style: "currency",
			currency: "USD",
			maximumFractionDigits: 0,
		}).format(5_000),
	);
	await expect(dollars.locator('[data-slot="weight-bar"]')).toHaveCount(0);

	const liabilities = sheetGroup(page, "Passif");
	await expect(
		liabilities.getByRole("list", { name: "Répartition par type de compte" }).getByRole("listitem"),
	).toHaveText([`Carte de crédit ${shareText(0.25)}`, `Prêt ${shareText(0.75)}`]);
	await expect(liabilities.locator("summary")).toHaveCount(2);

	await checking.getByRole("link", { name: "Compte joint" }).click();
	await expect(page).toHaveURL(/\/accounts\/[^/]+$/u);
});

test("« Tout développer » opens every type, then « Tout réduire » closes them", async ({
	page,
}) => {
	await mockAccounts(page, [
		{
			classification: "asset",
			total: 2_000_000,
			excludedCount: 0,
			accounts: [
				summary({ name: "Livret", type: "depository", balance: 500_000 }),
				summary({ name: "Voiture", type: "vehicle", balance: 1_500_000 }),
			],
		},
		{
			classification: "liability",
			total: 200_000,
			excludedCount: 0,
			accounts: [summary({ name: "Prêt auto", type: "loan", subtype: "auto", balance: 200_000 })],
		},
	]);

	await page.goto("/");

	// A closed row's accounts are out of the accessibility tree.
	const links = bilan(page).getByRole("link", { name: /^(Livret|Voiture|Prêt auto)$/u });
	await expect(links).toHaveCount(0);

	await bilan(page).getByRole("button", { name: "Tout développer" }).click();
	await expect(links).toHaveText(["Livret", "Voiture", "Prêt auto"]);
	const collapse = bilan(page).getByRole("button", { name: "Tout réduire" });
	await expect(collapse).toHaveAttribute("aria-expanded", "true");

	// Closing one row by hand: every row is no longer open.
	await typeRow(sheetGroup(page, "Actifs"), "Véhicule").click();
	await expect(bilan(page).getByRole("link", { name: "Voiture" })).toBeHidden();
	await expect(bilan(page).getByRole("button", { name: "Tout développer" })).toBeVisible();

	await bilan(page).getByRole("button", { name: "Tout développer" }).click();
	await collapse.click();
	await expect(links).toHaveCount(0);
	await expect(bilan(page).getByRole("button", { name: "Tout développer" })).toBeVisible();

	await bilan(page).getByRole("link", { name: "Tous les comptes" }).click();
	await expect(page).toHaveURL(/\/accounts$/u);
});

test("an excluded account is weighed over its side's total, muted, and left out of its type's", async ({
	page,
}) => {
	await mockAccounts(page, [
		{
			classification: "asset",
			total: 1_000_000,
			excludedCount: 1,
			accounts: [
				summary({ name: "Livret", type: "depository", balance: 1_000_000 }),
				summary({
					name: "Vieille voiture",
					type: "vehicle",
					balance: 800_000,
					excludedFromReports: true,
				}),
			],
		},
		{ classification: "liability", accounts: [], total: 0, excludedCount: 0 },
	]);

	await page.goto("/");

	const assets = sheetGroup(page, "Actifs");
	const vehicle = typeRow(assets, "Véhicule");
	await expect(vehicle).toContainText(shareText(0));
	await expect(vehicle).toContainText(wholeEuros(0));

	await vehicle.click();
	const row = assets.getByRole("list", { name: "Véhicule" }).getByRole("listitem");
	await expect(row.getByRole("link", { name: "Vieille voiture" })).toBeVisible();
	await expect(row).toContainText(shareText(0.8));
	await expect(row.locator("svg.lucide-eye-off")).toBeVisible();
	await expect(row.getByText(wholeEuros(800_000))).toHaveCSS("color", rgb("#6c6b73"));
});

test("« Bilan » lists an other asset after the vehicles and an other liability after the loans, in Sure's colours", async ({
	page,
}) => {
	await mockAccounts(page, [
		{
			classification: "asset",
			total: 2_000_000,
			excludedCount: 0,
			accounts: [
				summary({ name: "Bijoux", type: "other_asset", balance: 500_000 }),
				summary({ name: "Voiture", type: "vehicle", balance: 1_500_000 }),
			],
		},
		{
			classification: "liability",
			total: 400_000,
			excludedCount: 0,
			accounts: [
				summary({ name: "Prêt de Marie", type: "other_liability", balance: 200_000 }),
				summary({ name: "Prêt auto", type: "loan", subtype: "auto", balance: 200_000 }),
			],
		},
	]);

	await page.goto("/");

	const assets = sheetGroup(page, "Actifs");
	await expect(
		assets.getByRole("list", { name: "Répartition par type de compte" }).getByRole("listitem"),
	).toHaveText([`Véhicule ${shareText(0.75)}`, `Autres actifs ${shareText(0.25)}`]);
	await expect(assets.locator("summary")).toHaveText([/^Véhicule/u, /^Autres actifs/u]);
	await expect(assets.locator('[data-type="other_asset"]')).toHaveCSS(
		"background-color",
		rgb("#27a644"),
	);

	await bilan(page).getByRole("button", { name: "Tout développer" }).click();
	await expect(
		assets.getByRole("listitem").filter({ hasText: "Bijoux" }).locator("svg.lucide-plus"),
	).toBeVisible();

	const liabilities = sheetGroup(page, "Passif");
	await expect(
		liabilities.getByRole("list", { name: "Répartition par type de compte" }).getByRole("listitem"),
	).toHaveText([`Prêt ${shareText(0.5)}`, `Autres passifs ${shareText(0.5)}`]);
	await expect(liabilities.locator("summary")).toHaveText([/^Prêt/u, /^Autres passifs/u]);
	await expect(liabilities.locator('[data-type="other_liability"]')).toHaveCSS(
		"background-color",
		rgb("#737373"),
	);
	await expect(
		liabilities
			.getByRole("listitem")
			.filter({ hasText: "Prêt de Marie" })
			.locator("svg.lucide-minus"),
	).toBeVisible();
});

test("an overdrawn account alone draws no bar, and an empty side says so", async ({ page }) => {
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
	await expect(assets.locator("[data-type]")).toHaveCount(0);
	await expect(assets.getByRole("list", { name: "Répartition par type de compte" })).toHaveCount(0);
	await typeRow(assets, "Comptes bancaires").click();
	await expect(assets.getByRole("link", { name: "Compte à découvert" })).toBeVisible();

	const liabilities = sheetGroup(page, "Passif");
	await expect(liabilities).toContainText("Pas encore de passif");
	await expect(liabilities).toContainText(
		"Ajoutez vos comptes de passif pour voir une répartition complète",
	);
	await expect(liabilities.locator("svg.lucide-minus")).toBeVisible();
	await expect(liabilities.locator("summary")).toHaveCount(0);
});

test("a side without an active account says so, beside a side with rows", async ({ page }) => {
	await mockAccounts(page, [
		{
			classification: "asset",
			total: 0,
			excludedCount: 0,
			accounts: [summary({ name: "Ancien livret", type: "depository", balance: 0, active: false })],
		},
		{
			classification: "liability",
			total: 100_000,
			excludedCount: 0,
			accounts: [summary({ name: "Carte Visa", type: "credit_card", balance: 100_000 })],
		},
	]);

	await page.goto("/");

	const assets = sheetGroup(page, "Actifs");
	await expect(assets).toContainText("Aucun actif pour l'instant");
	await expect(assets).toContainText(
		"Ajoutez vos comptes d'actifs pour voir une répartition complète",
	);
	await expect(assets.locator("svg.lucide-plus")).toBeVisible();
	await expect(bilan(page).getByRole("button", { name: "Tout développer" })).toBeVisible();
});

test("a checking account and a card move net worth, assets and liabilities", async ({
	page,
	api,
}) => {
	const before = await api.netWorth();
	await api.openAccount({ openingBalance: "1 000,00" });
	await api.openAccount({ kind: "credit_card", openingBalance: "300,00" });

	await page.goto("/");

	await expect(pageHeader(page)).toBeVisible();
	await expect(headline(page)).toContainText(euros(before.netWorth + 70_000));
	await expect(total(page, "Actifs")).toContainText(euros(before.assets + 100_000));
	await expect(total(page, "Passifs")).toContainText(euros(before.liabilities + 30_000));
});

// Story 34.3: Sure's `UI::PeriodPicker`, one menu above the widgets.
test("the picker lists Sure's twelve periods in order, « 30J » checked, above the widgets", async ({
	page,
	api,
}) => {
	await api.openAccount();

	await page.goto("/");

	const trigger = periodPicker(page);
	await expect(trigger).toHaveText("30J");
	await expect(card(page).getByRole("button", { name: /^Période : /u })).toHaveCount(0);
	await trigger.click();
	await expect(page.getByRole("menuitemradio")).toHaveText([
		"1J",
		"SC",
		"7J",
		"MC",
		"LM",
		"30J",
		"90J",
		"AC",
		"365J",
		"5A",
		"10A",
		"Tout",
	]);
	await expect(page.getByRole("menuitemradio", { name: "30J" })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await page.keyboard.press("Escape");
	await expect(headline(page)).toContainText("vs. 30 derniers jours");
});

test("« 90J » goes to the URL and is saved for the next visit, the summary and table following it", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(200) });
	await api.addTransaction(account.id, { date: daysAgo(10), label: "Loyer", amount: "-100,00" });
	const expected = await api.netWorth("last_90_days");
	const last = expected.points.at(-1);
	const change = expected.change;

	expect(last?.date).toBe(daysAgo(0));
	expect(change?.percent).not.toBeNull();

	try {
		await page.goto("/");
		await pickPeriod(page, page, "90J");

		await expect(page).toHaveURL(/[?&]period=last_90_days(&|$)/u);
		await expect(periodPicker(page)).toHaveAccessibleName("Période : 90J");
		const amount = formatSignedMoney(toMinorUnits(change?.amount ?? 0), "EUR");
		const percent = formatSignedPercent(change?.percent ?? 0);
		await expect(card(page).getByText(/^Patrimoine net : /u)).toHaveText(
			`Patrimoine net : ${euros(last?.balance ?? 0)}, ${amount} (${percent}) vs. dernier trimestre.`,
		);
		await expect(headline(page)).toContainText(`${amount} (${percent}) vs. dernier trimestre`);

		const showTable = card(page).getByRole("button", { name: "Voir le tableau" });
		await showTable.click();
		const table = card(page).getByRole("table");
		const tableId = await showTable.getAttribute("aria-controls");
		await expect(card(page).locator(`[id="${tableId}"]`)).toHaveCSS("height", "208px");
		await expect(table.getByRole("columnheader")).toHaveText(["Date", "Patrimoine net"]);
		await expect(table.getByRole("row")).toHaveCount(expected.points.length + 1);
		await expect(table.getByRole("row").nth(1)).toContainText(formatTableDate(daysAgo(0)));
		await expect(table.getByRole("row").nth(1)).toContainText(euros(last?.balance ?? 0));

		// Sure's `default_period`: the dashboard opens on it without the URL.
		await page.goto("/");
		await expect(periodPicker(page)).toHaveText("90J");
		await expect(headline(page)).toContainText("vs. dernier trimestre");
	} finally {
		await api.setDefaultPeriod("last_30_days");
	}
});

test("a drag across the chart picks a custom range, named on the trigger and checked last", async ({
	page,
	api,
}) => {
	await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(60) });

	await page.goto("/");
	const chart = card(page).locator('[data-slot="chart"]');
	await expect(chart.locator(".recharts-area")).toBeVisible();
	const box = await chart.boundingBox();

	expect(box).not.toBeNull();
	const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
	await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.2, y);
	await page.mouse.down();
	await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.8, y, { steps: 8 });
	await page.mouse.up();

	await expect(page).toHaveURL(/[?&]startDate=\d{4}-\d{2}-\d{2}&endDate=\d{4}-\d{2}-\d{2}/u);
	await expect(page).not.toHaveURL(/[?&]period=/u);
	const url = new URL(page.url());
	const start = url.searchParams.get("startDate") ?? "";
	const end = url.searchParams.get("endDate") ?? "";
	expect(start < end).toBe(true);
	// Sure's `label_range`: the year dropped while both days sit in this one.
	const year = daysAgo(0).slice(0, 4);
	const short = (iso: string) =>
		start.startsWith(year) && end.startsWith(year) ? formatTick(iso, false) : formatShortDate(iso);
	await expect(periodPicker(page)).toHaveText(`${short(start)} – ${short(end)}`);
	await expect(headline(page)).toContainText(
		`${formatShortDate(start)} au ${formatShortDate(end)}`,
	);

	await periodPicker(page).click();
	await expect(page.getByRole("menuitemradio").last()).toHaveText("Personnalisé");
	await expect(page.getByRole("menuitemradio").last()).toHaveAttribute("aria-checked", "true");
	await page.keyboard.press("Escape");

	// A preset leaves the custom range, the dates out of the URL.
	try {
		await pickPeriod(page, page, "7J");
		await expect(page).toHaveURL(/[?&]period=last_7_days(&|$)/u);
		await expect(page).not.toHaveURL(/startDate=/u);
	} finally {
		await api.setDefaultPeriod("last_30_days");
	}
});

test("an unknown period in the URL falls back to the saved one", async ({ page, api }) => {
	await api.openAccount();

	try {
		await api.setDefaultPeriod("last_90_days");
		await page.goto("/?period=decennie");

		await expect(pageHeader(page)).toBeVisible();
		await expect(periodPicker(page)).toHaveText("90J");
		await expect(headline(page)).toContainText("vs. dernier trimestre");
	} finally {
		await api.setDefaultPeriod("last_30_days");
	}
});

test("a failed save says so, and the pick still applies through the URL", async ({ page, api }) => {
	await api.openAccount();
	await page.route("**/api/preferences", (route) =>
		route.request().method() === "PATCH"
			? route.fulfill({
					status: 500,
					json: { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
				})
			: route.fallback(),
	);

	try {
		await page.goto("/");
		await pickPeriod(page, page, "90J");

		await expect(page.getByText("Une erreur inattendue s'est produite.")).toBeVisible();
		await expect(page).toHaveURL(/[?&]period=last_90_days(&|$)/u);
		await expect(periodPicker(page)).toHaveText("90J");
	} finally {
		await page.unrouteAll();
		await api.setDefaultPeriod("last_30_days");
	}
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
	await typeRow(sheetGroup(page, "Actifs"), "Comptes bancaires").click();
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

	await expect(
		pageHeader(page).getByText("Archant est prêt. Il ne manque que vos comptes."),
	).toBeVisible();
	const empty = page.getByRole("region", { name: "Aucun compte pour l'instant" });
	await expect(empty.locator('[data-slot="tinted-icon"] svg.lucide-landmark')).toBeVisible();
	await expect(
		empty.getByText("Connectez une banque ou importez un relevé pour voir votre patrimoine ici."),
	).toBeVisible();
	// The section's button is the page's only way forward: the header has none.
	await expect(
		page.getByRole("main").getByRole("button", { name: "Ajouter un compte" }),
	).toHaveCount(1);
	await expect(card(page)).toHaveCount(0);
	await expect(bilan(page)).toHaveCount(0);

	await empty.getByRole("button", { name: "Ajouter un compte" }).click();
	await expect(page.getByRole("dialog", { name: "Que voulez-vous ajouter ?" })).toBeVisible();
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
	// Linked as « Paiement » on creation, the inflow being on a card.
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
	await expect(cell(page, "2024-03", "Revenus").locator(".amount-summary")).toHaveCSS(
		"font-size",
		"20px",
	);

	// « Dépenses » first, then « Revenus » swaps the rows and the donut.
	const sides = flows(page, "2024-03").getByRole("radiogroup", { name: "Répartition affichée" });
	await expect(sides.getByRole("radio")).toHaveText(["Dépenses", "Revenus"]);
	await expect(sides.getByRole("radio", { name: "Dépenses" })).toBeChecked();
	await expect(rowsOf(page, "2024-03", "Dépenses")).toHaveCount(1);
	await expect(rowsOf(page, "2024-03", "Dépenses")).toContainText(groceries.name);
	const categories = flows(page, "2024-03").getByRole("region", { name: "Dépenses par catégorie" });
	await expect(categories).toHaveCSS("background-color", rgb("#f2f2f3"));
	await expect(categories.getByRole("heading", { name: "Dépenses par catégorie" })).toHaveCSS(
		"text-transform",
		"uppercase",
	);
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

test("a category refunded beyond what it spent moves to « Revenus », where it drew no segment under « Dépenses »", async ({
	page,
	api,
}) => {
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
	await expect(rows).toHaveCount(1);
	await expect(rows).toContainText(groceries.name);
	await expect(donut(page, "2024-08").locator(".recharts-pie-sector")).toHaveCount(1);
	await expect(donut(page, "2024-08").locator(".recharts-pie-sector path")).toHaveAttribute(
		"fill",
		"#e99537",
	);

	await flows(page, "2024-08").getByRole("radio", { name: "Revenus" }).click();

	await expect(rowsOf(page, "2024-08", "Revenus")).toHaveCount(1);
	await expect(rowsOf(page, "2024-08", "Revenus")).toContainText(clothes.name);
	await expect(rowsOf(page, "2024-08", "Revenus")).toContainText(`+${euros(2_000)}`);
	await expect(donut(page, "2024-08").locator(".recharts-pie-sector path")).toHaveAttribute(
		"fill",
		"#4ea7fc",
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
	// The net line holds both signs: its list keeps them both.
	await expect(page).not.toHaveURL(/[?&]direction=/u);
	await expect(page).toHaveURL(/[?&]from=2024-04-01(&|$)/u);
	await expect(page).toHaveURL(/[?&]to=2024-04-30(&|$)/u);
	await expect(page.getByText(uncategorised)).toBeVisible();
});

const tradesBody = z.object({
	data: z.object({
		items: z.array(z.object({ security: z.object({ id: z.string() }).nullable() })),
	}),
});

test("« Revenus », « Dépenses » and each line read Sure's net view: a refund, a category's net income, a loan payment, and no dividend nor PEA line", async ({
	page,
	api,
	request,
}) => {
	// July 2022 belongs to this test alone, so its figures are exact.
	const opened = { openingBalance: "0", openingDate: "2022-06-01" } as const;
	const checking = await api.openAccount(opened);
	const pea = await api.openAccount({ ...opened, kind: "pea", openingBalance: "5 000,00" });
	const loan = await api.openAccount({ ...opened, kind: "mortgage", openingBalance: "90 000,00" });
	const groceries = await api.createCategory({ name: uniqueName("Courses") });
	const gifts = await api.createCategory({ name: uniqueName("Cadeaux"), color: "#4ea7fc" });
	const lines = [
		{ label: "Courses", amount: "-100,00", categoryId: groceries.id },
		{ label: "Retour courses", amount: "30,00", categoryId: groceries.id },
		{ label: "Cadeau offert", amount: "-20,00", categoryId: gifts.id },
		{ label: "Cadeau reçu", amount: "50,00", categoryId: gifts.id },
	];
	await lines.reduce(async (previous, { label, amount, categoryId }, index) => {
		await previous;
		const id = await api.addTransaction(checking.id, {
			date: `2022-07-0${index + 1}`,
			label,
			amount,
		});
		await api.categorise([id], categoryId);
	}, Promise.resolve());
	const instalment = await api.addTransaction(checking.id, {
		date: "2022-07-10",
		label: "Échéance prêt",
		amount: "-500,00",
	});
	const repaid = await api.addTransaction(loan.id, {
		date: "2022-07-10",
		label: "Remboursement",
		amount: "500,00",
	});
	// Proposed on creation; refused and matched again as « Rapprocher » would.
	await api.unlinkTransfer(instalment, { never: true });
	await api.matchTransfer(instalment, repaid);
	await api.recordTrade(pea.id, {
		security: { source: "manual", name: uniqueName("Fonds") },
		date: "2022-07-11",
		quantity: "10",
		price: "100",
	});
	const listed = await request.get(`/api/accounts/${pea.id}/trades`);
	const securityId = tradesBody.parse(await listed.json()).data.items[0]?.security?.id ?? "";
	await api.recordTrade(pea.id, {
		side: "dividend",
		security: { source: "known", id: securityId },
		date: "2022-07-15",
		amount: "12,00",
	});
	await api.addTransaction(pea.id, { date: "2022-07-16", label: "Frais", amount: "-15,00" });

	await page.goto("/?month=2022-07");

	// Before Story 27.6: +12,00 € in, the dividend, and −555,00 € out:
	// « Courses » −70,00 €, « Cadeaux » +30,00 € under « Dépenses » by its
	// kind, the loan payment −500,00 € and the PEA's fee −15,00 €.
	await expect(cell(page, "2022-07", "Revenus")).toContainText(`+${euros(3_000)}`);
	await expect(cell(page, "2022-07", "Dépenses")).toContainText(euros(-57_000));
	const spent = rowsOf(page, "2022-07", "Dépenses");
	await expect(spent).toHaveCount(2);
	await expect(spent.nth(0)).toContainText("Sans catégorie");
	await expect(spent.nth(0)).toContainText(euros(-50_000));
	await expect(spent.nth(1)).toContainText(groceries.name);
	await expect(spent.nth(1)).toContainText(euros(-7_000));

	await flows(page, "2022-07").getByRole("radio", { name: "Revenus" }).click();

	const earned = rowsOf(page, "2022-07", "Revenus");
	await expect(earned).toHaveCount(1);
	await expect(earned).toContainText(gifts.name);
	await expect(earned).toContainText(`+${euros(3_000)}`);
});

test("a transaction marked one-time in the sheet leaves « Dépenses », and the list keeps it with Sure's asterisk", async ({
	page,
	api,
}) => {
	// September 2022 belongs to this test alone.
	const account = await api.openAccount({ openingBalance: "0", openingDate: "2022-08-15" });
	const label = uniqueName("Électroménager");
	await api.addTransaction(account.id, { date: "2022-09-05", label, amount: "-900,00" });
	await api.addTransaction(account.id, { date: "2022-09-06", label: "Courses", amount: "-40,00" });

	await page.goto("/?month=2022-09");
	await expect(cell(page, "2022-09", "Dépenses")).toContainText(euros(-94_000));

	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	const listed = page.getByRole("main").getByRole("button", { name: new RegExp(label, "u") });
	await listed.click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	const oneTime = sheet.getByRole("switch", { name: "Transaction ponctuelle (Dépense)" });
	await expect(oneTime).not.toBeChecked();
	await expect(oneTime).toHaveAccessibleDescription(
		"Les transactions ponctuelles seront exclues de certains calculs budgétaires et rapports afin de vous aider à voir ce qui compte vraiment.",
	);
	await oneTime.click();
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(listed).toHaveAccessibleName(/Dépense ponctuelle \(exclue des moyennes\)/u);
	await expect(listed).toContainText(euros(-90_000));

	await page.goto("/?month=2022-09");
	await expect(cell(page, "2022-09", "Dépenses")).toContainText(euros(-4_000));
});

test("a month of a PEA's lines and a dividend alone shows no income and no expense", async ({
	page,
	api,
	request,
}) => {
	// August 2022 belongs to this test alone.
	const pea = await api.openAccount({
		kind: "pea",
		openingBalance: "5 000,00",
		openingDate: "2022-07-01",
	});
	await api.recordTrade(pea.id, {
		security: { source: "manual", name: uniqueName("Fonds") },
		date: "2022-07-20",
		quantity: "10",
		price: "100",
	});
	const listed = await request.get(`/api/accounts/${pea.id}/trades`);
	const securityId = tradesBody.parse(await listed.json()).data.items[0]?.security?.id ?? "";
	await api.recordTrade(pea.id, {
		side: "dividend",
		security: { source: "known", id: securityId },
		date: "2022-08-15",
		amount: "12,00",
	});
	await api.addTransaction(pea.id, { date: "2022-08-16", label: "Frais", amount: "-15,00" });
	await api.addTransaction(pea.id, { date: "2022-08-17", label: "Crédit", amount: "40,00" });

	await page.goto("/?month=2022-08");

	await expect(cell(page, "2022-08", "Revenus")).toContainText(euros(0));
	await expect(cell(page, "2022-08", "Revenus")).not.toContainText(euros(1_200));
	await expect(cell(page, "2022-08", "Revenus")).not.toContainText(euros(4_000));
	await expect(cell(page, "2022-08", "Dépenses")).toContainText(euros(0));
	await expect(cell(page, "2022-08", "Dépenses")).not.toContainText(euros(1_500));
	await expect(rowsOf(page, "2022-08", "Dépenses")).toHaveCount(0);
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
	// Within the page: the accounts column captions an other asset « Autre actif ».
	await expect(page.getByRole("main").getByText(/^Autre /u)).toHaveCount(0);

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
	const previous = shiftMonth(current, -1);
	await page.goto("/");

	const thisMonth = flows(page, current);
	await expect(thisMonth.getByRole("heading", { name: heading(current) })).toBeVisible();
	await expect(thisMonth.getByRole("button", { name: "Mois suivant" })).toBeDisabled();
	await thisMonth.getByRole("button", { name: "Mois précédent" }).click();

	await expect(page).toHaveURL(new RegExp(`[?&]month=${previous}(&|$)`, "u"));
	const moved = flows(page, previous);
	await expect(moved.getByRole("heading", { name: heading(previous) })).toBeVisible();
	await moved.getByRole("button", { name: "Mois précédent" }).click();
	await expect(page).toHaveURL(new RegExp(`[?&]month=${shiftMonth(previous, -1)}(&|$)`, "u"));

	const earlier = flows(page, shiftMonth(previous, -1));
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

// Story 14.2: Sure's proportions. The dashboard's cards stack in one column
// until 1536 px: beside the rail and the accounts column, a 1440 px screen
// leaves about 950 px, too narrow for two.

test("the greeting is 30 px, and the three cards stack at 1440 px and pair up at 1600 px", async ({
	page,
	api,
}) => {
	await api.openAccount();
	const current = daysAgo(0).slice(0, 7);

	await page.goto("/");

	const greeting = pageHeader(page).getByRole("heading", { level: 1 });
	await expect(greeting).toHaveCSS("font-size", "30px");
	const title = card(page).getByRole("heading", { level: 2, name: "Patrimoine net" });
	await expect(title).toHaveCSS("font-size", "16px");
	await expect(title).toHaveCSS("font-weight", "510");
	const cards = [card(page), flows(page, current), bilan(page)];
	await Promise.all(cards.map((region) => expect(region).toHaveCSS("border-radius", "12px")));

	const [netWorth, flow, sheet] = await Promise.all(cards.map((region) => region.boundingBox()));
	expect(netWorth).not.toBeNull();
	expect(flow).not.toBeNull();
	expect(sheet).not.toBeNull();
	expect(flow?.x).toBe(netWorth?.x);
	expect(sheet?.x).toBe(netWorth?.x);
	expect(flow?.width).toBe(netWorth?.width);
	expect(flow?.y).toBeGreaterThan((netWorth?.y ?? 0) + (netWorth?.height ?? 0));
	expect(sheet?.y).toBeGreaterThan((flow?.y ?? 0) + (flow?.height ?? 0));

	await page.setViewportSize({ width: 1600, height: 900 });

	await expect
		.poll(async () => {
			const [wide, beside] = await Promise.all([
				card(page).boundingBox(),
				flows(page, current).boundingBox(),
			]);

			return (
				wide !== null && beside !== null && beside.x > wide.x + wide.width && beside.y === wide.y
			);
		})
		.toBe(true);

	// The balance sheet climbs under the net worth, beside the month's flow.
	// Polled: read once, right after the resize, the charts were still redrawing
	// at their new width, and on 2026-10-06 the grid's rows had not settled.
	await expect
		.poll(async () => {
			const [top, climbed] = await Promise.all([
				card(page).boundingBox(),
				bilan(page).boundingBox(),
			]);

			return top === null || climbed === null
				? null
				: { x: climbed.x - top.x, gap: climbed.y - (top.y + top.height) };
		})
		.toEqual({ x: 0, gap: 24 });

	// In a half-width card, the month's three figures stack rather than overflow.
	const cells = await Promise.all(
		(["Revenus", "Dépenses", "Épargne du mois"] as const).map((label) =>
			cell(page, current, label).boundingBox(),
		),
	);
	expect(cells.every((box) => box !== null)).toBe(true);
	expect(new Set(cells.map((box) => box?.x)).size).toBe(1);

	await page.setViewportSize({ width: 390, height: 844 });

	await expect(greeting).toHaveCSS("font-size", "24px");
});

// Story 15.5: queries stay fresh for 30 s, so the dashboard no longer refetches
// on mount; a category's edit must invalidate the cash flow itself. This
// month, since « Accueil » leads to it and a link keeps the cache a reload drops.
test("a category renamed in « Réglages » is renamed in the dashboard's cash flow", async ({
	page,
	api,
}) => {
	const today = daysAgo(0);
	const month = today.slice(0, 7);
	const account = await api.openAccount({ openingDate: daysAgo(40) });
	const category = await api.createCategory({ name: uniqueName("Jardin") });
	const renamed = uniqueName("Potager");
	const id = await api.addTransaction(account.id, {
		date: today,
		label: "Graines",
		amount: "-7,00",
	});
	await api.categorise([id], category.id);

	await page.goto("/");
	await expect(rowsOf(page, month, "Dépenses").filter({ hasText: category.name })).toBeVisible();

	await page.getByRole("link", { name: "Réglages", exact: true }).first().click();
	await page.getByRole("link", { name: "Catégories" }).first().click();
	await page.getByRole("button", { name: `Actions pour ${category.name}`, exact: true }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier la catégorie" });
	await edit.getByLabel("Nom").fill(renamed);
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText(`Catégorie « ${renamed} » enregistrée.`)).toBeVisible();
	await page.getByRole("link", { name: "Accueil", exact: true }).first().click();

	await expect(rowsOf(page, month, "Dépenses").filter({ hasText: renamed })).toBeVisible();
	await expect(rowsOf(page, month, "Dépenses").filter({ hasText: category.name })).toHaveCount(0);
});
