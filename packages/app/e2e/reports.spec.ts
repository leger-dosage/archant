import { readFile } from "node:fs/promises";
import { z } from "zod";

import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

// Story 34.7: Sure's « Rapports », its CSV and its print layout. Reordering
// and collapsing the sections changes the single administrator's layout, so
// those tests live in `reports-layout.spec.ts`, in the `layout` project.

/** The quarter `back` quarters before today's: its label, first and last days. */
function quarter(back: number) {
	const today = daysAgo(0);
	const index = Number(today.slice(0, 4)) * 4 + Math.ceil(Number(today.slice(5, 7)) / 3) - 1 - back;
	const year = Math.floor(index / 4);
	const first = (index % 4) * 3 + 1;
	const last = new Date(Date.UTC(year, first + 2, 0)).toISOString().slice(0, 10);

	return {
		label: `Q${(index % 4) + 1} ${year}`,
		from: `${year}-${String(first).padStart(2, "0")}-01`,
		to: last,
	};
}

/** `2026-10-01` as the print layout writes it: « 1 octobre 2026 ». */
const longDate = (iso: string) =>
	new Intl.DateTimeFormat("fr-FR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${iso}T00:00:00Z`));

/** The button naming the period, which opens the picker. */
const periodButton = (label: string) => ({ name: new RegExp(`^${label},`, "u") });

test("« Rapports » opens from the navigation, steps a quarter by keyboard, exports its CSV and prints the period shown", async ({
	page,
	context,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(70) });
	const category = await api.createCategory({ name: uniqueName("Rapport") });
	const recent = await api.addTransaction(account.id, {
		date: daysAgo(0),
		label: "Courses",
		amount: "-42,00",
	});
	const older = await api.addTransaction(account.id, {
		date: daysAgo(35),
		label: "Courses",
		amount: "-18,00",
	});
	await api.categorise([recent, older], category.id);
	// Sure's print layout opens the dialog itself, which would hold the test:
	// the stub counts the calls instead.
	await context.addInitScript(() => {
		window.print = () => {
			Reflect.set(window, "printed", Number(Reflect.get(window, "printed") ?? 0) + 1);
		};
	});
	const current = quarter(0);

	await page.goto("/");
	await page
		.getByRole("navigation", { name: "Navigation principale" })
		.getByRole("link", { name: "Rapports" })
		.click();
	await expect(page.getByRole("heading", { level: 1, name: "Rapports" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Répartition des activités" })).toContainText(
		category.name,
	);

	await page.getByRole("link", { name: "Trimestriel" }).click();
	await expect(page.getByRole("button", periodButton(current.label))).toBeVisible();
	await expect(page.getByRole("button", { name: "Période suivante" })).toBeDisabled();

	await page.keyboard.press("ArrowLeft");
	await expect(page.getByRole("button", periodButton(quarter(1).label))).toBeVisible();
	await expect(page.getByRole("link", { name: "Période suivante" })).toBeVisible();

	await page.getByRole("link", { name: "Aujourd'hui" }).click();
	await expect(page.getByRole("button", periodButton(current.label))).toBeVisible();

	// The arrows are off while the picker is open.
	await page.getByRole("button", periodButton(current.label)).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	const pickerUrl = page.url();
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByRole("dialog")).toBeVisible();
	expect(page.url()).toBe(pickerUrl);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();

	const download = page.waitForEvent("download");
	await page.getByRole("link", { name: "CSV" }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe(
		`transactions_breakdown_${current.from.replaceAll("-", "")}_to_${current.to.replaceAll("-", "")}.csv`,
	);
	const csv = await readFile(await file.path(), "utf8");
	expect(csv.split("\n")[0]).toMatch(/^Category,[A-Z][a-z]{2} \d{4},.*Total$/u);
	expect(csv).toContain(category.name);

	const printed = context.waitForEvent("page");
	await page.getByRole("link", { name: "Imprimer le rapport" }).click();
	const print = await printed;
	await expect(print.getByRole("heading", { level: 1, name: "Rapport financier" })).toBeVisible();
	await expect(
		print.getByText(`${longDate(current.from)} – ${longDate(current.to)}`),
	).toBeVisible();
	await expect(print.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(0);
	await expect
		.poll(() => print.evaluate(() => Number(Reflect.get(window, "printed") ?? 0)))
		.toBe(1);
	await print.close();

	await page
		.getByRole("region", { name: "Répartition des activités" })
		.getByRole("link", { name: category.name })
		.click();
	await expect(page).toHaveURL(/\/transactions\?/u);
	const search = decodeURIComponent(new URL(page.url()).search);
	expect(search).toContain(category.id);
	expect(search).toContain(current.from);
	expect(search).toContain(current.to);
});

test("a reversed custom range is swapped and says so", async ({ page }) => {
	await page.goto(`/reports?periodType=custom&startDate=${daysAgo(5)}&endDate=${daysAgo(20)}`);

	await expect(page.getByRole("alert")).toHaveText(
		"La date de fin ne peut pas être antérieure à la date de début. Les dates ont été inversées.",
	);
	await expect(page.getByRole("button", { name: "Période précédente" })).toHaveCount(0);
});

const investmentReport = z.object({
	data: z.object({
		investments: z.object({
			available: z.literal(true),
			value: z.number(),
			holdings: z.array(z.object({ amount: z.number() })),
			periodReturn: z.object({ gain: z.number(), percent: z.string() }).nullable(),
			activity: z.object({ contributions: z.number(), withdrawals: z.number() }),
			gainsByTaxTreatment: z.array(z.object({ treatment: z.string(), realizedGain: z.number() })),
		}),
		investmentFlows: z.object({
			contributions: z.number(),
			withdrawals: z.number(),
			netFlow: z.number(),
		}),
	}),
});

test("investment trades, historical gains, cash funding and fixed print metrics follow the selected period", async ({
	page,
	context,
	api,
}, testInfo) => {
	const from = "2021-02-01";
	const to = "2021-02-28";
	const query = "?periodType=custom&startDate=" + from + "&endDate=" + to;
	const url = "/reports" + query;
	const account = await api.openAccount({
		kind: "brokerage",
		openingBalance: "1000",
		openingDate: "2021-01-01",
	});
	const foreign = await api.openAccount({
		kind: "brokerage",
		name: uniqueName("Investissements en dollars exclus"),
		currency: "USD",
		openingBalance: "9000",
		openingDate: "2021-01-01",
	});
	const name = uniqueName(
		"Fonds rapport dont le nom complet reste disponible même sans symbole boursier",
	);
	await api.recordTrade(account.id, {
		security: { source: "manual", name },
		date: "2021-01-15",
		quantity: "10",
		price: "100",
		fee: "10",
	});
	const positions = z
		.object({
			data: z.object({ positions: z.array(z.object({ security: z.object({ id: z.string() }) })) }),
		})
		.parse(await (await page.request.get("/api/accounts/" + account.id + "/holdings")).json());
	const securityId = positions.data.positions[0]?.security.id;
	expect(securityId).toBeDefined();
	const baseline = investmentReport.parse(
		await (await page.request.get("/api/reports/page" + query)).json(),
	).data;
	await api.recordTrade(account.id, {
		side: "sell",
		security: { source: "known", id: securityId },
		date: "2021-02-15",
		quantity: "4",
		price: "150",
		fee: "5",
	});
	const price = await page.request.post("/api/securities/" + securityId + "/prices", {
		data: { date: "2021-02-20", price: "160" },
	});
	expect(price.ok(), await price.text()).toBe(true);
	// Other tests own larger positions. Rank this one today without changing the historical period.
	const largest = Math.max(0, ...baseline.investments.holdings.map((holding) => holding.amount));
	const currentPrice = await page.request.post("/api/securities/" + securityId + "/prices", {
		data: { date: daysAgo(0), price: String(Math.floor(largest / 600) + 100) },
	});
	expect(currentPrice.ok(), await currentPrice.text()).toBe(true);
	await (
		[
			["Contribution", "50", "2021-02-10"],
			["Withdrawal", "-20", "2021-02-12"],
		] as const
	).reduce(async (previous, [label, amount, date]) => {
		await previous;
		const id = await api.addTransaction(account.id, { date, amount, label });
		const labeled = await page.request.patch("/api/transactions/" + id, {
			data: { investmentActivityLabel: label },
		});
		expect(labeled.ok(), await labeled.text()).toBe(true);
	}, Promise.resolve());
	const expected = investmentReport.parse(
		await (await page.request.get("/api/reports/page" + query)).json(),
	).data;
	expect(expected.investments.periodReturn?.gain).toBe(
		(baseline.investments.periodReturn?.gain ?? 0) + 55500,
	);
	const taxable = (report: typeof expected) =>
		report.investments.gainsByTaxTreatment.find((group) => group.treatment === "taxable")
			?.realizedGain ?? 0;
	expect(taxable(expected) - taxable(baseline)).toBe(19600);
	expect(expected.investmentFlows.contributions - baseline.investmentFlows.contributions).toBe(
		5000,
	);
	expect(expected.investmentFlows.withdrawals - baseline.investmentFlows.withdrawals).toBe(2000);
	await context.addInitScript(() => {
		window.print = () => undefined;
	});
	await page.goto(url);
	const performance = page.getByRole("region", {
		name: "Performance des investissements",
		exact: true,
	});
	const flows = page.getByRole("region", { name: "Flux d'investissement", exact: true });
	await expect(performance).toBeVisible();
	await expect(
		performance
			.getByRole("table", { name: "Principales positions", exact: true })
			.getByTitle(name, { exact: true }),
	).toBeVisible();
	await expect(
		performance.getByRole("link", { name: new RegExp(account.name, "u") }),
	).toBeVisible();
	await expect(
		performance.getByRole("group", { name: "Rendement de la période", exact: true }),
	).toContainText(euros(expected.investments.periodReturn?.gain ?? 0));
	await performance
		.getByText(/Voir les détails/u)
		.first()
		.click();
	await expect(
		performance.locator("details").getByText(euros(19600), { exact: true }),
	).toBeVisible();
	await expect(flows.getByRole("group", { name: "Contributions", exact: true })).toContainText(
		euros(expected.investmentFlows.contributions),
	);
	await expect(flows.getByRole("group", { name: "Retraits", exact: true })).toContainText(
		euros(expected.investmentFlows.withdrawals),
	);
	await expect(flows.getByRole("group", { name: "Flux net", exact: true })).toContainText(
		euros(expected.investmentFlows.netFlow),
	);
	await page.goto("/reports?periodType=custom&startDate=" + from + "&endDate=2021-02-14");
	await expect(
		performance.getByRole("group", { name: "Rendement de la période", exact: true }),
	).toContainText(euros(0));
	await page.goto(url);
	await expect(performance).toBeVisible();
	const opened = context.waitForEvent("page");
	await page.getByRole("link", { name: "Imprimer le rapport" }).click();
	const print = await opened;
	const printed = print.locator("section").filter({
		has: print.getByRole("heading", { level: 2, name: "Investissements", exact: true }),
	});
	await expect(printed).toContainText(euros(expected.investments.value));
	await expect(printed).toContainText(foreign.name);
	await expect(printed).toContainText(euros(expected.investments.periodReturn?.gain ?? 0));
	await expect(printed.getByText("Gains par traitement fiscal")).toHaveCount(0);
	await expect(
		print.getByRole("heading", { name: "Flux d'investissement", exact: true }),
	).toHaveCount(0);
	// Capture both themes and widths with the same fictional household.
	await (["light", "dark"] as const)
		.flatMap((colour) => [1440, 390].map((width) => ({ colour, width })))
		.reduce(async (previous, { colour, width }) => {
			await previous;
			await page.emulateMedia({ colorScheme: colour });
			await page.setViewportSize({ width, height: 900 });
			await performance.scrollIntoViewIfNeeded();
			await page.screenshot({
				path: testInfo.outputPath("reports-" + colour + "-" + width + ".png"),
				fullPage: true,
			});
			await print.setViewportSize({ width, height: 900 });
			await print.screenshot({
				path: testInfo.outputPath("print-" + colour + "-" + width + ".png"),
				fullPage: true,
			});
		}, Promise.resolve());
	await print.close();
});
