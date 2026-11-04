import { formatShortDate, formatTableDate, formatTick } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, periodPicker, pickPeriod, rgb, test } from "./fixtures.ts";

// Story 1.3: daily balance history.

const PERIODS = [
	{ label: "90J", param: "last_90_days", comparison: "vs. dernier trimestre" },
	{ label: "AC", param: "current_year", comparison: "vs. début de l'année" },
	{ label: "365J", param: "last_365_days", comparison: "vs il y a 1 an" },
	{ label: "Tout", param: "all_time", comparison: "vs début" },
	// Sure's account chart, when the account starts after the period does.
	{ label: "5A", param: "last_5_years", comparison: "par rapport à l'historique disponible" },
] as const;

// Anchored: « 1 septembre 2026 » is also the end of « 11 septembre 2026 ».
const dayRow = (iso: string) => new RegExp(`^${formatTableDate(iso)} `, "u");

test("each period selects, and the summary names it", async ({ page, api }) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(400) });
	await api.addTransaction(account.id, { date: daysAgo(10), label: "Loyer", amount: "-100,00" });

	await page.goto(`/accounts/${account.id}`);
	const card = page.getByRole("region", { name: "Historique du solde" });
	const summary = page.getByText(/^Solde : /u);

	await expect(periodPicker(card)).toHaveText("30J");
	await expect(summary).toContainText(euros(90_000));
	await expect(summary).toContainText("vs. 30 derniers jours");

	try {
		// One after the other: each pick must land before the next one.
		await PERIODS.reduce(async (previous, period) => {
			await previous;
			await pickPeriod(page, card, period.label);

			await expect(periodPicker(card)).toHaveText(period.label);
			await expect(page).toHaveURL(new RegExp(`[?&]period=${period.param}(&|$)`, "u"));
			await expect(summary).toContainText(period.comparison);
			await expect(summary).toContainText(euros(90_000));
		}, Promise.resolve());

		// Saved, as Sure's `default_period`: the account opens on the last pick.
		await page.goto(`/accounts/${account.id}`);
		await expect(periodPicker(card)).toHaveText("5A");
	} finally {
		await api.setDefaultPeriod("last_30_days");
	}
});

test("« Voir le tableau » shows the series as a table", async ({ page, api }) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(60) });
	await api.addTransaction(account.id, { date: daysAgo(10), label: "Loyer", amount: "-100,00" });

	await page.goto(`/accounts/${account.id}`);
	const toggle = page.getByRole("button", { name: "Voir le tableau" });

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

test("an account opened today shows Sure's empty chart, its day still in the table", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(0) });

	await page.goto(`/accounts/${account.id}`);
	const card = page.getByRole("region", { name: "Historique du solde" });

	// Sure's `_drawEmpty`: one point draws no line, but a dashed line and a dot.
	const empty = card.locator('[data-slot="chart-empty"]');
	await expect(empty).toBeVisible();
	await expect(empty.locator('[data-slot="chart-empty-line"]')).toHaveAttribute(
		"stroke-dasharray",
		"4 4",
	);
	await expect(empty.locator('[data-slot="chart-empty-dot"]')).toHaveCount(1);
	await expect(card.locator(".recharts-wrapper")).toHaveCount(0);

	await card.getByRole("button", { name: "Voir le tableau" }).click();
	await expect(card.getByRole("row", { name: dayRow(daysAgo(0)) })).toContainText(euros(100_000));
});

test("an unknown period in the URL falls back to the saved one", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(400) });

	try {
		await api.setDefaultPeriod("last_90_days");
		await page.goto(`/accounts/${account.id}?period=decennie`);

		await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
		await expect(periodPicker(page)).toHaveText("90J");
		await expect(page.getByText(/^Solde : /u)).toContainText("vs. dernier trimestre");
	} finally {
		await api.setDefaultPeriod("last_30_days");
	}
});

test("a custom range in the URL names its days, « Personnalisé » checked", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });
	const [start, end] = [daysAgo(20), daysAgo(5)];

	await page.goto(`/accounts/${account.id}?startDate=${start}&endDate=${end}`);

	const year = daysAgo(0).slice(0, 4);
	const short = (iso: string) =>
		start.startsWith(year) && end.startsWith(year) ? formatTick(iso, false) : formatShortDate(iso);
	await expect(periodPicker(page)).toHaveText(`${short(start)} – ${short(end)}`);
	await expect(page.getByText(/^Solde : /u)).toContainText(
		`${formatShortDate(start)} au ${formatShortDate(end)}`,
	);
	await periodPicker(page).click();
	await expect(page.getByRole("menuitemradio").last()).toHaveText("Personnalisé");
	await expect(page.getByRole("menuitemradio").last()).toHaveAttribute("aria-checked", "true");
	await page.keyboard.press("Escape");
});

test("a range that starts after it ends falls back to the last 30 days, as Sure's", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });

	await page.goto(`/accounts/${account.id}?startDate=${daysAgo(5)}&endDate=${daysAgo(20)}`);

	await expect(periodPicker(page)).toHaveText("30J");
	await expect(page.getByText(/^Solde : /u)).toContainText("vs. 30 derniers jours");
});

test("the period is kept across the pages of the transactions", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });

	await api.addDailyTransactions(account.id, 51, "Jour");

	await page.goto(`/accounts/${account.id}?period=last_90_days`);
	const pages = page.getByRole("navigation", { name: "Pages des opérations" });

	await pages.getByRole("link", { name: "Suivant" }).click();
	await expect(pages).toContainText("Page 2 sur 2");
	await expect(page).toHaveURL(/[?&]period=last_90_days(&|$)/u);
	await expect(periodPicker(page)).toHaveText("90J");

	await pages.getByRole("link", { name: "Précédent" }).click();
	await expect(pages).toContainText("Page 1 sur 2");
	await expect(page).toHaveURL(/[?&]period=last_90_days(&|$)/u);
});

// Story 14.2: as Sure's account page, the balance above a card that holds the chart.
test("the balance sits in no card at 30 px, above the chart's 256 px card", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(60) });

	await page.goto(`/accounts/${account.id}`);

	const balance = page
		.getByRole("region", { name: account.name, exact: true })
		.locator(".amount-hero");
	await expect(balance).toHaveText(euros(100_000));
	await expect(balance).toHaveCSS("font-size", "30px");
	await expect(page.locator('[data-slot="section"] .amount-hero')).toHaveCount(0);

	const chartCard = page.getByRole("region", { name: "Historique du solde" });
	await expect(chartCard).toHaveAttribute("data-slot", "section");
	await expect(chartCard).toHaveCSS("border-radius", "12px");
	await expect(chartCard).toHaveCSS("background-color", rgb("#ffffff"));
	await expect(periodPicker(chartCard)).toBeVisible();
	await expect(chartCard.locator('[data-slot="chart"]')).toHaveCSS("height", "256px");

	// Its tabs sit on the grey track, the current one on white.
	const tabs = page.getByRole("tablist", { name: "Vues du compte" });
	await expect(tabs).toHaveCSS("background-color", rgb("#f2f2f3"));
	await expect(tabs.getByRole("tab")).toHaveText(["Opérations", "Soldes", "Imports"]);
	await expect(tabs.getByRole("tab", { selected: true })).toHaveCSS(
		"background-color",
		rgb("#ffffff"),
	);
});
