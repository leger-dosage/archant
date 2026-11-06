import type { Page } from "@playwright/test";

import { daysAgo, expect, test } from "./fixtures.ts";

// Story 34.7: Sure's reorderable, collapsible reports sections. The layout
// is the single administrator's: this file runs in the `layout` project,
// after every `chromium` test, and puts Sure's default back after each test.

const sections = (page: Page) => page.getByRole("list", { name: "Sections du rapport" });

const section = (page: Page, title: string) =>
	sections(page).getByRole("listitem", { name: new RegExp(`^Section ${title}\\.`, "u") });

const order = (page: Page) =>
	sections(page)
		.locator("[data-section-key]")
		.evaluateAll((items) => items.map((item) => item.getAttribute("data-section-key")));

const layoutSaved = (page: Page) =>
	page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/reports/layout") &&
			response.request().method() === "PATCH" &&
			response.ok(),
	);

test.beforeEach(async ({ page, api }) => {
	const account = await api.openAccount({ kind: "pea", openingDate: daysAgo(40) });
	const funding = await api.addTransaction(account.id, {
		date: daysAgo(0),
		label: "Financement rapport",
		amount: "43,21",
	});
	const labeled = await page.request.patch("/api/transactions/" + funding, {
		data: { investmentActivityLabel: "Contribution" },
	});
	expect(labeled.ok(), await labeled.text()).toBe(true);
});

test.afterEach(async ({ api }) => {
	await api.resetReportsLayout();
});

test("a section collapses and moves up by keyboard, and both stay after a reload", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(40) });
	await api.addTransaction(account.id, { date: daysAgo(0), label: "Pain", amount: "-2,00" });

	await page.goto("/reports");
	await expect(section(page, "Patrimoine net")).toBeVisible();
	expect(await order(page)).toEqual([
		"trends_insights",
		"transactions_breakdown",
		"net_worth",
		"investment_performance",
		"investment_flows",
	]);

	const netWorth = page.getByRole("region", { name: "Patrimoine net", exact: true });
	const collapsed = layoutSaved(page);
	await netWorth.getByRole("button", { name: "Basculer la visibilité de la section" }).click();
	await collapsed;
	await expect(
		netWorth.getByRole("button", { name: "Basculer la visibilité de la section" }),
	).toHaveAttribute("aria-expanded", "false");

	const breakdown = section(page, "Répartition des activités");
	await breakdown.focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowUp");
	const moved = layoutSaved(page);
	await page.keyboard.press("Space");
	await moved;
	expect(await order(page)).toEqual([
		"transactions_breakdown",
		"trends_insights",
		"net_worth",
		"investment_performance",
		"investment_flows",
	]);

	await page.reload();
	await expect(section(page, "Patrimoine net")).toBeVisible();
	expect(await order(page)).toEqual([
		"transactions_breakdown",
		"trends_insights",
		"net_worth",
		"investment_performance",
		"investment_flows",
	]);
	await expect(
		page
			.getByRole("region", { name: "Patrimoine net", exact: true })
			.getByRole("button", { name: "Basculer la visibilité de la section" }),
	).toHaveAttribute("aria-expanded", "false");
});

test("a grabbed section keeps `←` from changing the period", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(40) });
	await api.addTransaction(account.id, { date: daysAgo(0), label: "Pain", amount: "-2,00" });

	await page.goto("/reports");
	const breakdown = section(page, "Répartition des activités");
	await expect(breakdown).toBeVisible();
	const url = page.url();
	await breakdown.focus();
	await page.keyboard.press("Space");
	await expect(breakdown).toHaveAttribute("aria-grabbed", "true");
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByRole("link", { name: "Période précédente" })).toBeVisible();
	expect(page.url()).toBe(url);
	await page.keyboard.press("Escape");
	await expect(breakdown).toHaveAttribute("aria-grabbed", "false");
});

test("a section dragged by its grip below the last one's middle lands last, kept after a reload", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(40) });
	await api.addTransaction(account.id, { date: daysAgo(0), label: "Pain", amount: "-2,00" });
	// Folded, the three sections fit on the screen with room below them.
	const folded = await page.request.patch("/api/reports/layout", {
		data: {
			collapsedSections: {
				net_worth: true,
				trends_insights: true,
				transactions_breakdown: true,
				investment_performance: true,
				investment_flows: true,
			},
		},
	});
	expect(folded.ok(), await folded.text()).toBe(true);

	await page.goto("/reports");
	await expect(section(page, "Patrimoine net")).toBeVisible();

	const moved = layoutSaved(page);
	// By hand rather than `dragTo`, as the dashboard's drag test explains.
	const grip = page
		.getByRole("region", { name: "Tendances et aperçus", exact: true })
		.getByRole("button", { name: "Glisser pour réorganiser la section" });
	await grip.hover();
	const from = await grip.boundingBox();
	const last = await section(page, "Flux d'investissement").boundingBox();
	expect(from).not.toBeNull();
	expect(last).not.toBeNull();
	await page.mouse.down();
	await page.mouse.move((from?.x ?? 0) + 20, (from?.y ?? 0) + 20, { steps: 5 });
	await page.mouse.move(
		(last?.x ?? 0) + (last?.width ?? 0) / 2,
		(last?.y ?? 0) + ((last?.height ?? 0) * 3) / 4,
		{ steps: 10 },
	);
	await page.mouse.up();
	await moved;

	await expect
		.poll(async () => order(page))
		.toEqual([
			"transactions_breakdown",
			"net_worth",
			"investment_performance",
			"investment_flows",
			"trends_insights",
		]);

	await page.reload();
	await expect(section(page, "Patrimoine net")).toBeVisible();
	expect(await order(page)).toEqual([
		"transactions_breakdown",
		"net_worth",
		"investment_performance",
		"investment_flows",
		"trends_insights",
	]);
});

test("investment sections retain their order and collapse through reload, hiding and print", async ({
	page,
	context,
}) => {
	await context.addInitScript(() => {
		window.print = () => undefined;
	});
	await page.goto("/reports");
	await ["Performance des investissements", "Flux d'investissement"].reduce(
		async (previous, title) => {
			await previous;
			const saved = layoutSaved(page);
			await page
				.getByRole("region", { name: title, exact: true })
				.getByRole("button", { name: "Basculer la visibilité de la section" })
				.click();
			await saved;
		},
		Promise.resolve(),
	);
	const flow = section(page, "Flux d'investissement");
	await flow.focus();
	await page.keyboard.press("Space");
	await [0, 1, 2, 3].reduce(async (previous) => {
		await previous;
		await page.keyboard.press("ArrowUp");
	}, Promise.resolve());
	const saved = layoutSaved(page);
	await page.keyboard.press("Space");
	await saved;
	await page.reload();
	await expect(flow).toBeVisible();
	expect((await order(page))[0]).toBe("investment_flows");
	await ["Performance des investissements", "Flux d'investissement"].reduce(
		async (previous, title) => {
			await previous;
			await expect(
				page
					.getByRole("region", { name: title, exact: true })
					.getByRole("button", { name: "Basculer la visibilité de la section" }),
			).toHaveAttribute("aria-expanded", "false");
		},
		Promise.resolve(),
	);
	await page.goto("/reports?periodType=custom&startDate=2099-01-01&endDate=2099-01-31");
	await expect(section(page, "Flux d'investissement")).toHaveCount(0);
	await page.goto("/reports");
	await expect(flow).toBeVisible();
	expect((await order(page))[0]).toBe("investment_flows");
	await expect(
		page
			.getByRole("region", { name: "Flux d'investissement", exact: true })
			.getByRole("button", { name: "Basculer la visibilité de la section" }),
	).toHaveAttribute("aria-expanded", "false");
	const opened = context.waitForEvent("page");
	await page.getByRole("link", { name: "Imprimer le rapport" }).click();
	const print = await opened;
	await expect(
		print.getByRole("heading", { level: 2, name: "Investissements", exact: true }),
	).toBeVisible();
	await expect(print.getByText("Valeur du portefeuille")).toBeVisible();
	await print.close();
});
