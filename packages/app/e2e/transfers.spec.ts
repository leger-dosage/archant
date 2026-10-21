import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { randomInt } from "node:crypto";

import { daysAgo, euros, expect, sgml, test, uniqueName } from "./fixtures.ts";

// Stories 5.1, 5.2 and 27.1: mark two transactions as a transfer, by hand or
// as the matcher proposes on creation. One database serves the whole run and
// matching reads every unmatched line of it, so each test uses an amount of
// its own, and labels sharing a unique prefix it lists by.

const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

const rowButton = (page: Page, label: string) =>
	rowItem(page, label).locator("button[data-transaction-id]");

const sheet = (page: Page) => page.getByRole("dialog", { name: "Modifier l'opération" });

const picker = (page: Page) => page.getByRole("dialog", { name: "Rapprocher un virement" });

/** The transfer's own drawer, named as Sure's `Transfer#name`. */
const drawer = (page: Page) => page.getByRole("dialog", { name: /^(?:Virement|Paiement) vers /u });

/** Opens the transfer row `label` in its drawer, with « Détails » unfolded. */
async function openDrawer(page: Page, label: string) {
	await rowButton(page, label).click();
	await drawer(page).getByText("Détails", { exact: true }).click();
}

/** Closes the drawer by its button: `Escape` would first go to a picker that keeps the focus. */
async function closeDrawer(page: Page) {
	await drawer(page).getByRole("button", { name: "Fermer", exact: true }).click();
	await expect(drawer(page)).toBeHidden();
}

const categoryButtons = (page: Page, label: string) =>
	rowItem(page, label).getByRole("button", { name: /^Catégorie/u });

/**
 * Opens the row's transfer drawer, checks « Détails » has no « Catégorie »,
 * as Sure's `categorizable?`, and closes it.
 */
async function expectNoCategoryField(page: Page, label: string) {
	await openDrawer(page, label);
	// « Étiquettes » first, so the absent field is not checked before « Détails » opens.
	await expect(drawer(page).getByRole("button", { name: "Étiquettes", exact: true })).toBeVisible();
	await expect(drawer(page).getByRole("button", { name: "Catégorie", exact: true })).toHaveCount(0);
	await closeDrawer(page);
}

/** The open sheet has neither « Marchand » nor « Étiquettes », as Sure's drawer on a transfer side. */
async function expectNoMerchantOrTags(page: Page) {
	await expect(sheet(page).getByRole("button", { name: "Marchand", exact: true })).toHaveCount(0);
	await expect(sheet(page).getByRole("button", { name: "Étiquettes", exact: true })).toHaveCount(0);
}

const categorySearch = (page: Page) =>
	page.getByRole("combobox", { name: "Rechercher une catégorie" });

/**
 * An amount in euros no other test uses, as typed: `51723,45`. Matching
 * reads every unmatched line of the shared database, so a leftover row of the
 * same amount within four days, from another spec drawing 100 to 900 euros,
 * would be proposed in place of the test's own pair when closer or of a lower
 * id, as one was on 2026-10-07. Tens of thousands of euros, to the cent, no
 * spec writes otherwise.
 */
function uniqueAmount(): string {
	return `${randomInt(10_000, 100_000)},${String(randomInt(100)).padStart(2, "0")}`;
}

/** Opens `/transactions` on the rows labelled with `q`, and waits for them. */
async function visitOperations(page: Page, q: string, search = "") {
	await page.goto(`/transactions?q=${encodeURIComponent(q)}${search}`);
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await expect(rowItem(page, q).first()).toBeVisible();
}

/**
 * Opens the list on the inflow alone: with its outflow on the page, a
 * transfer shows once, as its outflow, as Sure's `entries_by_date`.
 */
async function expectInflow(page: Page, into: string, text: string) {
	await visitOperations(page, into);
	await expect(rowButton(page, into)).toContainText(text);
}

/** « Compte courant » and « Livret A », each with a name no other test uses. */
async function openHousehold(api: Api) {
	const checking = await api.openAccount({ name: uniqueName("Compte courant") });
	const livret = await api.openAccount({ name: uniqueName("Livret A"), kind: "savings" });

	return { checking, livret };
}

/**
 * −amount on the checking account, +amount on the Livret A three days later:
 * a unique pair, which the matcher proposes as the second row arrives.
 * `unlinked` refuses that proposal, as « Ne plus proposer », for the tests
 * that match by hand: a pair dissociated alone would be proposed again by the
 * next line added.
 */
async function moveToSavings(api: Api, prefix: string, options: { unlinked?: boolean } = {}) {
	const household = await openHousehold(api);
	const amount = uniqueAmount();
	const out = `${prefix} départ`;
	const into = `${prefix} arrivée`;
	const outflow = await api.addTransaction(household.checking.id, {
		date: daysAgo(10),
		label: out,
		amount: `-${amount}`,
	});
	const inflow = await api.addTransaction(household.livret.id, {
		date: daysAgo(7),
		label: into,
		amount,
	});

	if (options.unlinked === true) {
		await api.unlinkTransfer(inflow, { never: true });
	}

	return { ...household, amount, out, into, outflow, inflow };
}

test("« Rapprocher un virement » offers the opposite amounts within 30 days, the closest first", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Épargne");
	const { checking, livret, amount, out, into } = await moveToSavings(api, prefix, {
		unlinked: true,
	});
	const late = `${prefix} plus tard`;
	const sameAccount = `${prefix} même compte`;
	await api.addTransaction(livret.id, { date: daysAgo(0), label: late, amount });
	await api.addTransaction(checking.id, { date: daysAgo(9), label: sameAccount, amount });

	await visitOperations(page, prefix);
	await rowButton(page, out).click();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();

	const candidates = picker(page).getByRole("list", { name: "Opérations candidates" });
	await expect(candidates.getByRole("listitem")).toHaveCount(2);
	await expect(candidates.getByRole("listitem").first()).toContainText(into);
	await expect(candidates.getByRole("listitem").last()).toContainText(late);
	await expect(candidates).toContainText(livret.name);
	await expect(candidates).not.toContainText(sameAccount);
});

// Story 11.2: as Sure's `Family::AutoTransferMatchable`, an excluded row or a
// row of a deactivated account is never the other side of a transfer.

test("« Rapprocher un virement » offers neither an excluded row nor a row of a deactivated account", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Écarté");
	const { checking, livret } = await openHousehold(api);
	const closed = await api.openAccount({ name: uniqueName("Ancien livret"), kind: "savings" });
	await api.deactivateAccount(closed.id);
	const amount = uniqueAmount();
	const out = `${prefix} départ`;
	const excluded = `${prefix} exclue`;
	const inactive = `${prefix} inactive`;
	const excludedId = await api.addTransaction(livret.id, {
		date: daysAgo(8),
		label: excluded,
		amount,
	});
	await api.excludeTransaction(excludedId);
	await api.addTransaction(closed.id, { date: daysAgo(9), label: inactive, amount });
	await api.addTransaction(checking.id, { date: daysAgo(10), label: out, amount: `-${amount}` });

	await visitOperations(page, prefix);
	await expect(rowButton(page, out)).not.toContainText("Vers");
	await rowButton(page, out).click();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();

	await expect(
		picker(page).getByText(
			"Aucune opération de montant opposé dans un autre compte à 30 jours près",
		),
	).toBeVisible();
	await expect(picker(page).getByRole("list", { name: "Opérations candidates" })).toHaveCount(0);

	// The excluded row has no candidate either, the outflow included.
	await page.keyboard.press("Escape");
	await expect(picker(page)).toBeHidden();
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();
	await rowButton(page, excluded).click();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();
	await expect(
		picker(page).getByText(
			"Aucune opération de montant opposé dans un autre compte à 30 jours près",
		),
	).toBeVisible();
});

test("an excluded twin does not keep the real pair from linking", async ({ page, api }) => {
	const prefix = uniqueName("Jumeau");
	const { checking, livret } = await openHousehold(api);
	const card = await api.openAccount({
		name: uniqueName("Carte"),
		kind: "credit_card",
		openingBalance: "0",
	});
	const amount = uniqueAmount();
	const out = `${prefix} départ`;
	const into = `${prefix} arrivée`;
	const twinId = await api.addTransaction(card.id, {
		date: daysAgo(5),
		label: `${prefix} jumeau`,
		amount,
	});
	await api.excludeTransaction(twinId);
	await api.addTransaction(livret.id, { date: daysAgo(5), label: into, amount });
	await api.addTransaction(checking.id, { date: daysAgo(6), label: out, amount: `-${amount}` });

	await visitOperations(page, prefix);

	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
});

test("picking the candidate links both rows, each naming the other account", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Épargne");
	const { checking, livret, out, into } = await moveToSavings(api, prefix, { unlinked: true });

	await visitOperations(page, prefix);
	await rowButton(page, out).click();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();
	await picker(page)
		.getByRole("button", { name: new RegExp(into) })
		.click();

	await expect(picker(page)).toBeHidden();
	await expect(sheet(page).getByText(`Vers ${livret.name}`)).toBeVisible();
	await expect(sheet(page).getByRole("button", { name: "Dissocier" })).toBeVisible();
	// The category is not a transfer's to pick.
	await expect(sheet(page).getByRole("button", { name: "Catégorie" })).toBeHidden();
	await expectNoMerchantOrTags(page);
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await expect(rowItem(page, out).getByText("Virement", { exact: true })).toBeVisible();
	await expect(rowItem(page, out).getByRole("button", { name: /^Catégorie/ })).toHaveCount(0);
	// Both sides on the page, the pair shows once, as its outflow.
	await expect(rowItem(page, into)).toHaveCount(0);
	await expectInflow(page, into, `Depuis ${checking.name}`);
	await expect(rowItem(page, into).getByText("Virement", { exact: true })).toBeVisible();
});

test("two lines 20 days apart, paired by hand, make a confirmed transfer", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Chèque");
	const { checking, livret } = await openHousehold(api);
	const amount = uniqueAmount();
	const out = `${prefix} départ`;
	const into = `${prefix} arrivée`;
	// Too far apart for the matcher's 4 days, within a pair by hand's 30.
	await api.addTransaction(checking.id, { date: daysAgo(25), label: out, amount: `-${amount}` });
	await api.addTransaction(livret.id, { date: daysAgo(5), label: into, amount });

	await visitOperations(page, prefix);
	await expect(rowButton(page, out)).not.toContainText("Vers");
	await rowButton(page, out).click();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();
	await picker(page)
		.getByRole("button", { name: new RegExp(into) })
		.click();
	await expect(picker(page)).toBeHidden();
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

	await expect(rowButton(page, out)).toContainText("Virement interne");
	await expect(rowButton(page, out)).not.toContainText("Correspondance automatique");
	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await expectInflow(page, into, "Virement interne");
	await expect(rowButton(page, into)).not.toContainText("Correspondance automatique");
});

test("a payment into a credit card is linked on creation as « Paiement », as Sure names a liability payment", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Carte");
	const checking = await api.openAccount({ name: uniqueName("Compte courant") });
	const card = await api.openAccount({
		name: uniqueName("Carte"),
		kind: "credit_card",
		openingBalance: "0",
	});
	const amount = uniqueAmount();
	const out = `${prefix} prélèvement`;
	const into = `${prefix} remboursement`;
	await api.addTransaction(checking.id, { date: daysAgo(3), label: out, amount: `-${amount}` });
	await api.addTransaction(card.id, { date: daysAgo(3), label: into, amount });

	await visitOperations(page, prefix);

	await expect(rowItem(page, out).getByText("Paiement", { exact: true })).toBeVisible();
	await expect(rowButton(page, out)).not.toContainText("Paiement ·");
	await expect(rowButton(page, out)).toContainText(`Vers ${card.name}`);
	// Neither side is counted by the dashboard, so neither has a category.
	await expect(categoryButtons(page, out)).toHaveCount(0);
	await expectNoCategoryField(page, out);
	await expectInflow(page, into, `Depuis ${checking.name}`);
	await expect(rowItem(page, into).getByText("Paiement", { exact: true })).toBeVisible();
	await expect(categoryButtons(page, into)).toHaveCount(0);
	await expectNoCategoryField(page, into);
});

test("a repayment into a loan shows « Remboursement de prêt », lowers what it owes and counts in « Dépenses » under the category picked on it", async ({
	page,
	api,
}) => {
	// June 2024 belongs to this test alone, so its totals and pair are exact.
	const opened = { openingDate: "2024-05-01" } as const;
	const prefix = uniqueName("Prêt");
	const checking = await api.openAccount({
		...opened,
		name: uniqueName("Compte courant"),
		openingBalance: "0",
	});
	const loan = await api.openAccount({
		...opened,
		name: uniqueName("Prêt immobilier"),
		kind: "mortgage",
		openingBalance: "180 000,00",
	});
	const out = `${prefix} échéance`;
	const into = `${prefix} remboursement`;
	const groceries = `${prefix} courses`;
	const outId = await api.addTransaction(checking.id, {
		date: "2024-06-05",
		label: out,
		amount: "-1 200,00",
	});
	const intoId = await api.addTransaction(loan.id, {
		date: "2024-06-05",
		label: into,
		amount: "1 200,00",
	});
	await api.addTransaction(checking.id, { date: "2024-06-05", label: groceries, amount: "-50,00" });
	// Proposed on creation; refused and matched again as « Rapprocher » would.
	// Unpaired in between, the inflow takes a category of its own, which the
	// pair then hides behind its outflow's.
	await api.unlinkTransfer(outId, { never: true });
	const own = await api.createCategory({ name: uniqueName("Divers") });
	await api.categorise([intoId], own.id);
	await api.matchTransfer(outId, intoId);

	const housing = await api.createCategory({ name: uniqueName("Logement") });

	await visitOperations(page, prefix);
	// The dashboard counts the outflow in its category, so the row shows it,
	// and the kind moves to the subtitle. Both sides on the page, the pair
	// shows once, as its outflow, and the day's total leaves it out, as Sure's.
	await expect(rowButton(page, out)).toContainText(`Remboursement de prêt · Vers ${loan.name}`);
	await expect(
		rowItem(page, out).getByRole("button", { name: "Catégorie : Sans catégorie" }),
	).toBeVisible();
	await expect(rowItem(page, into)).toHaveCount(0);
	const day = page.getByRole("main").locator('[data-slot="inset-group"]');
	await expect(day).toHaveCount(1);
	const dayHeader = day.getByRole("heading", { level: 2 }).locator("../..");
	await expect(dayHeader).toContainText("2 opérations");
	await expect(dayHeader).toContainText(euros(-5000));
	await expect(dayHeader).not.toContainText(euros(-125_000));

	await openDrawer(page, out);
	await expect(drawer(page).getByRole("button", { name: "Catégorie", exact: true })).toBeEnabled();
	await closeDrawer(page);

	await rowItem(page, out).getByRole("button", { name: "Catégorie : Sans catégorie" }).click();
	await categorySearch(page).fill(housing.name);
	await page.getByRole("option", { name: housing.name }).click();
	await expect(
		rowItem(page, out).getByRole("button", { name: `Catégorie : ${housing.name}` }),
	).toBeVisible();

	// Its outflow on another page, the inflow shows: the outflow's category,
	// muted, and opens the same drawer, which sets it, as Sure's.
	await visitOperations(page, into);
	await expect(rowButton(page, into)).toContainText(
		`Remboursement de prêt · Depuis ${checking.name}`,
	);
	const muted = rowItem(page, into).getByRole("button", {
		name: `Catégorie : ${housing.name}`,
	});
	await expect(muted).toHaveAttribute("aria-disabled", "true");
	await expect(rowItem(page, into)).not.toContainText(own.name);
	await muted.hover();
	await expect(
		page.getByRole("tooltip").filter({
			hasText: "La catégorie appartient au côté sortant de ce transfert et ne se modifie que là.",
		}),
	).toBeVisible();
	await expect(muted).toBeDisabled();
	const day2 = page.getByRole("main").locator('[data-slot="inset-group"]');
	await expect(day2.getByRole("heading", { level: 2 }).locator("../..")).not.toContainText("€");

	await openDrawer(page, into);
	await expect(drawer(page).getByRole("button", { name: "Catégorie", exact: true })).toHaveText(
		housing.name,
	);
	await closeDrawer(page);

	await page.goto(`/accounts/${loan.id}`);
	await expect(page.getByRole("region", { name: loan.name, exact: true })).toContainText(
		euros(17_880_000),
	);

	await page.goto("/?month=2024-06");
	const june = page.getByRole("region", { name: "Flux de juin 2024" });
	await expect(june.getByRole("group", { name: "Dépenses", exact: true })).toContainText(
		euros(-125_000),
	);
	await expect(
		june
			.getByRole("list", { name: "Dépenses par catégorie" })
			.getByRole("link", { name: housing.name }),
	).toContainText(euros(-120_000));

	// Dissociated, the outflow is a standard row that keeps its category; the
	// pair refused above, no later line proposes it again.
	await api.unlinkTransfer(outId);
	await visitOperations(page, prefix);
	await expect(
		rowItem(page, out).getByRole("button", { name: `Catégorie : ${housing.name}` }),
	).toBeVisible();
	await expect(rowButton(page, out)).not.toContainText("Vers");
});

test("a contribution into a PEA shows « Versement », raises its value and counts in « Dépenses » under the category picked in its drawer", async ({
	page,
	api,
}) => {
	// July 2024 belongs to this test alone, so its totals and pair are exact.
	const opened = { openingDate: "2024-06-01" } as const;
	const prefix = uniqueName("PEA");
	const checking = await api.openAccount({
		...opened,
		name: uniqueName("Compte courant"),
		openingBalance: "0",
	});
	const pea = await api.openAccount({
		...opened,
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "25 000,00",
	});
	const out = `${prefix} versement`;
	const into = `${prefix} reçu`;
	const outId = await api.addTransaction(checking.id, {
		date: "2024-07-05",
		label: out,
		amount: "-500,00",
	});
	const intoId = await api.addTransaction(pea.id, {
		date: "2024-07-05",
		label: into,
		amount: "500,00",
	});
	// Proposed on creation; refused and matched again as « Rapprocher » would.
	await api.unlinkTransfer(outId, { never: true });
	await api.matchTransfer(outId, intoId);

	const savings = await api.createCategory({ name: uniqueName("Épargne") });

	await visitOperations(page, prefix);
	await expect(rowButton(page, out)).toContainText(`Versement · Vers ${pea.name}`);
	// Shown once, as its outflow.
	await expect(rowItem(page, into)).toHaveCount(0);

	await openDrawer(page, out);
	const field = drawer(page).getByRole("button", { name: "Catégorie", exact: true });
	await expect(field).toHaveText("Sans catégorie");
	await field.click();
	await categorySearch(page).fill(savings.name);
	await page.getByRole("option", { name: savings.name }).click();
	// Saved at once, as Sure's `auto-submit-form`.
	await expect(field).toHaveText(savings.name);
	await closeDrawer(page);
	await expect(
		rowItem(page, out).getByRole("button", { name: `Catégorie : ${savings.name}` }),
	).toBeVisible();

	await visitOperations(page, into);
	await expect(rowButton(page, into)).toContainText(`Versement · Depuis ${checking.name}`);
	await expect(
		rowItem(page, into).getByRole("button", { name: `Catégorie : ${savings.name}` }),
	).toHaveAttribute("aria-disabled", "true");
	await openDrawer(page, into);
	await expect(drawer(page).getByRole("button", { name: "Catégorie", exact: true })).toHaveText(
		savings.name,
	);
	await closeDrawer(page);

	await page.goto(`/accounts/${pea.id}`);
	await expect(page.getByRole("region", { name: pea.name, exact: true })).toContainText(
		euros(2_550_000),
	);

	await page.goto("/?month=2024-07");
	await expect(
		page
			.getByRole("region", { name: "Flux de juillet 2024" })
			.getByRole("group", { name: "Dépenses", exact: true }),
	).toContainText(euros(-50_000));
});

test("« Supprimer le virement » gives both rows their category chip back and drops the caption", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Épargne");
	// Paired by hand after a refusal, so no later line proposes it again once dissociated.
	const { checking, livret, out, into, outflow, inflow } = await moveToSavings(api, prefix, {
		unlinked: true,
	});
	await api.matchTransfer(outflow, inflow);

	await visitOperations(page, prefix);
	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await expect(categoryButtons(page, out)).toHaveCount(0);
	await expectNoCategoryField(page, out);
	await expectInflow(page, into, `Depuis ${checking.name}`);
	await expect(categoryButtons(page, into)).toHaveCount(0);
	await rowButton(page, into).click();
	await expect(drawer(page).getByRole("link", { name: checking.name })).toBeVisible();
	await drawer(page).getByText("Paramètres", { exact: true }).click();
	await drawer(page).getByRole("button", { name: "Supprimer le virement" }).click();
	const confirmation = page.getByRole("alertdialog", {
		name: "Voulez-vous vraiment supprimer ce virement ?",
	});
	await confirmation.getByRole("button", { name: "Supprimer le virement" }).click();
	await expect(page.getByText("Virement supprimé")).toBeVisible();
	await expect(drawer(page)).toBeHidden();

	// Two standard rows again, both on the page.
	await visitOperations(page, prefix);
	await expect(
		rowItem(page, out).getByRole("button", { name: "Catégorie : Sans catégorie" }),
	).toBeVisible();
	await expect(
		rowItem(page, into).getByRole("button", { name: "Catégorie : Sans catégorie" }),
	).toBeVisible();
	await expect(rowButton(page, out)).not.toContainText("Vers");
	await expect(rowButton(page, into)).not.toContainText("Depuis");
	await expect(rowItem(page, out).getByText("Virement", { exact: true })).toHaveCount(0);
});

test("« Sens » lists transfers, a loan payment's outflow among them, expenses or income alone, and survives a reload", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Sens");
	const { checking, out, into } = await moveToSavings(api, prefix);
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "mortgage",
		openingBalance: "180 000,00",
		openingDate: daysAgo(30),
	});
	const repaid = uniqueAmount();
	const instalment = `${prefix} échéance`;
	const received = `${prefix} remboursement`;
	const instalmentId = await api.addTransaction(checking.id, {
		date: daysAgo(4),
		label: instalment,
		amount: `-${repaid}`,
	});
	const receivedId = await api.addTransaction(loan.id, {
		date: daysAgo(4),
		label: received,
		amount: repaid,
	});
	// Proposed on creation; refused and matched again as « Rapprocher » would.
	await api.unlinkTransfer(instalmentId, { never: true });
	await api.matchTransfer(instalmentId, receivedId);
	const spent = `${prefix} café`;
	const earned = `${prefix} prime`;
	// Amounts of their own: another test's opposite row would be linked to them.
	await api.addTransaction(checking.id, {
		date: daysAgo(2),
		label: spent,
		amount: `-${uniqueAmount()}`,
	});
	await api.addTransaction(checking.id, {
		date: daysAgo(2),
		label: earned,
		amount: uniqueAmount(),
	});
	const listed = page.getByRole("main").getByRole("listitem");

	/** Swaps the « Sens » filter from `previous` to `direction`. */
	const filterOn = async (direction: string, previous?: string) => {
		await page.getByRole("button", { name: "Filtrer" }).click();
		const menu = page.getByRole("dialog");
		await menu.getByRole("button", { name: "Sens", exact: true }).click();
		if (previous !== undefined) {
			await menu.getByRole("checkbox", { name: previous }).uncheck();
		}
		await menu.getByRole("checkbox", { name: direction }).check();
		await menu.getByRole("button", { name: "Appliquer" }).click();
		await expect(
			page.getByRole("button", { name: `Retirer le filtre ${direction}` }),
		).toBeVisible();
	};

	await visitOperations(page, prefix);
	// Each pair shows once, as its outflow.
	await expect(listed).toHaveCount(4);

	// Every transfer side, as Sure's type filter: a loan payment's outflow
	// still counts in the dashboard's « Dépenses », never in this one. Both
	// sides of each pair match, and each pair shows once.
	await filterOn("Virements");
	await expect(listed).toHaveCount(2);
	await expect(rowItem(page, out)).toBeVisible();
	await expect(rowItem(page, into)).toHaveCount(0);
	await expect(rowItem(page, instalment)).toBeVisible();
	await expect(rowItem(page, received)).toHaveCount(0);

	await filterOn("Dépenses", "Virements");
	await expect(listed).toHaveCount(1);
	await expect(rowItem(page, spent)).toBeVisible();

	await filterOn("Revenus", "Dépenses");
	await expect(listed).toHaveCount(1);
	await expect(rowItem(page, earned)).toBeVisible();

	await page.reload();
	await expect(page.getByRole("button", { name: "Retirer le filtre Revenus" })).toBeVisible();
	await expect(listed).toHaveCount(1);
	await expect(rowItem(page, earned)).toBeVisible();
});

test("adding the other side of a move links both rows without a match by hand", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Épargne");
	const { checking, livret, out, into } = await moveToSavings(api, prefix);

	await visitOperations(page, prefix);

	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await expect(rowItem(page, out).getByText("Virement", { exact: true })).toBeVisible();
	await expectInflow(page, into, `Depuis ${checking.name}`);
	await expect(rowItem(page, into).getByText("Virement", { exact: true })).toBeVisible();
});

test("an OFX file adding the other side links both rows once confirmed", async ({ page, api }) => {
	const prefix = uniqueName("Import");
	const { checking, livret } = await openHousehold(api);
	const amount = uniqueAmount();
	const out = `${prefix} départ`;
	const into = `${prefix} arrivée`;
	await api.addTransaction(checking.id, { date: daysAgo(10), label: out, amount: `-${amount}` });

	await api.importFile(
		livret.id,
		sgml([{ daysAgo: 8, amount, label: into, fitid: uniqueName("FIT") }]),
	);
	await visitOperations(page, prefix);

	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await expectInflow(page, into, `Depuis ${checking.name}`);
});

test("a row with two candidates is proposed with the closer one, the other left alone", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Possible");
	const { checking, livret } = await openHousehold(api);
	const card = await api.openAccount({
		name: uniqueName("Carte"),
		kind: "credit_card",
		openingBalance: "0",
	});
	const amount = uniqueAmount();
	const out = `${prefix} départ`;
	const toLivret = `${prefix} livret`;
	const toCard = `${prefix} carte`;
	await api.addTransaction(livret.id, { date: daysAgo(5), label: toLivret, amount });
	await api.addTransaction(card.id, { date: daysAgo(3), label: toCard, amount });
	await api.addTransaction(checking.id, { date: daysAgo(6), label: out, amount: `-${amount}` });

	await visitOperations(page, prefix);

	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await expect(rowButton(page, out)).toContainText("Correspondance automatique");
	await expect(rowItem(page, toLivret)).toHaveCount(0);
	await expect(rowButton(page, toCard)).not.toContainText("Depuis");
	await expect(
		rowItem(page, toCard).getByRole("button", { name: "Confirmer la correspondance" }),
	).toHaveCount(0);
	await expectInflow(page, toLivret, `Depuis ${checking.name}`);
});

test("a proposal is confirmed from the list, and another rejected, never proposed again", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Proposé");
	const kept = await moveToSavings(api, `${prefix} gardé`);
	const refused = await moveToSavings(api, `${prefix} refusé`);

	await visitOperations(page, prefix);
	await Promise.all(
		[kept.out, refused.out].map(async (label) =>
			expect(rowButton(page, label)).toContainText("Correspondance automatique"),
		),
	);
	await expect(rowItem(page, kept.into)).toHaveCount(0);
	await expect(rowItem(page, refused.into)).toHaveCount(0);

	await rowItem(page, kept.out)
		.getByRole("button", { name: "Confirmer la correspondance" })
		.click();
	await expect(page.getByText("Virement mis à jour")).toBeVisible();
	await expect(rowButton(page, kept.out)).not.toContainText("Correspondance automatique");
	await expect(rowButton(page, kept.out)).toContainText("Virement interne");
	await expect(
		rowItem(page, kept.out).getByRole("button", { name: /la correspondance$/u }),
	).toHaveCount(0);
	await expect(rowButton(page, kept.out)).toContainText(`Vers ${kept.livret.name}`);

	await rowItem(page, refused.out)
		.getByRole("button", { name: "Rejeter la correspondance" })
		.click();
	await expect(page.getByText("Virement dissocié, il ne sera plus proposé")).toBeVisible();
	await expect(rowButton(page, refused.out)).not.toContainText("Vers");
	await expect(rowButton(page, refused.into)).not.toContainText("Depuis");

	// Any later line runs the matcher again; the refused pair stays apart.
	await api.addTransaction(refused.checking.id, {
		date: daysAgo(2),
		label: `${prefix} café`,
		amount: `-${uniqueAmount()}`,
	});
	await page.reload();
	await expect(rowItem(page, refused.out)).toBeVisible();
	await expect(rowButton(page, refused.out)).not.toContainText("Vers");
	await expect(rowButton(page, kept.out)).toContainText(`Vers ${kept.livret.name}`);
});

test("« Rejeter la correspondance » undoes a proposal for good, and the picker still offers the pair", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Refus");
	const { checking, livret, out, into } = await moveToSavings(api, prefix);

	await visitOperations(page, prefix);
	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await rowItem(page, out).getByRole("button", { name: "Rejeter la correspondance" }).click();
	await expect(page.getByText("Virement dissocié, il ne sera plus proposé")).toBeVisible();

	// Any later line runs the matcher again; the refused pair stays apart.
	await api.addTransaction(checking.id, {
		date: daysAgo(2),
		label: `${prefix} café`,
		amount: `-${uniqueAmount()}`,
	});
	await page.reload();
	await expect(rowItem(page, out)).toBeVisible();

	/** `label` is a standard row again, and its picker, as Sure's, still offers `other`. */
	const standardOffering = async (label: string, other: string) => {
		await expect(
			rowItem(page, label).getByRole("button", { name: "Catégorie : Sans catégorie" }),
		).toBeVisible();
		await expect(rowItem(page, label).getByText("Virement", { exact: true })).toHaveCount(0);
		await rowButton(page, label).click();
		await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();
		await expect(picker(page).getByRole("list", { name: "Opérations candidates" })).toContainText(
			other,
		);
		await page.keyboard.press("Escape");
		await expect(picker(page)).toBeHidden();
		await page.keyboard.press("Escape");
		await expect(sheet(page)).toBeHidden();
	};

	await standardOffering(out, into);
	await standardOffering(into, out);
});

test("« Virement » creates both sides of a transfer and its fee, as Sure's transfer form", async ({
	page,
	api,
}) => {
	const from = await api.openAccount({ name: uniqueName("Courant"), openingBalance: "500,00" });
	const to = await api.openAccount({
		name: uniqueName("Livret"),
		kind: "savings",
		openingBalance: "0,00",
	});
	const amount = uniqueAmount();
	const cents = Number(amount.replace(",", ""));

	await page.goto("/transactions");
	await page.getByRole("button", { name: "Ajouter une opération", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Ajouter une opération" })
		.getByRole("button", { name: "Virement", exact: true })
		.click();
	const form = page.getByRole("dialog", { name: "Nouveau virement" });
	await expect(form.getByRole("button", { name: "Virement", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	await form.getByRole("combobox", { name: "De" }).click();
	await page.getByRole("option", { name: from.name, exact: true }).click();
	await form.getByRole("combobox", { name: "Vers" }).click();
	await page.getByRole("option", { name: to.name, exact: true }).click();
	await expect(form.getByLabel("Date", { exact: true })).toBeVisible();
	await expect(form.getByRole("button", { name: "Étiquettes" })).toBeVisible();
	await form.getByRole("textbox", { name: "Montant", exact: true }).fill(amount);
	await expect(form.getByRole("textbox", { name: "Frais de transfert sortant" })).toBeHidden();
	await form.getByText("Frais bancaires").click();
	await expect(form.getByRole("textbox", { name: "Frais de transfert entrant" })).toBeVisible();
	await form.getByRole("textbox", { name: "Frais de transfert sortant" }).fill("1,50");
	await form.getByRole("button", { name: "Créer le virement" }).click();
	await expect(form).toBeHidden();

	// Exact, as the fee's label holds the outflow's.
	const row = (label: string) =>
		page
			.getByRole("main")
			.getByRole("listitem")
			.filter({ has: page.getByText(label, { exact: true }) });

	await visitOperations(page, to.name);
	await expect(row(`Virement vers ${to.name}`)).toContainText(euros(-cents));
	await expect(row(`Frais de virement — Virement vers ${to.name}`)).toContainText(euros(-150));
	await visitOperations(page, from.name);
	await expect(row(`Virement depuis ${from.name}`)).toContainText(euros(cents));
});

test("a transfer row opens the transfer's drawer, which tags both sides, keeps a note and deletes the transfer, as Sure's", async ({
	page,
	api,
}) => {
	const from = await api.openAccount({ name: uniqueName("Courant"), openingBalance: "500,00" });
	const to = await api.openAccount({
		name: uniqueName("Livret"),
		kind: "savings",
		openingBalance: "0,00",
	});
	const tag = await api.createTag();
	const outflow = `Virement vers ${to.name}`;
	const inflow = `Virement depuis ${from.name}`;
	const fee = `Frais de virement — ${outflow}`;
	await api.createTransfer({
		fromAccountId: from.id,
		toAccountId: to.id,
		date: daysAgo(3),
		amount: "120,00",
		sourceFee: "1,50",
	});
	const exact = (label: string) =>
		page
			.getByRole("main")
			.getByRole("listitem")
			.filter({ has: page.getByText(label, { exact: true }) });

	await visitOperations(page, to.name);
	await exact(outflow).locator("button[data-transaction-id]").click();

	// « Aperçu », open as Sure's: each side, the source fee and its total.
	await expect(drawer(page)).toHaveAccessibleName(outflow);
	await expect(drawer(page).getByRole("link", { name: from.name })).toBeVisible();
	await expect(drawer(page).getByRole("link", { name: to.name })).toBeVisible();
	await expect(drawer(page).getByText("Frais d'origine")).toBeVisible();
	await expect(drawer(page).getByText(euros(-12_150))).toBeVisible();
	await expect(drawer(page).getByText("Frais de destination")).toHaveCount(0);

	await drawer(page).getByText("Détails", { exact: true }).click();
	// An internal move takes no category, as Sure's `categorizable?`.
	await expect(drawer(page).getByRole("button", { name: "Catégorie", exact: true })).toHaveCount(0);
	await drawer(page).getByRole("button", { name: "Étiquettes", exact: true }).click();
	await page.getByRole("combobox", { name: "Rechercher une étiquette" }).fill(tag.name);
	await page.getByRole("option", { name: tag.name }).click();
	// Its own button folds the picker again, the choice saved.
	await drawer(page).getByRole("button", { name: "Étiquettes", exact: true }).click();
	await expect(page.getByRole("combobox", { name: "Rechercher une étiquette" })).toBeHidden();
	await expect(drawer(page).getByRole("button", { name: "Étiquettes", exact: true })).toHaveText(
		tag.name,
	);
	await drawer(page).getByLabel("Notes").fill("Épargne de précaution");
	await drawer(page).getByLabel("Notes").blur();
	await closeDrawer(page);

	// Both sides carry the tag; the note is the transfer's, read again on opening.
	await expect(exact(outflow)).toContainText(tag.name);
	await visitOperations(page, from.name);
	await expect(exact(inflow)).toContainText(tag.name);
	await exact(inflow).locator("button[data-transaction-id]").click();
	await drawer(page).getByText("Détails", { exact: true }).click();
	await expect(drawer(page).getByLabel("Notes")).toHaveValue("Épargne de précaution");

	await drawer(page).getByText("Paramètres", { exact: true }).click();
	await drawer(page).getByRole("button", { name: "Supprimer le virement" }).click();
	await page
		.getByRole("alertdialog", { name: "Voulez-vous vraiment supprimer ce virement ?" })
		.getByRole("button", { name: "Supprimer le virement" })
		.click();
	await expect(drawer(page)).toBeHidden();

	// Both sides stay, standard; the fee line goes with the transfer.
	await visitOperations(page, to.name);
	await expect(exact(outflow)).toBeVisible();
	await expect(exact(outflow)).not.toContainText(`Vers ${to.name}`);
	await expect(exact(fee)).toHaveCount(0);
});
