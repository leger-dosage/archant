import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { randomInt } from "node:crypto";

import { daysAgo, euros, expect, sgml, test, uniqueName } from "./fixtures.ts";

// Stories 5.1 and 5.2: mark two transactions as a transfer, by hand or on
// creation. One database serves the whole run and candidates are searched
// across every account, so each test uses an amount of its own, and labels
// sharing a unique prefix it lists by.

const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

const rowButton = (page: Page, label: string) =>
	rowItem(page, label).locator("button[data-transaction-id]");

const sheet = (page: Page) => page.getByRole("dialog", { name: "Modifier l'opération" });

const picker = (page: Page) => page.getByRole("dialog", { name: "Rapprocher un virement" });

const categoryButtons = (page: Page, label: string) =>
	rowItem(page, label).getByRole("button", { name: /^Catégorie/u });

/** Opens the row's sheet, checks it has no « Catégorie » field, and closes it. */
async function expectNoCategoryField(page: Page, label: string) {
	await rowButton(page, label).click();
	// The transfer block first, so the absent field is not checked before the sheet opens.
	await expect(sheet(page).getByRole("button", { name: "Dissocier" })).toBeVisible();
	await expect(sheet(page).getByRole("button", { name: "Catégorie", exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();
}

const categorySearch = (page: Page) =>
	page.getByRole("combobox", { name: "Rechercher une catégorie" });

/** An amount in euros no other test uses, as typed: `517,23`. */
function uniqueAmount(): string {
	return `${randomInt(100, 900)},${String(randomInt(100)).padStart(2, "0")}`;
}

/** Opens `/transactions` on the rows labelled with `q`, and waits for them. */
async function visitOperations(page: Page, q: string, search = "") {
	await page.goto(`/transactions?q=${encodeURIComponent(q)}${search}`);
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await expect(rowItem(page, q).first()).toBeVisible();
}

/** « Compte courant » and « Livret A », each with a name no other test uses. */
async function openHousehold(api: Api) {
	const checking = await api.openAccount({ name: uniqueName("Compte courant") });
	const livret = await api.openAccount({ name: uniqueName("Livret A"), kind: "savings" });

	return { checking, livret };
}

/**
 * −amount on the checking account, +amount on the Livret A three days later:
 * a unique pair, which the second row links on creation. `unlinked` undoes
 * that link, for the tests that match by hand.
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
		await api.unlinkTransfer(inflow);
	}

	return { ...household, amount, out, into, outflow, inflow };
}

test("« Rapprocher un virement » offers only the opposite amount within four days", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Épargne");
	const { livret, amount, out, into } = await moveToSavings(api, prefix, { unlinked: true });
	const late = `${prefix} trop tard`;
	await api.addTransaction(livret.id, { date: daysAgo(4), label: late, amount });

	await visitOperations(page, prefix);
	await rowButton(page, out).click();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();

	const candidates = picker(page).getByRole("list", { name: "Opérations candidates" });
	await expect(candidates.getByRole("listitem")).toHaveCount(1);
	await expect(candidates).toContainText(into);
	await expect(candidates).toContainText(livret.name);
	await expect(candidates).not.toContainText(late);

	// Six days from the outflow, and the other +amount shares its account: nothing to offer.
	await page.keyboard.press("Escape");
	await expect(picker(page)).toBeHidden();
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();
	await rowButton(page, late).click();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();
	await expect(
		picker(page).getByText(
			"Aucune opération de montant opposé dans un autre compte à 4 jours près",
		),
	).toBeVisible();
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
	await expect(rowButton(page, out)).not.toContainText("Virement possible");
	await rowButton(page, out).click();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();

	await expect(
		picker(page).getByText(
			"Aucune opération de montant opposé dans un autre compte à 4 jours près",
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
			"Aucune opération de montant opposé dans un autre compte à 4 jours près",
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
	await expect(rowButton(page, out)).not.toContainText("Virement possible");
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
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await expect(rowItem(page, out).getByText("Virement", { exact: true })).toBeVisible();
	await expect(rowButton(page, into)).toContainText(`Depuis ${checking.name}`);
	await expect(rowItem(page, into).getByText("Virement", { exact: true })).toBeVisible();
	await expect(rowItem(page, out).getByRole("button", { name: /^Catégorie/ })).toHaveCount(0);
});

test("a payment into a credit card is linked on creation as « Remboursement de carte »", async ({
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

	await expect(rowItem(page, out).getByText("Remboursement de carte")).toBeVisible();
	await expect(rowItem(page, into).getByText("Remboursement de carte")).toBeVisible();
	await expect(rowButton(page, out)).not.toContainText("Remboursement de carte ·");
	await expect(rowButton(page, out)).toContainText(`Vers ${card.name}`);
	await expect(rowButton(page, into)).toContainText(`Depuis ${checking.name}`);
	// Neither side is counted by the dashboard, so neither has a category.
	await expect(categoryButtons(page, out)).toHaveCount(0);
	await expect(categoryButtons(page, into)).toHaveCount(0);
	await expectNoCategoryField(page, out);
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
	// Linked on creation; undone and matched again as « Rapprocher » would.
	await api.unlinkTransfer(outId);
	await api.matchTransfer(outId, intoId);

	const housing = await api.createCategory({ name: uniqueName("Logement") });

	await visitOperations(page, prefix);
	// The dashboard counts the outflow in its category, so the row shows it,
	// and the kind moves to the subtitle; the loan side keeps the chip.
	await expect(rowButton(page, out)).toContainText(`Remboursement de prêt · Vers ${loan.name}`);
	await expect(
		rowItem(page, out).getByRole("button", { name: "Catégorie : Sans catégorie" }),
	).toBeVisible();
	await expect(rowItem(page, into).getByText("Remboursement de prêt")).toBeVisible();
	await expect(rowItem(page, into)).not.toContainText("Remboursement de prêt ·");
	await expect(rowButton(page, into)).toContainText(`Depuis ${checking.name}`);
	await expect(categoryButtons(page, into)).toHaveCount(0);

	await rowItem(page, out).getByRole("button", { name: "Catégorie : Sans catégorie" }).click();
	await categorySearch(page).fill(housing.name);
	await page.getByRole("option", { name: housing.name }).click();
	await expect(
		rowItem(page, out).getByRole("button", { name: `Catégorie : ${housing.name}` }),
	).toBeVisible();

	await page.goto(`/accounts/${loan.id}`);
	await expect(page.getByRole("region", { name: loan.name, exact: true })).toContainText(
		euros(17_880_000),
	);

	await page.goto("/?month=2024-06");
	const expenses = page
		.getByRole("region", { name: "Juin 2024" })
		.getByRole("group", { name: "Dépenses", exact: true });
	await expect(expenses).toContainText(euros(-120_000));
	await expect(expenses.getByRole("link", { name: housing.name })).toContainText(euros(-120_000));

	// Dissociated, the outflow is a standard row that keeps its category.
	await api.unlinkTransfer(outId);
	await visitOperations(page, prefix);
	await expect(
		rowItem(page, out).getByRole("button", { name: `Catégorie : ${housing.name}` }),
	).toBeVisible();
	await expect(rowButton(page, out)).not.toContainText("Vers");
});

test("a contribution into a PEA shows « Versement », raises its value and counts in « Dépenses » under the category picked in its sheet", async ({
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
	// Linked on creation; undone and matched again as « Rapprocher » would.
	await api.unlinkTransfer(outId);
	await api.matchTransfer(outId, intoId);

	const savings = await api.createCategory({ name: uniqueName("Épargne") });

	await visitOperations(page, prefix);
	await expect(rowButton(page, out)).toContainText(`Versement · Vers ${pea.name}`);
	await expect(rowItem(page, into).getByText("Versement", { exact: true })).toBeVisible();
	await expect(categoryButtons(page, into)).toHaveCount(0);

	await rowButton(page, out).click();
	const field = sheet(page).getByRole("button", { name: "Catégorie", exact: true });
	await expect(field).toHaveText("Sans catégorie");
	await field.click();
	await categorySearch(page).fill(savings.name);
	await page.getByRole("option", { name: savings.name }).click();
	await sheet(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(sheet(page)).toBeHidden();
	await expect(
		rowItem(page, out).getByRole("button", { name: `Catégorie : ${savings.name}` }),
	).toBeVisible();
	await expectNoCategoryField(page, into);

	await page.goto(`/accounts/${pea.id}`);
	await expect(page.getByRole("region", { name: pea.name, exact: true })).toContainText(
		euros(2_550_000),
	);

	await page.goto("/?month=2024-07");
	await expect(
		page
			.getByRole("region", { name: "Juillet 2024" })
			.getByRole("group", { name: "Dépenses", exact: true }),
	).toContainText(euros(-50_000));
});

test("« Dissocier » gives both rows their category chip back and drops the caption", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Épargne");
	const { checking, livret, out, into } = await moveToSavings(api, prefix);

	await visitOperations(page, prefix);
	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await expect(categoryButtons(page, out)).toHaveCount(0);
	await expect(categoryButtons(page, into)).toHaveCount(0);
	await expectNoCategoryField(page, out);
	await rowButton(page, into).click();
	await expect(sheet(page).getByText(`Depuis ${checking.name}`)).toBeVisible();
	await sheet(page).getByRole("button", { name: "Dissocier" }).click();
	await expect(sheet(page).getByRole("button", { name: "Rapprocher un virement" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

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

test("« Sens » lists transfers, expenses or income alone, and survives a reload", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Sens");
	const { checking, out, into } = await moveToSavings(api, prefix);
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
	await expect(listed).toHaveCount(4);

	await filterOn("Virements");
	await expect(listed).toHaveCount(2);
	await expect(rowItem(page, out)).toBeVisible();
	await expect(rowItem(page, into)).toBeVisible();

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
	await expect(rowButton(page, into)).toContainText(`Depuis ${checking.name}`);
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
	await expect(rowButton(page, into)).toContainText(`Depuis ${checking.name}`);
});

test("a row with two candidates shows « Virement possible » and lists both", async ({
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
	await api.addTransaction(card.id, { date: daysAgo(5), label: toCard, amount });
	await api.addTransaction(checking.id, { date: daysAgo(6), label: out, amount: `-${amount}` });

	await visitOperations(page, prefix);

	await expect(rowButton(page, out)).toContainText("Virement possible");
	await expect(rowButton(page, toLivret)).not.toContainText("Virement possible");
	await expect(rowButton(page, out)).not.toContainText("Vers");
	await rowButton(page, out).click();
	await expect(
		sheet(page).getByText("Plusieurs opérations pourraient former l'autre côté de ce virement."),
	).toBeVisible();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();
	const candidates = picker(page).getByRole("list", { name: "Opérations candidates" });
	await expect(candidates.getByRole("listitem")).toHaveCount(2);
	await expect(candidates).toContainText(toLivret);
	await expect(candidates).toContainText(toCard);
});

test("« Ne plus proposer » undoes an automatic link, and neither picker offers the pair again", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Refus");
	const { livret, out, into } = await moveToSavings(api, prefix);

	await visitOperations(page, prefix);
	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
	await rowButton(page, out).click();
	await sheet(page).getByRole("button", { name: "Ne plus proposer" }).click();
	await expect(page.getByText("Virement dissocié, il ne sera plus proposé")).toBeVisible();
	await expect(sheet(page).getByRole("button", { name: "Rapprocher un virement" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

	/** `label` is a standard row again, and its picker does not offer `other`. */
	const standardWithout = async (label: string, other: string) => {
		await expect(
			rowItem(page, label).getByRole("button", { name: "Catégorie : Sans catégorie" }),
		).toBeVisible();
		await expect(rowItem(page, label).getByText("Virement", { exact: true })).toHaveCount(0);
		await rowButton(page, label).click();
		await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();
		await expect(
			picker(page).getByText(
				"Aucune opération de montant opposé dans un autre compte à 4 jours près",
			),
		).toBeVisible();
		await expect(picker(page)).not.toContainText(other);
		await page.keyboard.press("Escape");
		await expect(picker(page)).toBeHidden();
		await page.keyboard.press("Escape");
		await expect(sheet(page)).toBeHidden();
	};

	await standardWithout(out, into);
	await standardWithout(into, out);
});
