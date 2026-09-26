import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

// Story 9.2: recurring transactions at `/recurring`. One database serves the
// whole run and detection reads every account, so each test finds its rows
// by a label no other test uses.

const PAGE = "/recurring";

const table = (page: Page) => page.getByRole("table", { name: "Récurrences" });

const row = (page: Page, label: string) => table(page).getByRole("row").filter({ hasText: label });

const toast = (page: Page, text: string | RegExp) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

const tableDate = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

/** `iso` moved by `months` calendar months, on `day` of that month. */
function onDay(iso: string, months: number, day: number): string {
	const date = new Date(Date.parse(`${iso.slice(0, 7)}-01T00:00:00Z`));
	date.setUTCMonth(date.getUTCMonth() + months);
	date.setUTCDate(day);

	return date.toISOString().slice(0, 10);
}

/**
 * Three rows on `day` (1 to 28) of the three latest months that have had
 * it, and the next expected date: that day a month after the latest.
 */
function monthly(day: number): { dates: string[]; next: string } {
	const today = daysAgo(0);
	const latest = onDay(today, Number(today.slice(8, 10)) >= day ? 0 : -1, day);

	return {
		dates: [onDay(latest, -2, day), onDay(latest, -1, day), latest],
		next: onDay(latest, 1, day),
	};
}

async function openAccount(api: Api) {
	return api.openAccount({ name: uniqueName("Compte"), openingDate: daysAgo(120) });
}

async function addMonthly(api: Api, accountId: string, label: string, amount: string, day: number) {
	const { dates, next } = monthly(day);

	await Promise.all(dates.map((date) => api.addTransaction(accountId, { date, label, amount })));

	return next;
}

async function detect(page: Page) {
	await page.getByRole("button", { name: "Détecter" }).click();
	await expect(toast(page, /récurrences? détectées?/u).first()).toBeVisible();
}

async function visit(page: Page) {
	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 1, name: "Récurrences" })).toBeVisible();
}

test("« Détecter » lists monthly rows with their account, amount and next date, by next date", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const early = uniqueName("Abonnement");
	const late = uniqueName("Facture");
	const earlyNext = await addMonthly(api, account.id, early, "-13,99", 5);
	const lateNext = await addMonthly(api, account.id, late, "-65,00", 20);

	await visit(page);
	await detect(page);

	const first = row(page, early);
	await expect(first).toContainText(account.name);
	await expect(first).toContainText(euros(-1399));
	await expect(first).toContainText(tableDate.format(new Date(`${earlyNext}T00:00:00Z`)));
	await expect(first).toContainText("Détectée");
	await expect(row(page, late)).toContainText(euros(-6500));
	await expect(row(page, late)).toContainText(tableDate.format(new Date(`${lateNext}T00:00:00Z`)));

	const labels = await table(page).getByRole("row").allInnerTexts();
	const at = (label: string) => labels.findIndex((text) => text.includes(label));
	expect(at(early)).toBeGreaterThan(0);
	expect(at(late)).toBeGreaterThan(0);
	expect(at(early) < at(late)).toBe(earlyNext < lateNext);
});

test("confirming a detected item shows « Confirmée », and deactivating it « Inactive »", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Assurance");
	await addMonthly(api, account.id, label, "-32,50", 12);

	await visit(page);
	await detect(page);
	await row(page, label)
		.getByRole("button", { name: `Actions pour ${label}` })
		.click();
	await page.getByRole("menuitem", { name: "Confirmer" }).click();

	await expect(toast(page, "Récurrence confirmée")).toBeVisible();
	await expect(row(page, label)).toContainText("Confirmée");
	await expect(row(page, label)).not.toContainText("Détectée");

	await row(page, label)
		.getByRole("button", { name: `Actions pour ${label}` })
		.click();
	await page.getByRole("menuitem", { name: "Désactiver" }).click();

	await expect(toast(page, "Récurrence désactivée")).toBeVisible();
	await expect(row(page, label)).toContainText("Inactive");
});

test("a dismissed item disappears and stays gone after « Détecter »", async ({ page, api }) => {
	const account = await openAccount(api);
	const label = uniqueName("Salle de sport");
	await addMonthly(api, account.id, label, "-29,90", 8);

	await visit(page);
	await detect(page);
	await row(page, label)
		.getByRole("button", { name: `Actions pour ${label}` })
		.click();
	await page.getByRole("menuitem", { name: "Écarter" }).click();

	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText(`Écarter « ${label} » ?`);
	await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
	await dialog.getByRole("button", { name: "Écarter" }).click();

	await expect(dialog).toBeHidden();
	await expect(row(page, label)).toHaveCount(0);

	await detect(page);
	await page.reload();
	await expect(page.getByRole("heading", { level: 1, name: "Récurrences" })).toBeVisible();
	await expect(
		table(page)
			.or(page.getByText(/Aucune récurrence/u))
			.first(),
	).toBeVisible();
	await expect(row(page, label)).toHaveCount(0);
});

test("« Ajouter aux récurrences » in the sheet lists the transaction as confirmed and manual", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Cotisation");
	await api.addTransaction(account.id, { date: daysAgo(3), label, amount: "-15,00" });

	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	await page
		.getByRole("main")
		.getByRole("listitem")
		.filter({ hasText: label })
		.locator("button[data-transaction-id]")
		.click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await sheet.getByRole("button", { name: "Ajouter aux récurrences" }).click();
	await expect(toast(page, "Opération ajoutée aux récurrences")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	// The list follows the new series without a reload.
	await expect(
		page
			.getByRole("main")
			.getByRole("listitem")
			.filter({ hasText: label })
			.locator('[data-slot="status-badge"]'),
	).toHaveText("Récurrent");

	await visit(page);
	await expect(row(page, label)).toContainText("Confirmée");
	await expect(row(page, label)).toContainText("Ajoutée à la main");
	await expect(row(page, label)).toContainText(account.name);

	await detect(page);
	await expect(row(page, label)).toContainText("Confirmée");
	await expect(row(page, label)).toContainText("Ajoutée à la main");
});

async function openSheet(page: Page, label: string) {
	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	await page
		.getByRole("main")
		.getByRole("listitem")
		.filter({ hasText: label })
		.locator("button[data-transaction-id]")
		.first()
		.click();

	return page.getByRole("dialog", { name: "Modifier l'opération" });
}

test("the sheet names a transaction's detected series and links to it, and offers to add one otherwise", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Abonnement");
	const single = uniqueName("Achat");
	await addMonthly(api, account.id, label, "-9,99", 7);
	await api.addTransaction(account.id, { date: daysAgo(2), label: single, amount: "-24,00" });

	await visit(page);
	await detect(page);

	const sheet = await openSheet(page, label);
	await expect(sheet).toContainText(`Cette opération fait partie de la récurrence « ${label} ».`);
	await expect(sheet.getByRole("button", { name: "Ajouter aux récurrences" })).toHaveCount(0);
	await sheet.getByRole("link", { name: "Voir les récurrences" }).click();
	await expect(page).toHaveURL(/\/recurring$/u);
	await expect(row(page, label)).toContainText("Détectée");

	const other = await openSheet(page, single);
	await expect(other.getByRole("button", { name: "Ajouter aux récurrences" })).toBeVisible();
	await expect(other).not.toContainText("fait partie de la récurrence");
});

test("the sidebar opens Récurrences", async ({ page }) => {
	await page.goto("/accounts");
	await page
		.locator('[data-sidebar="sidebar"]')
		.getByRole("link", { name: "Récurrences", exact: true })
		.click();
	await expect(page).toHaveURL(/\/recurring$/u);
	await expect(page.getByRole("heading", { level: 1, name: "Récurrences" })).toBeVisible();
});
