import type { Page } from "@playwright/test";

import { perSection } from "@archant/data/dashboard-sections";

import { daysAgo, expect, test } from "./fixtures.ts";

// Story 34.6: Sure's arranged dashboard. The layout is the single
// administrator's, which every `chromium` test reads: this file runs in its
// own project after them, and puts Sure's default back after each test.

const grid = (page: Page) => page.getByRole("list", { name: "Sections du tableau de bord" });

/** A widget's list item, named by Sure's keyboard instructions. */
const widget = (page: Page, title: string) =>
	grid(page).getByRole("listitem", { name: new RegExp(`^Section ${title}\\.`, "u") });

const region = (page: Page, title: string) =>
	page.getByRole("region", { name: title, exact: true });

/** The shown widgets' keys, in the order the page lays them out. */
const shownKeys = (page: Page) =>
	grid(page)
		.locator("[data-section-key]")
		.evaluateAll((items) =>
			items.flatMap((item) =>
				item.getClientRects().length > 0 ? [item.getAttribute("data-section-key") ?? ""] : [],
			),
		);

/**
 * Whether « Bilan » sits right before « Patrimoine net ». Relative, not by
 * index: « Sorties » appears above both once the cash flow arrives.
 */
const bilanFirst = async (page: Page) => {
	const keys = await shownKeys(page);

	return keys.indexOf("balance_sheet") === keys.indexOf("net_worth_chart") - 1;
};

const layoutSaved = (page: Page) =>
	page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/dashboard/layout") &&
			response.request().method() === "PATCH" &&
			response.ok(),
	);

test.afterEach(async ({ api }) => {
	await api.resetDashboardLayout();
});

test("a widget moves by keyboard, collapses and hides, keeps all three after a reload, and comes back from « Widgets masqués »", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(40) });
	await api.addTransaction(account.id, { date: daysAgo(0), label: "Pain", amount: "-2,00" });

	await page.goto("/");
	await expect(region(page, "Bilan")).toBeVisible();
	const before = await shownKeys(page);
	expect(before.indexOf("balance_sheet")).toBe(before.indexOf("net_worth_chart") + 1);

	// Sure's keyboard model: Space grabs, the arrow moves, Space releases and saves.
	const bilan = widget(page, "Bilan");
	await bilan.focus();
	await page.keyboard.press("Space");
	await expect(bilan).toHaveAttribute("aria-grabbed", "true");
	await page.keyboard.press("ArrowUp");
	await expect(bilan).toBeFocused();
	const moved = layoutSaved(page);
	await page.keyboard.press("Space");
	await moved;
	await expect(bilan).toHaveAttribute("aria-grabbed", "false");
	await expect.poll(async () => bilanFirst(page)).toBe(true);

	// The chevron collapses « Entrées / sorties d'argent », its header staying.
	const moneyFlow = region(page, "Entrées / sorties d'argent");
	const toggle = moneyFlow.getByRole("button", { name: "Afficher/masquer la section" });
	const collapsed = layoutSaved(page);
	await toggle.click();
	await collapsed;
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await expect(moneyFlow.getByText("Balance des opérations")).toBeHidden();

	// « Personnaliser » offers the eye button; « Dépenses » leaves the grid.
	await page.getByRole("link", { name: "Personnaliser" }).click();
	await expect(page).toHaveURL(/[?&]customize=true/u);
	const hidden = layoutSaved(page);
	await region(page, "Dépenses").getByRole("button", { name: "Masquer Dépenses" }).click();
	await hidden;
	await expect(region(page, "Dépenses")).toHaveCount(0);
	const card = page.getByRole("region", { name: "Widgets masqués" });
	await expect(card.getByRole("button", { name: "Dépenses" })).toBeFocused();

	await page.reload();

	await expect(region(page, "Bilan")).toBeVisible();
	await expect.poll(async () => bilanFirst(page)).toBe(true);
	await expect(
		region(page, "Entrées / sorties d'argent").getByRole("button", {
			name: "Afficher/masquer la section",
		}),
	).toHaveAttribute("aria-expanded", "false");
	await expect(region(page, "Dépenses")).toHaveCount(0);

	const shown = layoutSaved(page);
	await card.getByRole("button", { name: "Dépenses" }).click();
	await shown;
	await expect(region(page, "Dépenses")).toBeVisible();
	await expect(card).toContainText("Tous les widgets sont affichés.");

	await page.getByRole("link", { name: "Terminé" }).click();
	await expect(page).not.toHaveURL(/customize/u);
	await expect(card).toHaveCount(0);
	await expect(page.getByRole("button", { name: /^Masquer /u })).toHaveCount(0);

	// Every widget hidden: Sure's empty state, which leads back to customising.
	await api.setDashboardLayout({ hiddenSections: perSection(() => true) });
	await page.reload();

	await expect(page.getByRole("heading", { name: "Tous les widgets sont masqués" })).toBeVisible();
	await expect(grid(page).getByRole("listitem")).toHaveCount(0);
	await page.getByRole("link", { name: "Personnaliser" }).last().click();
	await expect(
		page.getByRole("region", { name: "Widgets masqués" }).getByRole("button"),
	).not.toHaveCount(0);
});

test("at 1600 px, « Patrimoine net » set to « Plein » and « Grand » spans both columns with a 416 px chart, kept after a reload", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(40) });
	// Today's expense, so « Dépenses » draws its chart this month.
	await api.addTransaction(account.id, { date: daysAgo(0), label: "Pain", amount: "-2,00" });
	await page.setViewportSize({ width: 1600, height: 900 });

	await page.goto("/");
	const netWorth = region(page, "Patrimoine net");
	const chart = netWorth.locator('[data-slot="chart"]');
	await expect(chart).toHaveCSS("height", "288px");

	const size = netWorth.getByRole("button", { name: "Ajuster la taille" });
	await size.click();
	const wide = layoutSaved(page);
	await page
		.getByRole("radiogroup", { name: "Largeur" })
		.getByRole("radio", { name: "Plein" })
		.click();
	await wide;
	await size.click();
	const tall = layoutSaved(page);
	await page
		.getByRole("radiogroup", { name: "Hauteur" })
		.getByRole("radio", { name: "Grand" })
		.click();
	await tall;

	const spansBoth = async () => {
		const [box, list] = await Promise.all([netWorth.boundingBox(), grid(page).boundingBox()]);

		return box !== null && list !== null && Math.round(box.width) === Math.round(list.width);
	};

	await expect(chart).toHaveCSS("height", "416px");
	await expect.poll(spansBoth).toBe(true);

	// « Dépenses » takes the same presets.
	const spending = region(page, "Dépenses");
	const spendingChart = spending.locator('[data-slot="chart"]');
	await expect(spendingChart).toHaveCSS("height", "288px");
	await spending.getByRole("button", { name: "Ajuster la taille" }).click();
	const spendingTall = layoutSaved(page);
	// The net worth's menu may still be closing: the one just opened is the last.
	await page
		.getByRole("radiogroup", { name: "Hauteur" })
		.last()
		.getByRole("radio", { name: "Grand" })
		.click();
	await spendingTall;
	await expect(spendingChart).toHaveCSS("height", "416px");

	await page.reload();

	await expect(chart).toHaveCSS("height", "416px");
	await expect(spendingChart).toHaveCSS("height", "416px");
	await expect.poll(spansBoth).toBe(true);
});

test("a widget dragged by its grip lands before the one it is dropped on, kept after a reload", async ({
	page,
	api,
}) => {
	await api.openAccount({ openingDate: daysAgo(40) });
	// Keep both widgets in view so dragging does not need to scroll the page.
	await page.setViewportSize({ width: 1440, height: 1600 });

	await page.goto("/");
	await expect(region(page, "Bilan")).toBeVisible();
	const before = await shownKeys(page);
	expect(before.indexOf("balance_sheet")).toBe(before.indexOf("net_worth_chart") + 1);

	const grip = region(page, "Bilan").getByRole("button", {
		name: "Glisser pour réorganiser la section",
	});
	await grip.hover();
	const target = widget(page, "Patrimoine net");
	await expect(grip).toBeInViewport();
	await expect(target).toBeInViewport();
	await expect(grip).toHaveAttribute("draggable", "true");
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	const point = await target.evaluate((element) => {
		const { x, y, width, height } = element.getBoundingClientRect();

		return { clientX: x + width / 2, clientY: y + height / 2 };
	});

	// Chromium's drag interception can stall before it delivers the drop.
	await grip.dispatchEvent("dragstart", { dataTransfer });
	await expect(widget(page, "Bilan")).toHaveAttribute("aria-grabbed", "true");
	await target.dispatchEvent("dragover", { dataTransfer, ...point });
	await Promise.all([layoutSaved(page), target.dispatchEvent("drop", { dataTransfer, ...point })]);
	await grip.dispatchEvent("dragend", { dataTransfer });
	await dataTransfer.dispose();

	await expect.poll(async () => bilanFirst(page)).toBe(true);

	await page.reload();

	await expect(region(page, "Bilan")).toBeVisible();
	await expect.poll(async () => bilanFirst(page)).toBe(true);
});

test("a refused save says so and puts the widget back", async ({ page, api }) => {
	await api.openAccount({ openingDate: daysAgo(40) });
	await page.route("**/api/dashboard/layout", (route) =>
		route.request().method() === "PATCH"
			? route.fulfill({
					status: 500,
					json: { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
				})
			: route.fallback(),
	);

	try {
		await page.goto("/");
		const toggle = region(page, "Bilan").getByRole("button", {
			name: "Afficher/masquer la section",
		});
		await toggle.click();

		await expect(page.getByText("Une erreur inattendue s'est produite.")).toBeVisible();
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
	} finally {
		await page.unrouteAll();
	}
});
