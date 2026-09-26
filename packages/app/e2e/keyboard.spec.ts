import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 11.13: no command palette and no single-key shortcuts. The interface
// keeps what the browser and Radix give: `Tab`, `Enter` on a focused button,
// `Esc` on a layer, and the sheet's `⌘Enter`. One database serves the whole
// run, so lists are narrowed by a unique label prefix.

const rows = (page: Page) => page.getByRole("main").locator("button[data-transaction-id]");

const sheet = (page: Page) => page.getByRole("dialog", { name: "Modifier l'opération" });

const sidebar = (page: Page) => page.locator('[data-sidebar="sidebar"]');

/** Opens a page and waits for its heading. */
async function visit(page: Page, url: string) {
	await page.goto(url);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** An account with three transactions, listed as `<prefix> 01` (most recent) to `<prefix> 03`. */
async function threeRows(api: Api, prefix: string) {
	const account = await api.openAccount({ openingDate: daysAgo(30) });
	await api.addDailyTransactions(account.id, 3, prefix);

	return account;
}

/** What `Tab` lands on, one entry per press, until a row has focus. */
async function tabUntilRow(page: Page, reached: string[] = []): Promise<string[]> {
	// A bound, so a missing row fails the test rather than hanging it.
	if (reached.at(-1) === "row" || reached.length >= 100) {
		return reached;
	}

	await page.keyboard.press("Tab");
	const where = await page.evaluate(() => {
		const active = document.activeElement;

		if (active?.hasAttribute("data-transaction-id") === true) {
			return "row";
		}

		return active?.tagName === "A" && active.closest('[data-sidebar="sidebar"]') !== null
			? "sidebar"
			: "other";
	});

	return tabUntilRow(page, [...reached, where]);
}

test("the former shortcuts open nothing, go nowhere and move no focus", async ({ page, api }) => {
	const account = await api.openAccount();

	await visit(page, `/accounts/${account.id}`);
	await page.keyboard.press("ControlOrMeta+K");
	await page.keyboard.press("Shift+?");
	await page.keyboard.press("n");
	await page.keyboard.press("i");
	await page.keyboard.press("g");
	await page.keyboard.press("o");

	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}$`, "u"));
	await expect(page.locator(":focus")).toHaveCount(0);

	await visit(page, "/transactions");
	await page.keyboard.press("/");

	await expect(page.locator(":focus")).toHaveCount(0);
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the header holds the sidebar trigger only", async ({ page }) => {
	await visit(page, "/accounts");

	const header = page.locator("header");
	await expect(
		header.getByRole("button", { name: "Réduire ou déplier la barre latérale" }),
	).toBeVisible();
	await expect(header.getByRole("button")).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Rechercher", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Commandes", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Raccourcis clavier", exact: true })).toHaveCount(
		0,
	);
});

test("a collapsed sidebar's tooltip names the page, with no key", async ({ page }) => {
	await visit(page, "/accounts");
	await page
		.locator("header")
		.getByRole("button", { name: "Réduire ou déplier la barre latérale" })
		.click();
	await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toHaveCount(1);
	await page.mouse.move(0, 0, { steps: 5 });

	await sidebar(page).getByRole("link", { name: "Comptes", exact: true }).hover();

	await expect(page.getByRole("tooltip")).toHaveText("Comptes");
});

test("Tab reaches the sidebar links, then a row, and Enter opens its sheet", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Tabulation");
	await threeRows(api, prefix);
	// Icons only, so the sidebar leaves out the account list, which grows with
	// every test of the run sharing this database.
	await page.setViewportSize({ width: 900, height: 900 });

	await visit(page, `/transactions?q=${encodeURIComponent(prefix)}`);
	await expect(rows(page)).toHaveCount(3);

	const reached = await tabUntilRow(page);

	expect(reached.indexOf("sidebar")).toBeGreaterThanOrEqual(0);
	expect(reached.indexOf("sidebar")).toBeLessThan(reached.indexOf("row"));
	await expect(rows(page).first()).toBeFocused();

	await page.keyboard.press("Enter");

	await expect(sheet(page).getByLabel("Libellé")).toHaveValue(`${prefix} 01`);
});

test("⌘Enter saves the sheet, and Esc closes another with focus back on its row", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Feuille");
	await threeRows(api, prefix);
	const renamed = `${prefix} renommée`;

	await visit(page, `/transactions?q=${encodeURIComponent(prefix)}`);
	await expect(rows(page)).toHaveCount(3);

	await rows(page).nth(0).click();
	await sheet(page).getByLabel("Libellé").fill(renamed);
	await page.keyboard.press("ControlOrMeta+Enter");

	await expect(sheet(page)).toBeHidden();
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(rows(page).filter({ hasText: renamed })).toHaveCount(1);

	await rows(page)
		.filter({ hasText: `${prefix} 02` })
		.click();
	await expect(sheet(page).getByLabel("Libellé")).toHaveValue(`${prefix} 02`);
	await page.keyboard.press("Escape");

	await expect(sheet(page)).toBeHidden();
	await expect(rows(page).filter({ hasText: `${prefix} 02` })).toBeFocused();
});
