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
import { longDate, monthLabel } from "../src/lib/dates.ts";
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
	// Below the cash flow widgets since Story 34.4: the mouse only reaches it on screen.
	await chart.scrollIntoViewIfNeeded();
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

// Story 6.2, then Story 34.4: Sure's cash flow widgets. Each test owns a
// month, which no other test writes to, so its totals are exact: the period
// in the URL is that month, as a custom range, and « Entrées / sorties
// d'argent » reads it through its own `moneyFlowMonth`.

/** Opened before every month these tests use, so any day of 2024 is accepted. */
const before2024 = { openingBalance: "0", openingDate: "2023-12-01" } as const;

/** A `YYYY-MM` month's last day. */
const monthEnd = (month: string) =>
	new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
		.toISOString()
		.slice(0, 10);

/** The dashboard with `month` as its period and as the money flow's month. */
const dashboardOf = (month: string) =>
	`/?startDate=${month}-01&endDate=${monthEnd(month)}&moneyFlowMonth=${month}`;

const sankey = (page: Page) => page.getByRole("region", { name: "Flux de trésorerie" });

const outflows = (page: Page) => page.getByRole("region", { name: "Sorties", exact: true });

/** « Sorties »'s rows, largest first. */
const outflowRows = (page: Page) =>
	outflows(page).getByRole("list", { name: "Sorties" }).getByRole("link");

const donut = (page: Page) => outflows(page).getByRole("img", { name: /^Sorties de la période/u });

const moneyFlow = (page: Page) => page.getByRole("region", { name: "Entrées / sorties d'argent" });

/** The money flow's row to a side's transactions. */
const flowRow = (page: Page, side: "Entrées" | "Sorties") =>
	moneyFlow(page).getByRole("link", { name: new RegExp(`^${side}`, "u") });

/** « Novembre 2026 », the month picker's label for `2026-11`. */
const pickerLabel = (month: string) => {
	const text = monthLabel(month);

	return text.charAt(0).toUpperCase() + text.slice(1);
};

const spending = (page: Page) => page.getByRole("region", { name: "Dépenses", exact: true });

test("« Sorties » and « Entrées / sorties d'argent » count only the month's counted rows", async ({
	page,
	api,
}) => {
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

	await page.goto(dashboardOf("2024-03"));

	await expect(donut(page)).toHaveAccessibleName(
		`Sorties de la période : ${euros(4_000)} sur 1 catégorie.`,
	);
	await expect(donut(page)).toContainText("Total des sorties");
	await expect(donut(page)).toContainText(euros(4_000));
	await expect(donut(page).locator(".recharts-pie-sector path")).toHaveAttribute("fill", "#e99537");
	await expect(outflows(page)).toContainText("Catégories·1");
	await expect(outflowRows(page)).toHaveCount(1);
	await expect(outflowRows(page)).toContainText(groceries.name);
	// Sure's figures are unsigned: an outflow reads 40,00 €, at 100 %.
	await expect(outflowRows(page)).toContainText(euros(4_000));
	await expect(outflowRows(page)).not.toContainText("−");
	await expect(outflowRows(page)).toContainText("100 %");
	// `createCategory` gives the icon `tag`: the row shows it, not the uncategorised one.
	await expect(outflowRows(page).locator('[data-slot="tinted-icon"] svg.lucide-tag')).toBeVisible();

	await expect(moneyFlow(page)).toContainText("Du 1 mars 2024 au 31 mars 2024");
	await expect(flowRow(page, "Entrées")).toContainText(euros(20_000));
	await expect(flowRow(page, "Sorties")).toContainText(euros(4_000));
	await expect(moneyFlow(page)).toContainText(`Balance des opérations${euros(16_000)}`);
});

test("a category refunded beyond what it spent leaves « Sorties » for the Sankey's income side", async ({
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

	await page.goto(dashboardOf("2024-08"));

	await expect(outflowRows(page)).toHaveCount(1);
	await expect(outflowRows(page)).toContainText(groceries.name);
	await expect(donut(page).locator(".recharts-pie-sector")).toHaveCount(1);
	await expect(donut(page).locator(".recharts-pie-sector path")).toHaveAttribute("fill", "#e99537");
	const chart = sankey(page).getByRole("img", { name: /^Flux de trésorerie de la période/u });
	await expect(chart).toHaveAccessibleName(
		`Flux de trésorerie de la période : ${euros(2_000)} d'entrées, ${euros(4_000)} de sorties.`,
	);
	await expect(chart.locator("text").filter({ hasText: clothes.name })).toHaveCount(1);
	await expect(chart.locator("text").filter({ hasText: "Flux de trésorerie" })).toHaveCount(1);
	// Expenses above income: neither a surplus nor a deficit, as Sure's.
	await expect(chart.locator("text").filter({ hasText: "Excédent" })).toHaveCount(0);
});

test("a parent line rolls up its sub-category, beside « Sans catégorie », which opens its rows of the period", async ({
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

	await page.goto(dashboardOf("2024-04"));

	await expect(donut(page)).toContainText(euros(10_000));
	const rows = outflowRows(page);
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText(parent.name);
	await expect(rows.nth(0)).toContainText("60 %");
	await expect(rows.nth(0)).toContainText(euros(6_000));
	await expect(rows.nth(1)).toContainText("Sans catégorie");
	await expect(rows.nth(1)).toContainText("40 %");
	await expect(rows.nth(1)).toContainText(euros(4_000));
	await expect(rows.nth(1).locator("svg.lucide-circle-dashed")).toBeVisible();
	await expect(outflows(page)).not.toContainText(child.name);
	// The Sankey hangs the sub-category from its parent.
	await expect(sankey(page).locator("text").filter({ hasText: child.name })).toHaveCount(1);

	// Sure's grey for « Sans catégorie », as the Sankey's.
	await expect(donut(page).locator(".recharts-pie-sector path").nth(1)).toHaveAttribute(
		"fill",
		"#737373",
	);
	// A segment opens its rows, as its row does.
	// The ring is 15 px thick and starts at noon: just right of its top is the first segment.
	await donut(page).click({ position: { x: 140, y: 8 } });
	await expect(page).toHaveURL(new RegExp(parent.id, "u"));
	await expect(page).toHaveURL(/[?&]from=2024-04-01(&|$)/u);
	await page.goBack();

	await rows.nth(1).hover();
	await expect(donut(page)).toContainText("Sans catégorie");
	await expect(donut(page)).toContainText("40 %");

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

test("« Sorties » reads Sure's net view and « Entrées / sorties d'argent » its gross one: a refund, a category's net income, a loan payment, and no dividend nor PEA line", async ({
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

	await page.goto(dashboardOf("2022-07"));

	// Before Story 27.6: the PEA's fee −15,00 € and « Cadeaux » under « Dépenses » by its kind.
	await expect(donut(page)).toContainText(euros(57_000));
	await expect(outflowRows(page)).toHaveCount(2);
	await expect(outflowRows(page).nth(0)).toContainText("Sans catégorie");
	await expect(outflowRows(page).nth(0)).toContainText(euros(50_000));
	await expect(outflowRows(page).nth(1)).toContainText(groceries.name);
	await expect(outflowRows(page).nth(1)).toContainText(euros(7_000));
	await expect(outflows(page)).not.toContainText(gifts.name);

	// Gross: the refund and the gift received are income, without the dividend.
	await expect(flowRow(page, "Entrées")).toContainText(euros(8_000));
	await expect(flowRow(page, "Sorties")).toContainText(euros(62_000));
	await expect(moneyFlow(page)).toContainText(`Balance des opérations${euros(-54_000)}`);
});

test("a transaction marked one-time in the sheet leaves « Sorties », and the list keeps it with Sure's asterisk", async ({
	page,
	api,
}) => {
	// September 2022 belongs to this test alone.
	const account = await api.openAccount({ openingBalance: "0", openingDate: "2022-08-15" });
	const label = uniqueName("Électroménager");
	await api.addTransaction(account.id, { date: "2022-09-05", label, amount: "-900,00" });
	await api.addTransaction(account.id, { date: "2022-09-06", label: "Courses", amount: "-40,00" });

	await page.goto(dashboardOf("2022-09"));
	await expect(donut(page)).toContainText(euros(94_000));

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

	await page.goto(dashboardOf("2022-09"));
	await expect(donut(page)).toContainText(euros(4_000));
	await expect(flowRow(page, "Sorties")).toContainText(euros(4_000));
});

test("a month of a PEA's lines and a dividend alone has no cash flow, hides « Sorties », and offers a transaction", async ({
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

	await page.goto(dashboardOf("2022-08"));

	await expect(
		sankey(page).getByRole("heading", {
			name: "Aucune donnée de flux de trésorerie pour cette période",
		}),
	).toBeVisible();
	await expect(sankey(page)).toContainText(
		"Ajoutez des transactions pour afficher les données de flux de trésorerie ou étendez la période",
	);
	await expect(sankey(page).getByRole("button", { name: "Développer" })).toHaveCount(0);
	await expect(outflows(page)).toHaveCount(0);
	await expect(flowRow(page, "Entrées")).toContainText(euros(0));
	await expect(flowRow(page, "Sorties")).toContainText(euros(0));

	await sankey(page).getByRole("button", { name: "Ajouter une transaction" }).click();
	await expect(page.getByRole("dialog", { name: "Ajouter une opération" })).toBeVisible();
});

test("a category line opens its rows of the period in « Opérations »", async ({ page, api }) => {
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

	await page.goto(dashboardOf("2024-05"));
	await outflowRows(page).filter({ hasText: leisure.name }).click();

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

test("the month picker moves « Entrées / sorties d'argent » in the URL, keeping the period, and a later month reads as this one", async ({
	page,
	api,
}) => {
	await api.openAccount();
	const current = daysAgo(0).slice(0, 7);
	const previous = shiftMonth(current, -1);
	await page.goto("/?period=last_90_days");

	const picker = moneyFlow(page).getByRole("button", { name: "Sélectionner un mois" });
	await expect(picker).toHaveText(pickerLabel(current));
	// The trigger's name keeps the month it shows, as « Période : 30J ».
	await expect(picker).toHaveAccessibleName(`Sélectionner un mois : ${pickerLabel(current)}`);
	await expect(moneyFlow(page).getByRole("button", { name: "Tous les comptes" })).toBeVisible();
	await picker.click();
	const months = page.getByRole("menuitemradio");
	await expect(months).toHaveCount(12);
	await expect(months.first()).toHaveText(pickerLabel(current));
	await expect(page.getByRole("menuitemradio", { name: pickerLabel(current) })).toBeChecked();
	await page.getByRole("menuitemradio", { name: pickerLabel(previous) }).click();

	await expect(page).toHaveURL(new RegExp(`[?&]moneyFlowMonth=${previous}(&|$)`, "u"));
	await expect(page).toHaveURL(/[?&]period=last_90_days(&|$)/u);
	await expect(picker).toHaveText(pickerLabel(previous));
	await expect(moneyFlow(page)).toContainText(
		`Du ${longDate(`${previous}-01`)} au ${longDate(monthEnd(previous))}`,
	);
	// « Dépenses » keeps its own month.
	await expect(spending(page).getByRole("button", { name: "Sélectionner un mois" })).toHaveText(
		pickerLabel(current),
	);

	await picker.click();
	await page.getByRole("menuitemradio", { name: pickerLabel(current) }).click();
	await expect(page).not.toHaveURL(/[?&]moneyFlowMonth=/u);

	await page.goto(`/?moneyFlowMonth=${shiftMonth(current, 3)}`);
	await expect(picker).toHaveText(pickerLabel(current));
	await page.goto("/?moneyFlowMonth=abc");
	await expect(picker).toHaveText(pickerLabel(current));
});

test("the account filter narrows « Entrées / sorties d'argent », and its « Sorties » row opens the month's confirmed expenses of those accounts", async ({
	page,
	api,
}) => {
	// July 2021 belongs to this test alone.
	const opened = { openingBalance: "0", openingDate: "2021-06-01" } as const;
	const first = await api.openAccount({ ...opened, name: uniqueName("Courant") });
	const second = await api.openAccount({ ...opened, name: uniqueName("Joint") });
	// A third account left out, so two ticked are never every account, run alone.
	await api.openAccount({ ...opened, name: uniqueName("Livret"), kind: "savings" });
	await api.addTransaction(first.id, { date: "2021-07-05", label: "Courses", amount: "-30,00" });
	await api.addTransaction(second.id, { date: "2021-07-06", label: "Courses", amount: "-50,00" });

	await page.goto(`/?moneyFlowMonth=2021-07&moneyFlowAccountIds=${first.id}`);

	const trigger = moneyFlow(page).getByRole("button", { name: "Filtrer les comptes (1)" });
	await expect(trigger).toBeVisible();
	await expect(flowRow(page, "Sorties")).toContainText(euros(3_000));

	await trigger.click();
	const popover = page.getByRole("dialog");
	await popover.getByRole("searchbox", { name: "Rechercher un compte" }).fill(second.name);
	await popover.getByRole("checkbox").click();
	await popover.getByRole("button", { name: "Appliquer" }).click();

	// The router writes an array param as JSON.
	await expect
		.poll(() => new URL(page.url()).searchParams.get("moneyFlowAccountIds"))
		.toBe(JSON.stringify([first.id, second.id]));
	await expect(page).toHaveURL(/[?&]moneyFlowMonth=2021-07(&|$)/u);
	await expect(
		moneyFlow(page).getByRole("button", { name: "Filtrer les comptes (2)" }),
	).toBeVisible();
	await expect(flowRow(page, "Sorties")).toContainText(euros(8_000));

	await flowRow(page, "Sorties").click();

	await expect(page).toHaveURL(/\/transactions\?/u);
	const param = (key: string) => new URL(page.url()).searchParams.get(key);
	await expect.poll(() => param("direction")).toBe(JSON.stringify(["expense"]));
	await expect.poll(() => param("status")).toBe(JSON.stringify(["confirmed"]));
	await expect(page).toHaveURL(/[?&]from=2021-07-01(&|$)/u);
	await expect(page).toHaveURL(/[?&]to=2021-07-31(&|$)/u);
	await expect.poll(() => param("account")).toBe(JSON.stringify([first.id, second.id]));
});

test("a click on a Sankey node zooms onto its sub-category, « Retour à la trésorerie totale » zooms out, and a label opens its rows of the period", async ({
	page,
	api,
}) => {
	// September 2021 belongs to this test alone.
	const account = await api.openAccount({ openingBalance: "0", openingDate: "2021-08-01" });
	const parent = await api.createCategory({ name: uniqueName("Maison") });
	const child = await api.createCategory({ name: uniqueName("Jardin"), parentId: parent.id });
	await api.addTransaction(account.id, { date: "2021-09-01", label: "Paie", amount: "200,00" });
	const inParent = await api.addTransaction(account.id, {
		date: "2021-09-03",
		label: "Meuble",
		amount: "-30,00",
	});
	const childLabel = uniqueName("Graines");
	const inChild = await api.addTransaction(account.id, {
		date: "2021-09-04",
		label: childLabel,
		amount: "-20,00",
	});
	await api.categorise([inParent], parent.id);
	await api.categorise([inChild], child.id);

	await page.goto(dashboardOf("2021-09"));

	const chart = sankey(page).getByRole("img", { name: /^Flux de trésorerie de la période/u });
	const label = (name: string) => chart.locator("text").filter({ hasText: name });
	await expect(label("Excédent")).toHaveCount(1);
	await expect(label("Sans catégorie")).toHaveCount(1);

	await chart.locator(`g[data-node="expense_${parent.id}"] path`).click();

	const back = sankey(page).getByRole("button", { name: "Retour à la trésorerie totale" });
	await expect(back).toBeVisible();
	await expect(label(parent.name)).toHaveCount(1);
	await expect(label(child.name)).toHaveCount(1);
	await expect(label("Excédent")).toHaveCount(0);
	await expect(label("Sans catégorie")).toHaveCount(0);

	await back.click();

	await expect(back).toHaveCount(0);
	await expect(label("Excédent")).toHaveCount(1);
	await expect(label("Sans catégorie")).toHaveCount(1);

	await label(child.name).click();

	await expect(page).toHaveURL(/\/transactions\?/u);
	await expect(page).toHaveURL(new RegExp(child.id, "u"));
	await expect(page).toHaveURL(/[?&]from=2021-09-01(&|$)/u);
	await expect(page).toHaveURL(/[?&]to=2021-09-30(&|$)/u);
	await expect(page.getByText(childLabel)).toBeVisible();
});

test("« Dépenses » compares a month's spending with the whole previous month, a refund never lowering it", async ({
	page,
	api,
}) => {
	// March 2021 and the February before belong to this test alone.
	const account = await api.openAccount({ openingBalance: "0", openingDate: "2021-01-15" });
	await api.addTransaction(account.id, { date: "2021-02-10", label: "Courses", amount: "-30,00" });
	await api.addTransaction(account.id, { date: "2021-03-05", label: "Courses", amount: "-50,00" });
	await api.addTransaction(account.id, { date: "2021-03-06", label: "Retour", amount: "20,00" });

	await page.goto("/?spendingMonth=2021-03");

	await expect(spending(page)).toContainText("du 1 mars 2021 au 31 mars 2021");
	const march = spending(page).getByRole("group", { name: "Mars 2021" });
	await expect(march).toContainText(euros(5_000));
	// 20,00 € beyond February, in the destructive colour.
	const delta = march.getByText(euros(2_000), { exact: true });
	await expect(delta).toHaveCSS("color", rgb("#c91313"));
	const february = spending(page).getByRole("group", { name: "Février 2021" });
	await expect(february).toContainText(euros(3_000));
	await expect(february).not.toContainText("(1-");
	await expect(spending(page).locator(".recharts-line")).toHaveCount(2);

	await page.goto("/?spendingMonth=2020-11");
	await expect(spending(page).getByText("Aucune dépense pour ce mois-ci")).toBeVisible();
});

// Story 14.2 then 34.4: Sure's proportions and its default order. The
// dashboard's cards stack in one column until 1536 px: beside the rail and
// the accounts column, a 1440 px screen leaves about 950 px, too narrow for two.

test("the greeting is 30 px, the widgets stack in Sure's order at 1440 px and pair up at 1600 px, the Sankey across both", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(40) });
	// Today's expense, so « Sorties » has a line in any saved period.
	await api.addTransaction(account.id, { date: daysAgo(0), label: "Pain", amount: "-2,00" });

	await page.goto("/");

	const greeting = pageHeader(page).getByRole("heading", { level: 1 });
	await expect(greeting).toHaveCSS("font-size", "30px");
	const title = card(page).getByRole("heading", { level: 2, name: "Patrimoine net" });
	await expect(title).toHaveCSS("font-size", "16px");
	await expect(title).toHaveCSS("font-weight", "510");
	const cards = [
		sankey(page),
		outflows(page),
		card(page),
		bilan(page),
		moneyFlow(page),
		spending(page),
	];
	await Promise.all(cards.map((region) => expect(region).toHaveCSS("border-radius", "12px")));
	await expect(page.getByRole("button", { name: "Mois précédent" })).toHaveCount(0);

	const boxes = await Promise.all(cards.map((region) => region.boundingBox()));
	expect(boxes.every((box) => box !== null)).toBe(true);
	expect(new Set(boxes.map((box) => box?.x)).size).toBe(1);
	const tops = boxes.map((box) => box?.y ?? 0);
	expect(tops).toEqual(tops.toSorted((a, b) => a - b));

	await page.setViewportSize({ width: 1600, height: 900 });

	// Polled: read once, right after the resize, the charts were still redrawing
	// at their new width, and on 2026-10-06 the grid's rows had not settled.
	await expect
		.poll(async () => {
			const [wide, left, right] = await Promise.all([
				sankey(page).boundingBox(),
				outflows(page).boundingBox(),
				card(page).boundingBox(),
			]);

			return (
				wide !== null &&
				left !== null &&
				right !== null &&
				left.x === wide.x &&
				right.x > left.x + left.width &&
				right.y === left.y &&
				left.y > wide.y + wide.height &&
				Math.round(right.x + right.width) === Math.round(wide.x + wide.width)
			);
		})
		.toBe(true);

	await page.setViewportSize({ width: 390, height: 844 });

	await expect(greeting).toHaveCSS("font-size", "24px");
});

// Story 15.5: queries stay fresh for 30 s, so the dashboard no longer refetches
// on mount; a category's edit must invalidate the cash flow itself. Today,
// since « Accueil » leads to the saved period and a link keeps the cache a
// reload drops.
test("a category renamed in « Réglages » is renamed in the dashboard's « Sorties »", async ({
	page,
	api,
}) => {
	const today = daysAgo(0);
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
	await expect(outflowRows(page).filter({ hasText: category.name })).toBeVisible();

	await page.getByRole("link", { name: "Réglages", exact: true }).first().click();
	await page.getByRole("link", { name: "Catégories" }).first().click();
	await page.getByRole("button", { name: `Actions pour ${category.name}`, exact: true }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier la catégorie" });
	await edit.getByLabel("Nom").fill(renamed);
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText(`Catégorie « ${renamed} » enregistrée.`)).toBeVisible();
	await page.getByRole("link", { name: "Accueil", exact: true }).first().click();

	await expect(outflowRows(page).filter({ hasText: renamed })).toBeVisible();
	await expect(outflowRows(page).filter({ hasText: category.name })).toHaveCount(0);
});
