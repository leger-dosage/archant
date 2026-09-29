import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 11.13: no command palette and no single-key shortcuts. The interface
// keeps what the browser and Radix give: `Tab`, `Enter` on a focused button,
// `Esc` on a layer, and the sheet's `⌘Enter`. One database serves the whole
// run, so lists are narrowed by a unique label prefix.

const rows = (page: Page) => page.getByRole("main").locator("button[data-transaction-id]");

const sheet = (page: Page) => page.getByRole("dialog", { name: "Modifier l'opération" });

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

		return active?.tagName === "A" &&
			active.closest('nav[aria-label="Navigation principale"]') !== null
			? "rail"
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

test("the top bar holds the fold button, and the page header the page's own actions only", async ({
	page,
	api,
}) => {
	// « Ajouter un compte » sits in the page header once an account exists.
	await api.openAccount();
	await visit(page, "/accounts");

	await expect(
		page
			.locator('[data-slot="top-bar"]')
			.getByRole("button", { name: "Replier ou déplier la liste des comptes" }),
	).toBeVisible();
	const header = page.locator('[data-slot="page-header"]');
	await expect(header.getByRole("button", { name: "Ajouter un compte" })).toBeVisible();
	await expect(header.getByRole("button")).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Rechercher", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Commandes", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Raccourcis clavier", exact: true })).toHaveCount(
		0,
	);
});

test("Tab reaches the rail's links, then a row, and Enter opens its sheet", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Tabulation");
	await threeRows(api, prefix);

	// Folded, so the accounts column, which grows with every test of the run
	// sharing this database, does not hold the focus past the bound. The fold
	// is remembered, and the reload starts the focus from the top.
	await visit(page, "/transactions");
	await page.getByRole("button", { name: "Replier ou déplier la liste des comptes" }).click();
	await visit(page, `/transactions?q=${encodeURIComponent(prefix)}`);
	await expect(rows(page)).toHaveCount(3);

	const reached = await tabUntilRow(page);

	expect(reached.indexOf("rail")).toBeGreaterThanOrEqual(0);
	expect(reached.indexOf("rail")).toBeLessThan(reached.indexOf("row"));
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
