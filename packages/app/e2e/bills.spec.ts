import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { z } from "zod";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Story 23.4: the bills page at `/bills`. One database serves the whole run,
// so the page lists other tests' bills too: each test finds its rows by a
// name no other test uses.

const PAGE = "/bills";

const toast = (page: Page, text: string | RegExp) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/**
 * A bill's first row in the sections, « Prochaine » left aside: a series due
 * this month has its next month's row in « Après ce mois-ci » too.
 */
const row = (page: Page, name: string) =>
	page.locator('[data-slot="inset-group"]').getByRole("link").filter({ hasText: name }).first();

const sectionRow = (page: Page, title: string, name: string) =>
	section(page, title).getByRole("link").filter({ hasText: name });

const dayMonth = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	timeZone: "UTC",
});

/** `2026-10-05` as « 5 octobre », as the bills page writes a due date. */
const spelled = (iso: string) => dayMonth.format(new Date(`${iso}T00:00:00Z`));

const totalsBody = z.object({
	data: z.object({
		totals: z.object({
			remaining: z.number(),
			overdue: z.number(),
			dueSoon: z.number(),
			paid: z.number(),
		}),
	}),
});

async function openAccount(api: Api, currency: "EUR" | "USD" = "EUR") {
	return api.openAccount({ name: uniqueName("Compte"), openingDate: daysAgo(120), currency });
}

/** A monthly bill named `name`, first due `daysAgo(days)`. */
async function declare(api: Api, accountId: string, name: string, amount: string, days: number) {
	return api.declareBill({ name, amount, accountId, firstDueOn: daysAgo(days) });
}

async function visit(page: Page) {
	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 1, name: "Factures" })).toBeVisible();
}

/** Opens a bill's sheet from its row. */
async function openSheet(page: Page, name: string) {
	await row(page, name).click();
	const sheet = page.getByRole("dialog", { name });
	await expect(sheet).toBeVisible();
	await expect(page).toHaveURL(/\?occurrence=/u);

	return sheet;
}

test("the rail's « Factures » opens the bills page, which links to every bill", async ({
	page,
}) => {
	await page.goto("/accounts");
	await page
		.getByRole("navigation", { name: "Navigation principale" })
		.getByRole("link", { name: "Factures", exact: true })
		.click();
	await expect(page).toHaveURL(/\/bills$/u);
	await expect(page.getByRole("heading", { level: 1, name: "Factures" })).toBeVisible();

	await page.getByRole("link", { name: "Toutes les factures" }).click();
	await expect(page).toHaveURL(/\/recurring$/u);
	await expect(page.getByRole("heading", { level: 1, name: "Récurrences" })).toBeVisible();
});

test("each occurrence sits in its section and reads its due date as Sure's", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const late = uniqueName("Électricité");
	const grace = uniqueName("Internet");
	const due = uniqueName("Cantine");
	const soon = uniqueName("Assurance");
	const later = uniqueName("Taxe");
	const paused = uniqueName("Gaz");
	await declare(api, account.id, late, "84,20", 5);
	await declare(api, account.id, grace, "39,99", 2);
	await declare(api, account.id, due, "50,00", 0);
	await declare(api, account.id, soon, "45,00", -4);
	await declare(api, account.id, later, "120,00", -40);
	await api.setRecurringStatus(await declare(api, account.id, paused, "60,00", 5), "inactive");

	await visit(page);

	await expect(sectionRow(page, "Requiert votre attention", late)).toContainText(
		`5 jours de retard, échéance le ${spelled(daysAgo(5))}`,
	);
	// Inside its grace days: the month's, due soon, never overdue.
	await expect(sectionRow(page, "Ce mois-ci", grace)).toContainText(
		`Échéance le ${spelled(daysAgo(2))}`,
	);
	await expect(sectionRow(page, "Ce mois-ci", grace)).toContainText("Bientôt due");
	await expect(sectionRow(page, "Ce mois-ci", due)).toContainText("À payer aujourd'hui");
	await expect(sectionRow(page, "Ce mois-ci", due)).toContainText(euros(5000));
	await expect(row(page, soon)).toContainText(`À payer dans 4 jours, ${spelled(daysAgo(-4))}`);
	await expect(row(page, soon)).not.toContainText("Bientôt due");
	// Two later occurrences, one row: the earliest.
	await expect(sectionRow(page, "Après ce mois-ci", later)).toHaveCount(1);
	await expect(sectionRow(page, "Après ce mois-ci", later)).toContainText(
		`À payer dans 40 jours, ${spelled(daysAgo(-40))}`,
	);
	await expect(sectionRow(page, "Inactives", paused)).toHaveCount(1);
	await expect(sectionRow(page, "Requiert votre attention", paused)).toHaveCount(0);
});

test("the totals are the month's in euros, « Prochaine » shows four at most, and another currency is named", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const dollars = await openAccount(api, "USD");
	const foreign = uniqueName("Hébergement");
	await declare(api, account.id, uniqueName("Loyer"), "800,00", -3);
	// Due today, so in the month whatever the day.
	await declare(api, dollars.id, foreign, "20,00", 0);
	const answer = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/recurring/bills") && response.request().method() === "GET",
	);

	await visit(page);
	const { data } = totalsBody.parse(await (await answer).json());

	const totals = page.getByRole("region", { name: "Ce mois-ci en chiffres" });
	await Promise.all(
		(
			[
				["Restant ce mois-ci", data.totals.remaining],
				["En retard", data.totals.overdue],
				["À payer sous 7 jours", data.totals.dueSoon],
				["Payé ce mois-ci", data.totals.paid],
			] as const
		).map(([label, amount]) =>
			expect(totals.getByRole("group", { name: label })).toContainText(euros(amount)),
		),
	);
	const next = page.getByRole("list", { name: "Prochaine" }).getByRole("listitem");
	await expect(next.first()).toBeVisible();
	expect(await next.count()).toBeLessThanOrEqual(4);
	await expect(page.getByText(/^Hors des totaux, faute de conversion/u)).toContainText(foreign);
	// Listed all the same, in its own currency.
	await expect(row(page, foreign)).toContainText("20,00 $US");
});

test("a suggested payment reads as Sure's, and « Appliquer » or « Pas cette facture » settles it", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const bills = await Promise.all(
		["Prêt immobilier", "Crédit auto"].map(async (prefix) => {
			const label = uniqueName("PRLV CREDIT AGRICOLE");
			const name = uniqueName(prefix);
			// The bill starts from an older transaction, whose label it then recognises.
			const starter = await api.addTransaction(account.id, {
				date: daysAgo(100),
				label,
				amount: "-9,99",
			});
			await api.declareBill({
				name,
				amount: "571,29",
				accountId: account.id,
				firstDueOn: daysAgo(10),
				entryId: starter,
			});
			// Five days late and 28,71 € over: suggested, never confirmed by itself.
			await api.addTransaction(account.id, { date: daysAgo(5), label, amount: "-600,00" });

			return { label, name };
		}),
	);
	await api.detectRecurring();

	await visit(page);

	const queue = page.getByRole("list", { name: "Paiements à vérifier" });
	const [applied, refused] = bills.map(({ label, name }) =>
		queue.getByRole("listitem").filter({ hasText: `${label} ressemble à un paiement de ${name}` }),
	);
	await expect(applied!).toContainText(euros(57_129));
	await expect(applied!).toContainText(/\d+\s%/u);
	await expect(
		applied!.getByRole("list", { name: "Pourquoi cette correspondance" }).getByRole("listitem"),
	).toHaveText(["Libellé reconnu", `${euros(2871)} d'écart`, "5 jours après l'échéance"]);

	await applied!.getByRole("button", { name: "Appliquer" }).click();
	await expect(toast(page, "Paiement appliqué")).toBeVisible();
	await expect(applied!).toHaveCount(0);

	await refused!.getByRole("button", { name: "Pas cette facture" }).click();
	await expect(toast(page, "Cette opération ne sera plus proposée")).toBeVisible();
	await expect(refused!).toHaveCount(0);
	// Still owed, in place: refusing a payment pays nothing.
	await expect(sectionRow(page, "Requiert votre attention", bills[1]!.name)).toHaveCount(1);
});

test("the sheet marks an occurrence paid with a payment of no transaction, then reopens it", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const name = uniqueName("Cantine");
	await declare(api, account.id, name, "50,00", 0);

	await visit(page);
	const sheet = await openSheet(page, name);
	await expect(sheet).toContainText(`${euros(5000)} restant`);
	await sheet.getByRole("button", { name: "Marquer comme payée" }).click();

	await expect(toast(page, "Échéance marquée comme payée")).toBeVisible();
	await expect(sheet.getByRole("list", { name: "Paiements" })).toContainText("Paiement manuel");
	await expect(sheet.getByRole("list", { name: "Paiements" })).toContainText(euros(5000));
	// Closed: « Rouvrir » alone.
	await expect(sheet.getByRole("button", { name: "Rouvrir" })).toBeVisible();
	await expect(sheet.getByRole("button", { name: "Marquer comme payée" })).toHaveCount(0);
	await expect(sheet.getByRole("button", { name: "Ignorer cette échéance" })).toHaveCount(0);

	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(page).toHaveURL(/\/bills$/u);
	// The month's paid one, in place under a check.
	await expect(sectionRow(page, "Ce mois-ci", name)).toContainText("Payée");
	await expect(
		sectionRow(page, "Ce mois-ci", name).locator(
			'[data-status="billPaid"] svg.lucide-circle-check',
		),
	).toBeVisible();

	await openSheet(page, name);
	await sheet.getByRole("button", { name: "Rouvrir" }).click();
	await expect(toast(page, "Échéance rouverte")).toBeVisible();
	await expect(sheet.getByRole("button", { name: "Marquer comme payée" })).toBeVisible();
});

test("the sheet adds a payment by amount and date, which reads partial, and removes it after asking", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const name = uniqueName("Eau");
	await declare(api, account.id, name, "300,00", -4);

	await visit(page);
	const sheet = await openSheet(page, name);
	const add = sheet.getByRole("region", { name: "Ajouter un paiement" });
	await expect(add.getByLabel("Montant", { exact: true })).toHaveValue("300,00");
	await add.getByLabel("Montant", { exact: true }).fill("abc");
	await add.getByRole("button", { name: "Enregistrer le paiement" }).click();
	await expect(add.getByText("Montant invalide. Exemple : 1 234,56.")).toBeVisible();

	await add.getByLabel("Montant", { exact: true }).fill("180,00");
	await add.getByLabel("Date du paiement").fill(typed(daysAgo(0)));
	await add.getByRole("button", { name: "Enregistrer le paiement" }).click();
	await expect(toast(page, "Paiement ajouté")).toBeVisible();
	await expect(sheet.getByRole("list", { name: "Paiements" })).toContainText("Paiement manuel");
	await expect(sheet).toContainText(`${euros(12_000)} restant`);

	await page.keyboard.press("Escape");
	await expect(row(page, name)).toContainText(`Partiel · ${euros(12_000)} restant`);

	await openSheet(page, name);
	await sheet.getByRole("button", { name: `Retirer le paiement de ${euros(18_000)}` }).click();
	const confirm = page.getByRole("alertdialog", {
		name: `Retirer le paiement de ${euros(18_000)} ?`,
	});
	await confirm.getByRole("button", { name: "Retirer" }).click();
	await expect(toast(page, "Paiement retiré")).toBeVisible();
	await expect(sheet.getByRole("list", { name: "Paiements" })).toHaveCount(0);
	await expect(sheet).toContainText(`${euros(30_000)} restant`);
});

test("the sheet postpones an occurrence, changes its amount alone, then skips it", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const name = uniqueName("Assurance");
	await declare(api, account.id, name, "45,00", -1);

	await visit(page);
	const sheet = await openSheet(page, name);
	await sheet.getByLabel("Reporter au").fill(typed(daysAgo(-6)));
	await sheet.getByRole("button", { name: "Reporter", exact: true }).click();
	await expect(toast(page, `Échéance reportée au ${spelled(daysAgo(-6))}`)).toBeVisible();
	await expect(sheet).toContainText(`Reportée au ${spelled(daysAgo(-6))}`);

	await sheet.getByLabel("Montant attendu").fill("52,00");
	await sheet.getByRole("button", { name: "Modifier le montant" }).click();
	await expect(toast(page, "Montant modifié")).toBeVisible();
	await expect(sheet).toContainText(`${euros(5200)} restant`);

	await page.keyboard.press("Escape");
	await expect(row(page, name).filter({ hasText: "Reportée au" })).toContainText(euros(5200));

	await openSheet(page, name);
	await sheet.getByRole("button", { name: "Ignorer cette échéance" }).click();
	await expect(toast(page, "Échéance ignorée")).toBeVisible();
	await expect(sheet).toContainText("Ignorée");
	await expect(sheet.getByRole("button", { name: "Rouvrir" })).toBeVisible();

	await page.keyboard.press("Escape");
	// A skipped occurrence is not listed.
	await expect(row(page, name).filter({ hasText: "Reportée au" })).toHaveCount(0);
});

test("« Ajouter un paiement » offers the transactions the matcher scores, with their percentage and signals", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const name = uniqueName("Mutuelle");
	await declare(api, account.id, name, "32,50", 1);
	await api.addTransaction(account.id, { date: daysAgo(1), label: name, amount: "-32,50" });
	await api.addTransaction(account.id, {
		date: daysAgo(1),
		label: uniqueName("Boulangerie"),
		amount: "-32,50",
	});

	await visit(page);
	const sheet = await openSheet(page, name);
	const candidates = sheet.getByRole("list", { name: "Opérations correspondantes" });
	// Its own items, not the signals listed inside each.
	await expect(candidates.locator(":scope > li")).toHaveCount(1);
	await expect(candidates).toContainText(/95\s%/u);
	await expect(
		candidates.getByRole("list", { name: "Pourquoi cette correspondance" }).getByRole("listitem"),
	).toHaveText(["Libellé reconnu", "Montant exact", "À la date prévue"]);

	await candidates.getByRole("button", { name: `Utiliser ${name}` }).click();
	await expect(toast(page, "Paiement ajouté")).toBeVisible();
	await expect(sheet.getByRole("list", { name: "Paiements" })).toContainText(name);
	// It settles the occurrence by itself: paid.
	await expect(sheet.getByRole("button", { name: "Rouvrir" })).toBeVisible();
});

const EMPTY = {
	currency: "EUR",
	attention: [],
	month: [],
	later: [],
	inactive: [],
	next: [],
	totals: { remaining: 0, overdue: 0, dueSoon: 0, paid: 0 },
	leftOut: [],
	review: [],
};

/**
 * Answers the page as a household with no bill would: no row, `hasTransactions`
 * as given, and `series` as its recurring list.
 */
async function emptyHousehold(page: Page, hasTransactions: boolean, series: unknown[] = []) {
	await page.route("**/api/recurring/bills", (route) =>
		route.fulfill({ json: { data: { ...EMPTY, hasTransactions } } }),
	);
	await page.route("**/api/recurring", (route) =>
		route.request().method() === "GET"
			? route.fulfill({ json: { data: series } })
			: route.fallback(),
	);
}

test("with no bill, the page offers to find them or to add one", async ({ page }) => {
	await emptyHousehold(page, true);
	await visit(page);

	const empty = page.locator('[data-slot="empty-state"]');
	await expect(empty.getByRole("heading", { name: "Aucune facture pour l'instant" })).toBeVisible();
	await expect(empty.getByRole("button")).toHaveText([
		"Trouver les transactions récurrentes",
		"Ajouter une facture",
	]);
	// The page header steps aside for it.
	await expect(page.getByRole("button", { name: "Ajouter une facture" })).toHaveCount(1);
	await expect(page.getByRole("region", { name: "Ce mois-ci en chiffres" })).toHaveCount(0);

	const detection = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/recurring/detect") && response.request().method() === "POST",
	);
	await empty.getByRole("button", { name: "Trouver les transactions récurrentes" }).click();
	expect((await detection).status()).toBe(200);
	await expect(
		toast(page, /récurrences? détectées?$|^Aucune récurrence détectée$/u).first(),
	).toBeVisible();

	await empty.getByRole("button", { name: "Ajouter une facture" }).click();
	await expect(page.getByRole("dialog", { name: "Ajouter une facture" })).toBeVisible();
});

test("with no transaction either, the page says to connect a bank or import a file", async ({
	page,
}) => {
	await emptyHousehold(page, false);
	await visit(page);

	const empty = page.locator('[data-slot="empty-state"]');
	await expect(empty).toContainText("Connectez une banque ou importez un relevé");
	await expect(empty.getByRole("button")).toHaveText(["Ajouter une facture"]);
});

test("an income alone is no bill: the page still says it has none", async ({ page }) => {
	// The bills overview lists no income; the recurring list holds one, active.
	await emptyHousehold(page, true, [{ id: "salaire", status: "active", billType: "income" }]);
	await visit(page);

	await expect(
		page.locator('[data-slot="empty-state"]').getByRole("heading", {
			name: "Aucune facture pour l'instant",
		}),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Ajouter une facture" })).toHaveCount(1);
});
