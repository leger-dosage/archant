import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { randomInt } from "node:crypto";

import { daysAgo, expect, sgml, test, uniqueName } from "./fixtures.ts";

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

/** An amount in euros no other test uses, as typed: `517,23`. */
function uniqueAmount(): string {
	return `${randomInt(100, 900)},${String(randomInt(100)).padStart(2, "0")}`;
}

/** Opens `/operations` on the rows labelled with `q`, and waits for them. */
async function visitOperations(page: Page, q: string, search = "") {
	await page.goto(`/operations?q=${encodeURIComponent(q)}${search}`);
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
	// `c` has no category to open on a transfer side.
	await rowButton(page, out).focus();
	await page.keyboard.press("c");
	await expect(page.getByRole("combobox", { name: "Rechercher une catégorie" })).toHaveCount(0);
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
	await expect(rowButton(page, out)).toContainText(`Vers ${card.name}`);
	await expect(rowButton(page, into)).toContainText(`Depuis ${checking.name}`);
});

test("« Dissocier » gives both rows their category chip back and drops the caption", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Épargne");
	const { checking, livret, out, into } = await moveToSavings(api, prefix);

	await visitOperations(page, prefix);
	await expect(rowButton(page, out)).toContainText(`Vers ${livret.name}`);
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
