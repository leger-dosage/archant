import type { Page } from "@playwright/test";

import { toMinorUnits } from "@archant/data/money";

import { formatSignedMoney, formatTableDate } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Story 1.4: balance snapshots.

const header = (page: Page, name: string) =>
	page.getByRole("heading", { level: 1, name }).locator("..");

// Anchored: « 1 septembre 2026 » is also the end of « 11 septembre 2026 ».
const snapshotRow = (page: Page, iso: string) =>
	page.getByRole("row", { name: new RegExp(`^${formatTableDate(iso)} `, "u") });

const dayRow = (iso: string) => new RegExp(`^${formatTableDate(iso)} `, "u");

const gap = (amount: number) => formatSignedMoney(toMinorUnits(amount), "EUR");

test("?tab=snapshots opens Soldes; a recorded snapshot sets the balance and shows its gap", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const date = daysAgo(5);

	await page.goto(`/accounts/${account.id}?tab=snapshots`);

	await expect(page.getByRole("tab", { name: "Soldes" })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
		"aria-selected",
		"false",
	);
	await expect(page.getByText("Aucun solde saisi.")).toBeVisible();

	await page.getByRole("button", { name: "Ajouter un solde" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un solde" });
	await dialog.getByLabel("Date", { exact: true }).fill(typed(date));
	await dialog.getByLabel("Solde").fill("2 000,00");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	const row = snapshotRow(page, date);
	await expect(row.getByRole("cell")).toHaveText([
		formatTableDate(date),
		euros(200_000),
		euros(100_000),
		gap(100_000),
	]);
	await expect(header(page, account.name)).toContainText(euros(200_000));
});

test("a loan's snapshot sets what it owes, and its history follows from that date", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "mortgage",
		openingBalance: "180 000,00",
		openingDate: daysAgo(30),
	});
	const date = daysAgo(5);

	await page.goto(`/accounts/${loan.id}?tab=snapshots`);
	await page.getByRole("button", { name: "Ajouter un solde" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un solde" });
	await dialog.getByLabel("Date", { exact: true }).fill(typed(date));
	await dialog.getByLabel("Solde").fill("175 000,00");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(header(page, loan.name)).toContainText(euros(17_500_000));

	await page.getByRole("tab", { name: "Opérations" }).click();
	await page.getByRole("button", { name: "Voir les données" }).click();
	const table = page.getByRole("table");
	await expect(table.getByRole("row").nth(1)).toContainText(euros(17_500_000));
	await expect(table.getByRole("row", { name: dayRow(date) })).toContainText(euros(17_500_000));
	await expect(table.getByRole("row", { name: dayRow(daysAgo(6)) })).toContainText(
		euros(18_000_000),
	);
});

test("a PEA's snapshot sets its value, and its history follows from that date", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "25 000,00",
		openingDate: daysAgo(30),
	});
	const date = daysAgo(5);

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await page.getByRole("button", { name: "Ajouter un solde" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un solde" });
	await dialog.getByLabel("Date", { exact: true }).fill(typed(date));
	await dialog.getByLabel("Solde").fill("26 300,00");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(header(page, account.name)).toContainText(euros(2_630_000));

	await page.getByRole("tab", { name: "Opérations" }).click();
	await page.getByRole("button", { name: "Voir les données" }).click();
	const table = page.getByRole("table");
	await expect(table.getByRole("row").nth(1)).toContainText(euros(2_630_000));
	await expect(table.getByRole("row", { name: dayRow(date) })).toContainText(euros(2_630_000));
	await expect(table.getByRole("row", { name: dayRow(daysAgo(6)) })).toContainText(
		euros(2_500_000),
	);
});

// Story 7.3: property and vehicle accounts.

test("a home's new estimated value sets its balance and history, with no transaction recorded", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("Maison"),
		kind: "single_family_home",
		openingBalance: "320 000,00",
		openingDate: daysAgo(30),
	});
	const date = daysAgo(5);

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await page.getByRole("button", { name: "Ajouter un solde" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un solde" });
	await dialog.getByLabel("Date", { exact: true }).fill(typed(date));
	await dialog.getByLabel("Solde").fill("335 000,00");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(header(page, account.name)).toContainText(euros(33_500_000));

	await page.getByRole("tab", { name: "Opérations" }).click();
	await expect(page.getByText("Aucune opération.")).toBeVisible();
	await page.getByRole("button", { name: "Voir les données" }).click();
	const table = page.getByRole("table");
	await expect(table.getByRole("row").nth(1)).toContainText(euros(33_500_000));
	await expect(table.getByRole("row", { name: dayRow(date) })).toContainText(euros(33_500_000));
	await expect(table.getByRole("row", { name: dayRow(daysAgo(6)) })).toContainText(
		euros(32_000_000),
	);
});

test("a second snapshot on the same date replaces the first", async ({ page, api }) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const date = daysAgo(5);
	await api.recordSnapshot(account.id, { date, balance: "2 000,00" });

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await expect(snapshotRow(page, date)).toContainText(euros(200_000));

	await page.getByRole("button", { name: "Ajouter un solde" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un solde" });
	await dialog.getByLabel("Date", { exact: true }).fill(typed(date));
	await dialog.getByLabel("Solde").fill("2 500,00");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(snapshotRow(page, date)).toHaveCount(1);
	await expect(snapshotRow(page, date)).toContainText(euros(250_000));
	await expect(page.getByRole("main").getByRole("row")).toHaveCount(2);
	await expect(header(page, account.name)).toContainText(euros(250_000));
});

test("a snapshot is edited, then deleted after confirmation", async ({ page, api }) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const date = daysAgo(5);
	await api.recordSnapshot(account.id, { date, balance: "2 000,00" });

	await page.goto(`/accounts/${account.id}?tab=snapshots`);

	await page.getByRole("button", { name: formatTableDate(date), exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le solde" });
	await expect(dialog.getByLabel("Solde")).toHaveValue("2000,00");
	await dialog.getByLabel("Solde").fill("1 500,00");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(snapshotRow(page, date)).toContainText(euros(150_000));
	await expect(snapshotRow(page, date)).toContainText(gap(50_000));
	await expect(header(page, account.name)).toContainText(euros(150_000));

	await page.getByRole("button", { name: formatTableDate(date), exact: true }).click();
	await dialog.getByRole("button", { name: "Supprimer" }).click();
	const confirm = page.getByRole("alertdialog", {
		name: `Supprimer le solde du ${formatTableDate(date)} ?`,
	});
	await expect(confirm.getByRole("button", { name: "Annuler" })).toBeFocused();
	await confirm.getByRole("button", { name: "Supprimer" }).click();

	await expect(confirm).toBeHidden();
	await expect(dialog).toBeHidden();
	await expect(page.getByText("Aucun solde saisi.")).toBeVisible();
	await expect(header(page, account.name)).toContainText(euros(100_000));
});

test("a transaction on a snapshot day moves the gap, not the balance", async ({ page, api }) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const date = daysAgo(5);
	await api.recordSnapshot(account.id, { date, balance: "2 000,00" });

	await page.goto(`/accounts/${account.id}`);
	await page.getByRole("button", { name: "Ajouter une opération" }).first().click();
	const sheet = page.getByRole("dialog", { name: "Ajouter une opération" });
	await sheet.getByLabel("Date", { exact: true }).fill(typed(date));
	await sheet.getByLabel("Libellé").fill(uniqueName("Oubliée"));
	await sheet.getByLabel("Montant").fill("100,00");
	await sheet.getByRole("button", { name: "Enregistrer" }).click();
	await expect(sheet).toBeHidden();

	await expect(header(page, account.name)).toContainText(euros(200_000));

	await page.getByRole("tab", { name: "Soldes" }).click();
	await expect(page).toHaveURL(/[?&]tab=snapshots(&|$)/u);
	await expect(snapshotRow(page, date).getByRole("cell")).toHaveText([
		formatTableDate(date),
		euros(200_000),
		euros(90_000),
		gap(110_000),
	]);
});
