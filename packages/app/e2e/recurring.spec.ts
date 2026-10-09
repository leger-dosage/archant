import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Stories 9.2, 23.1 and 23.5: recurring transactions, listed since Story
// 23.5 in « Toutes les factures » at `/bills?view=all`, detected and cleaned
// from « Réglages › Transactions récurrentes ». One database serves the whole
// run and detection reads every account, so each test finds its rows by a
// label no other test uses.

const PAGE = "/bills?view=all";

const SETTINGS = "/settings/recurring";

const table = (page: Page) => page.getByRole("table", { name: "Toutes les factures" });

const row = (page: Page, label: string) => table(page).getByRole("row").filter({ hasText: label });

const suggestions = (page: Page) =>
	page.getByRole("table", { name: "Nouvelles factures possibles" });

const suggestion = (page: Page, label: string) =>
	suggestions(page).getByRole("row").filter({ hasText: label });

/** Story 12.4: a row's status badge, by its status. */
const badge = (page: Page, label: string, status: string) =>
	row(page, label).locator(`[data-slot="status-badge"][data-status="${status}"]`);

const toast = (page: Page, text: string | RegExp) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

const dayMonth = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	timeZone: "UTC",
});

/** `2026-10-05` as « 5 octobre », as « Prochaine échéance » writes an occurrence's date. */
const spelled = (iso: string) => dayMonth.format(new Date(`${iso}T00:00:00Z`));

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

/** Three monthly rows of `label`, one amount each when `amount` lists three. */
async function addMonthly(
	api: Api,
	accountId: string,
	label: string,
	amount: string | readonly string[],
	day: number,
) {
	const { dates, next } = monthly(day);

	await Promise.all(
		dates.map((date, index) =>
			api.addTransaction(accountId, {
				date,
				label,
				amount: typeof amount === "string" ? amount : amount[index]!,
			}),
		),
	);

	return next;
}

/** Adds a suggestion to the followed series, as its « Ajouter la facture » does. */
async function addSuggestion(page: Page, label: string) {
	await suggestion(page, label).getByRole("button", { name: "Ajouter la facture" }).click();
	await expect(toast(page, "Facture ajoutée à vos récurrences").first()).toBeVisible();
	await expect(suggestion(page, label)).toHaveCount(0);
}

const openMenu = (page: Page, label: string) =>
	row(page, label)
		.getByRole("button", { name: `Actions pour ${label}` })
		.click();

/** Runs detection from the settings page, which lists the suggestions it found. */
async function detect(page: Page) {
	await settings(page);
	await page.getByRole("button", { name: "Identifier les modèles" }).click();
	await expect(toast(page, /récurrences? détectées?/u).first()).toBeVisible();
}

async function settings(page: Page) {
	if (!page.url().endsWith(SETTINGS)) {
		await page.goto(SETTINGS);
	}

	await expect(
		page.getByRole("heading", { level: 1, name: "Transactions récurrentes" }),
	).toBeVisible();
}

async function visit(page: Page) {
	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 1, name: "Factures" })).toBeVisible();
	await expect(table(page).or(page.getByText("Aucun résultat")).first()).toBeVisible();
}

test("« Détecter » offers monthly rows as possible bills, with their amount and how often they were seen", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Abonnement");
	await addMonthly(api, account.id, label, "-13,99", 5);

	await detect(page);

	const strip = page.getByRole("region", { name: "Nouvelles factures possibles" });
	await expect(strip).toBeVisible();
	await expect(suggestion(page, label)).toContainText(euros(-1399));
	await expect(suggestion(page, label)).toContainText("Vue 3 fois");
	await expect(suggestion(page, label).getByRole("button")).toHaveText([
		"Ce n'est pas une facture",
		"Ajouter la facture",
	]);
	// A suggestion is no followed series yet.
	await visit(page);
	await expect(row(page, label)).toHaveCount(0);
});

test("« Ajouter la facture » lists a suggestion with its type, frequency, amount and next date, by next date", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const early = uniqueName("Abonnement");
	const late = uniqueName("Facture");
	const earlyNext = await addMonthly(api, account.id, early, "-13,99", 5);
	const lateNext = await addMonthly(api, account.id, late, "-65,00", 20);

	await detect(page);
	await addSuggestion(page, early);
	await addSuggestion(page, late);
	await visit(page);

	const first = row(page, early);
	await expect(first).toContainText("Mensuelle");
	await expect(first).toContainText(euros(-1399));
	// A monthly bill's equivalent is its own amount: not said twice.
	await expect(first).not.toContainText("/mois");
	// History paid by its rows, the next date is the open occurrence to come.
	await expect(first).toContainText(`À payer le ${spelled(earlyNext)}`);
	await expect(first).toContainText("Active");
	await expect(
		badge(page, early, "recurringActive").locator("svg.lucide-circle-check"),
	).toBeVisible();
	// The name's letter icon.
	const icons = first.locator('[data-slot="tinted-icon"]');
	await expect(icons).toHaveCount(1);
	await expect(icons.first()).toHaveText(early.charAt(0).toLocaleUpperCase("fr"));
	await expect(row(page, late)).toContainText(euros(-6500));
	await expect(row(page, late)).toContainText(`À payer le ${spelled(lateNext)}`);

	const labels = await table(page).getByRole("row").allInnerTexts();
	const at = (label: string) => labels.findIndex((text) => text.includes(label));
	expect(at(early)).toBeGreaterThan(0);
	expect(at(late)).toBeGreaterThan(0);
	expect(at(early) < at(late)).toBe(earlyNext < lateNext);
});

test("an amount that moves by a few cents reads as its range in the suggestion, and as its amount once followed", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Prêt");
	await addMonthly(api, account.id, label, ["-571,29", "-571,36", "-571,22"], 7);

	await detect(page);

	const range = `varie de ${euros(57_122)} à ${euros(57_136)}`;
	await expect(suggestion(page, label)).toContainText(range);

	await addSuggestion(page, label);
	await visit(page);

	// Sure's `all.html.erb` shows the latest amount; the band stays for the drawer.
	await expect(row(page, label)).toContainText(euros(-57_122));
	await expect(row(page, label)).not.toContainText("varie de");
});

test("« Ce n'est pas une facture » removes a suggestion for good", async ({ page, api }) => {
	const account = await openAccount(api);
	const label = uniqueName("Salle de sport");
	await addMonthly(api, account.id, label, "-29,90", 8);

	await detect(page);
	await suggestion(page, label).getByRole("button", { name: "Ce n'est pas une facture" }).click();

	await expect(toast(page, "Écartée. Elle ne sera plus proposée.")).toBeVisible();
	await expect(suggestion(page, label)).toHaveCount(0);

	await detect(page);
	await page.reload();
	await settings(page);
	await expect(suggestion(page, label)).toHaveCount(0);
	// Dismissed, it is ended: « Terminée » lists it, never as a bill to pay.
	await page.goto(`${PAGE}&status=ended&q=${encodeURIComponent(label)}`);
	await expect(row(page, label)).toContainText("Terminée");
	await page.goto(`${PAGE}&status=overdue&q=${encodeURIComponent(label)}`);
	await expect(page.getByText("Aucun résultat")).toBeVisible();
});

test("« Mettre en pause » shows « En pause », and « Reprendre » « Active » again", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Assurance");
	await addMonthly(api, account.id, label, "-32,50", 12);

	await detect(page);
	await addSuggestion(page, label);
	await visit(page);

	await openMenu(page, label);
	await page.getByRole("menuitem", { name: "Mettre en pause" }).click();

	await expect(toast(page, "Récurrence mise en pause")).toBeVisible();
	await expect(row(page, label)).toContainText("En pause");
	await expect(
		badge(page, label, "recurringInactive").locator("svg.lucide-circle-pause"),
	).toBeVisible();

	await openMenu(page, label);
	await page.getByRole("menuitem", { name: "Reprendre" }).click();

	await expect(toast(page, "Récurrence reprise")).toBeVisible();
	await expect(row(page, label)).toContainText("Active");
	await expect(row(page, label)).not.toContainText("En pause");
});

test("« Supprimer » asks first, then the series is gone and detection never offers it again", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Musique");
	await addMonthly(api, account.id, label, "-10,99", 9);

	await detect(page);
	await addSuggestion(page, label);
	await visit(page);
	await openMenu(page, label);
	await page.getByRole("menuitem", { name: "Supprimer" }).click();

	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText(`Supprimer « ${label} » ?`);
	await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
	await dialog.getByRole("button", { name: "Supprimer" }).click();

	await expect(dialog).toBeHidden();
	await expect(toast(page, "Récurrence supprimée")).toBeVisible();
	// A detected series is ended, so « Terminée » holds it, and no other status.
	await expect(row(page, label)).toContainText("Terminée");

	await detect(page);

	await expect(suggestion(page, label)).toHaveCount(0);
	await visit(page);
	await expect(row(page, label)).toContainText("Terminée");
});

test("« Nettoyer les obsolètes » sits beside « Identifier les modèles » and says what it retired", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	await api.addRecurring(
		await api.addTransaction(account.id, {
			date: daysAgo(1),
			label: uniqueName("Nettoyage"),
			amount: "-5,00",
		}),
	);

	await settings(page);
	await page.getByRole("button", { name: "Nettoyer les obsolètes" }).click();

	await expect(
		toast(page, /^Aucune récurrence obsolète$|récurrences? devenues? inactives?$/u),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Identifier les modèles" })).toBeVisible();
});

test("« Nettoyer les obsolètes » marks a manual series unpaid for six months inactive", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Compte"), openingDate: daysAgo(400) });
	const label = uniqueName("Ancien abonnement");
	await api.addRecurring(
		await api.addTransaction(account.id, { date: daysAgo(200), label, amount: "-7,00" }),
	);

	await settings(page);
	await page.getByRole("button", { name: "Nettoyer les obsolètes" }).click();

	await expect(toast(page, /^\d+ récurrences? devenues? inactives?$/u)).toBeVisible();
	await visit(page);
	await expect(badge(page, label, "recurringInactive")).toBeVisible();
});

test("« Ajouter aux récurrences » in the sheet lists the transaction as active and manual", async ({
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
	await expect(row(page, label)).toContainText("Active");
	await expect(row(page, label)).toContainText("Ajoutée à la main");
	await expect(row(page, label)).toContainText("Mensuelle");
	// Two neutral badges: a manual series is no alarm.
	await expect(row(page, label).locator('[data-slot="status-badge"]')).toHaveCount(2);
	await expect(badge(page, label, "recurringManual").locator("svg.lucide-hand")).toBeVisible();
	await Promise.all(
		["recurringActive", "recurringManual"].map((status) =>
			expect(badge(page, label, status)).toHaveClass(/\bbg-badge\b/u),
		),
	);

	await detect(page);
	await visit(page);
	await expect(row(page, label)).toContainText("Active");
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

test("the sheet names a transaction's suggested series and links to its drawer, and offers to add one otherwise", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Abonnement");
	const single = uniqueName("Achat");
	await addMonthly(api, account.id, label, "-9,99", 7);
	await api.addTransaction(account.id, { date: daysAgo(2), label: single, amount: "-24,00" });

	await detect(page);

	const sheet = await openSheet(page, label);
	await expect(sheet).toContainText(`Cette opération fait partie de la récurrence « ${label} ».`);
	await expect(sheet.getByRole("button", { name: "Ajouter aux récurrences" })).toHaveCount(0);
	await sheet.getByRole("link", { name: "Voir la facture" }).click();
	await expect(page).toHaveURL(/\/bills\/[^/?]+$/u);
	const drawer = page.getByRole("dialog", { name: label });
	await expect(drawer).toContainText("Prochain paiement");
	// A suggestion is added or dismissed there, never edited, paused or deleted.
	await expect(drawer.getByRole("button", { name: "Ajouter la facture" })).toBeVisible();
	await expect(drawer.getByRole("button", { name: "Modifier" })).toHaveCount(0);
	await drawer.getByRole("button", { name: "Ce n'est pas une facture" }).click();
	await expect(toast(page, "Écartée. Elle ne sera plus proposée.")).toBeVisible();
	// Ended, a detected series has nothing left to delete.
	await expect(drawer.getByRole("button", { name: "Reprendre" })).toBeVisible();
	await expect(drawer.getByRole("button", { name: "Supprimer" })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();

	const other = await openSheet(page, single);
	await expect(other.getByRole("button", { name: "Ajouter aux récurrences" })).toBeVisible();
	await expect(other).not.toContainText("fait partie de la récurrence");
});

// Story 23.2: bills and incomes declared by hand, and their schedules.

const billDialog = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name });

/** Picks `option` in the dialog's select labelled `label`. */
async function choose(
	page: Page,
	dialog: ReturnType<typeof billDialog>,
	label: string,
	option: string,
) {
	await dialog.getByRole("combobox", { name: label }).click();
	await page.getByRole("option", { name: option, exact: true }).click();
}

test("« Ajouter une facture » declares a quarterly bill, listed active and manual, due on its first date", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const name = uniqueName("Eau");
	const due = daysAgo(-20);

	await visit(page);
	await page.getByRole("button", { name: "Ajouter une facture" }).click();
	const dialog = billDialog(page, "Ajouter une facture");
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByLabel("Montant").fill("84,20");
	await dialog.getByLabel("Prochaine échéance").fill(typed(due));
	await choose(page, dialog, "Payée depuis", account.name);
	await choose(page, dialog, "Fréquence", "Trimestrielle");
	await dialog.getByLabel("Lien de paiement").fill("eau.example/payer");
	await dialog.getByRole("button", { name: "Enregistrer la facture" }).click();

	await expect(toast(page, "Facture ajoutée")).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(row(page, name)).toContainText(euros(-8420));
	// 84,20 € four times a year, a month's twelfth of it.
	await expect(row(page, name)).toContainText(`${euros(2807)}/mois`);
	await expect(row(page, name)).toContainText("Trimestrielle");
	await expect(row(page, name)).toContainText(`À payer le ${spelled(due)}`);
	await expect(row(page, name)).toContainText("Active");
	await expect(row(page, name)).toContainText("Ajoutée à la main");

	await openMenu(page, name);
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const edit = billDialog(page, `Modifier ${name}`);
	await expect(edit.getByRole("combobox", { name: "Fréquence" })).toHaveText("Trimestrielle");
	await expect(edit.getByLabel("Lien de paiement")).toHaveValue("https://eau.example/payer");
});

test("« Ajouter un revenu » declares an income, positive, without a link or autopay", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const name = uniqueName("Salaire");

	await visit(page);
	await page.getByRole("button", { name: "Ajouter un revenu" }).click();
	const dialog = billDialog(page, "Ajouter un revenu");
	await expect(dialog.getByRole("combobox", { name: "Fréquence de versement" })).toHaveText(
		"Toutes les 2 semaines",
	);
	await expect(dialog.getByLabel("Lien de paiement")).toHaveCount(0);
	await expect(dialog.getByLabel("Paiement automatique")).toHaveCount(0);
	await dialog.getByLabel("Source").fill(name);
	await dialog.getByLabel("Montant par paie").fill("2 500,00");
	await dialog.getByLabel("Prochaine paie").fill(typed(daysAgo(-5)));
	await choose(page, dialog, "Versé sur", account.name);
	await choose(page, dialog, "Fréquence de versement", "Mensuelle");
	await dialog.getByRole("button", { name: "Enregistrer le revenu" }).click();

	await expect(toast(page, "Revenu ajouté")).toBeVisible();
	await expect(row(page, name)).toContainText(`+${euros(250_000)}`);
});

test("a deposit seen twice is offered as a starting point, and choosing it fills the form", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Loyer perçu");
	const last = daysAgo(3);
	// Far above any other deposit of the run: income starting points come largest first.
	await api.addTransaction(account.id, { date: daysAgo(33), label, amount: "900 000,00" });
	await api.addTransaction(account.id, { date: last, label, amount: "900 000,00" });

	await visit(page);
	await page.getByRole("button", { name: "Ajouter un revenu" }).click();
	const dialog = billDialog(page, "Ajouter un revenu");
	const starts = dialog.getByRole("region", {
		name: "Partir d'un versement récurrent que nous avons repéré",
	});
	await expect(starts.getByRole("button").first()).toContainText(label);
	await expect(starts.getByRole("button").first()).toContainText("2×");
	await starts.getByRole("button", { name: new RegExp(label, "u") }).click();

	await expect(starts).toBeHidden();
	await expect(dialog.getByLabel("Source")).toHaveValue(label);
	await expect(dialog.getByLabel("Montant par paie")).toHaveValue("900000,00");
	await expect(dialog.getByRole("combobox", { name: "Versé sur" })).toHaveText(account.name);
	await dialog.getByRole("button", { name: "Enregistrer le revenu" }).click();

	await expect(toast(page, "Revenu ajouté")).toBeVisible();
	await expect(row(page, label)).toContainText(`+${euros(90_000_000)}`);
});

test("« Créer une facture » in the sheet opens the declare dialog filled from the transaction", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const label = uniqueName("Assurance");
	await api.addTransaction(account.id, { date: daysAgo(4), label, amount: "-32,50" });

	const sheet = await openSheet(page, label);
	await expect(sheet.getByRole("button", { name: "Ajouter aux récurrences" })).toBeVisible();
	await sheet.getByRole("button", { name: "Créer une facture" }).click();
	const dialog = billDialog(page, "Ajouter une facture");
	await expect(dialog.getByLabel("Nom")).toHaveValue(label);
	await expect(dialog.getByLabel("Montant")).toHaveValue("32,50");
	await expect(dialog.getByRole("combobox", { name: "Payée depuis" })).toHaveText(account.name);
	// Its day from today on: next month's, four days ago this month.
	await expect(dialog.getByLabel("Prochaine échéance")).not.toHaveValue("");
	await choose(page, dialog, "Fréquence", "Annuelle");
	await dialog.getByRole("button", { name: "Enregistrer la facture" }).click();

	await expect(toast(page, "Facture ajoutée")).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(sheet).toContainText(`Cette opération fait partie de la récurrence « ${label} ».`);

	await page.keyboard.press("Escape");
	await visit(page);
	await expect(row(page, label)).toContainText(euros(-3250));
});

test("« Modifier » sets a cadence by hand, reads it back, and returns it to its preset", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const name = uniqueName("Électricité");
	await api.declareBill({
		name,
		amount: "65,00",
		accountId: account.id,
		firstDueOn: daysAgo(-10),
	});

	await visit(page);
	const edit = async () => {
		await openMenu(page, name);
		await page.getByRole("menuitem", { name: "Modifier" }).click();

		return billDialog(page, `Modifier ${name}`);
	};

	let dialog = await edit();
	await expect(dialog.getByRole("combobox", { name: "Fréquence" })).toHaveText("Mensuelle");
	await choose(page, dialog, "Fréquence", "Trimestrielle");
	await dialog.getByRole("button", { name: "Enregistrer la facture" }).click();
	await expect(toast(page, "Facture mise à jour")).toBeVisible();
	await expect(dialog).toBeHidden();

	dialog = await edit();
	await expect(dialog.getByRole("combobox", { name: "Fréquence" })).toHaveText("Trimestrielle");
	await choose(page, dialog, "Fréquence", "Intervalle personnalisé");
	await dialog.getByLabel("Intervalle").fill("4");
	await choose(page, dialog, "Unité", "mois");
	await dialog.getByRole("button", { name: "Enregistrer la facture" }).click();
	await expect(dialog).toBeHidden();

	dialog = await edit();
	await expect(dialog.getByRole("combobox", { name: "Fréquence" })).toHaveText(
		"Intervalle personnalisé",
	);
	await expect(dialog.getByLabel("Intervalle")).toHaveValue("4");
	await choose(page, dialog, "Fréquence", "Mensuelle");
	await dialog.getByRole("button", { name: "Enregistrer la facture" }).click();
	await expect(dialog).toBeHidden();

	dialog = await edit();
	await expect(dialog.getByRole("combobox", { name: "Fréquence" })).toHaveText("Mensuelle");

	// A typed name is what the list shows.
	const renamed = uniqueName("Électricité maison");
	await dialog.getByLabel("Nom").fill(renamed);
	await dialog.getByRole("button", { name: "Enregistrer la facture" }).click();
	await expect(dialog).toBeHidden();
	await expect(row(page, renamed)).toContainText(euros(-6500));
	await expect(row(page, name)).toHaveCount(0);
});

test("a link that is not http or https is refused on its field", async ({ page, api }) => {
	const account = await openAccount(api);
	const name = uniqueName("Internet");
	await api.declareBill({ name, amount: "29,99", accountId: account.id, firstDueOn: daysAgo(-3) });

	await visit(page);
	await openMenu(page, name);
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = billDialog(page, `Modifier ${name}`);
	await dialog.getByLabel("Lien de paiement").fill("ftp://box.example");
	await dialog.getByRole("button", { name: "Enregistrer la facture" }).click();

	await expect(dialog.getByLabel("Lien de paiement")).toHaveAttribute("aria-invalid", "true");
	await expect(dialog).toContainText(
		"Lien invalide : une adresse http ou https. Exemple : banque.fr/payer.",
	);
});

/** `iso` a month later, its day clamped to that month's end, as the schedule's monthly rule. */
function nextMonth(iso: string): string {
	const year = Number(iso.slice(0, 4));
	const month = Number(iso.slice(5, 7));
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

	return new Date(Date.UTC(year, month, Math.min(Number(iso.slice(8, 10)), lastDay)))
		.toISOString()
		.slice(0, 10);
}

test("a paid transaction's sheet names the occurrence it pays, and the list shows the next one, then « Payée » once paused", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const name = uniqueName("Prêt");
	const due = daysAgo(1);
	await api.declareBill({ name, amount: "571,29", accountId: account.id, firstDueOn: due });
	await api.addTransaction(account.id, { date: due, label: name, amount: "-571,29" });
	await api.detectRecurring();

	const sheet = await openSheet(page, name);
	await expect(sheet).toContainText(`Paie l'échéance du ${spelled(due)} de ${name}`);
	await page.keyboard.press("Escape");

	await visit(page);
	await expect(row(page, name)).toContainText(`À payer le ${spelled(nextMonth(due))}`);
	// Its next one is open, so it is not « Payée ».
	await page.goto(`${PAGE}&status=paid&q=${encodeURIComponent(name)}`);
	await expect(page.getByText("Aucun résultat")).toBeVisible();
	await visit(page);

	// Paused, it keeps only the occurrence it paid.
	await openMenu(page, name);
	await page.getByRole("menuitem", { name: "Mettre en pause" }).click();
	await expect(toast(page, "Récurrence mise en pause")).toBeVisible();
	await expect(row(page, name)).toContainText("Payée");
	await page.goto(`${PAGE}&status=paid&q=${encodeURIComponent(name)}`);
	await expect(row(page, name)).toBeVisible();
});

test("an occurrence nothing pays reads how many days late it is past its grace days", async ({
	page,
	api,
}) => {
	const account = await openAccount(api);
	const name = uniqueName("Eau");
	await api.declareBill({ name, amount: "84,20", accountId: account.id, firstDueOn: daysAgo(10) });

	await visit(page);

	// In « Prochaine échéance », Sure's one date: no second column contradicts it.
	await expect(row(page, name)).toContainText("10 jours de retard");
	await expect(table(page).getByRole("columnheader")).toHaveText([
		"Nom",
		"Type",
		"Fréquence",
		"Montant",
		"Prochaine échéance",
		"Statut",
		"Actions",
	]);
	await page.goto(`${PAGE}&status=overdue&q=${encodeURIComponent(name)}`);
	await expect(row(page, name)).toBeVisible();
});

// Story 23.5: « Réglages › Transactions récurrentes », and the old address.

test("« Transactions récurrentes » in the settings says when detection runs, and leads to every bill", async ({
	page,
}) => {
	await page.goto("/settings/categories");
	await page
		.getByRole("navigation", { name: "Réglages" })
		.getByRole("link", { name: "Transactions récurrentes" })
		.click();
	await expect(page).toHaveURL(/\/settings\/recurring$/u);
	await settings(page);

	const info = page.getByRole("region", { name: "Détection automatique des modèles" });
	await expect(info).toContainText("après un import ou son annulation");
	await expect(info).toContainText("après la synchronisation d'une banque");
	await expect(info).toContainText("à la première visite");
	await expect(page.getByRole("button", { name: "Identifier les modèles" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Nettoyer les obsolètes" })).toBeVisible();

	await page.getByRole("link", { name: "Ouvrir toutes les factures" }).click();
	await expect(page).toHaveURL(/\/bills\?view=all$/u);
	await expect(table(page).or(page.getByText("Aucun résultat")).first()).toBeVisible();
});

test("the old `/recurring` lands on every bill", async ({ page }) => {
	await page.goto("/recurring");

	await expect(page).toHaveURL(/\/bills\?view=all$/u);
	await expect(page.getByRole("heading", { level: 1, name: "Factures" })).toBeVisible();
});
