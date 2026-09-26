import type { Line } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { formatShortDate, formatTableDate } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, sgml, test, uniqueName } from "./fixtures.ts";

// Story 2.5: the account's Imports tab lists its imports and reverts one.
// Imports go through the API; the tab is what is under test.

function threeLines(): [Line, Line, Line] {
	const id = uniqueName("H").replace(" ", "-");

	return [
		{ daysAgo: 12, amount: "-42,90", label: uniqueName("CB CAFÉ"), fitid: `${id}-1` },
		{ daysAgo: 8, amount: "-87,12", label: uniqueName("PRLV ÉLECTRICITÉ"), fitid: `${id}-2` },
		{ daysAgo: 5, amount: "2150,00", label: uniqueName("VIR SALAIRE"), fitid: `${id}-3` },
	];
}

const header = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

const today = () => formatShortDate(daysAgo(0));

async function openImportsTab(page: Page, account: { id: string; name: string }) {
	await page.goto(`/accounts/${account.id}`);
	await expect(header(page, account.name)).toBeVisible();
	await page.getByRole("tab", { name: "Imports" }).click();
}

test("an account without imports says so", async ({ page, api }) => {
	const account = await api.openAccount();

	await openImportsTab(page, account);

	await expect(page.getByText("Aucun import.")).toBeVisible();
});

test("the Imports tab shows the file name, OFX, the date and the four counts", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const lines = threeLines();
	await api.importFile(account.id, sgml(lines));
	// A manual twin of a new line, two equally near candidates for another,
	// and a line dated before the opening date.
	await api.addTransaction(account.id, {
		date: daysAgo(3),
		label: "Pharmacie",
		amount: "-15,00",
	});
	await api.addTransaction(account.id, { date: daysAgo(7), label: "Péage", amount: "-7,00" });
	await api.addTransaction(account.id, { date: daysAgo(9), label: "Péage", amount: "-7,00" });
	const fitid = lines[0].fitid;
	await api.importFile(
		account.id,
		sgml([
			...lines,
			{ daysAgo: 2, amount: "-15,00", label: uniqueName("CB PHARMACIE"), fitid: `${fitid}-4` },
			{ daysAgo: 1, amount: "-9,99", label: uniqueName("CB LIBRAIRIE"), fitid: `${fitid}-5` },
			{ daysAgo: 40, amount: "-5,00", label: uniqueName("CB ANCIEN"), fitid: `${fitid}-6` },
			{ daysAgo: 8, amount: "-7,00", label: uniqueName("PEAGE"), fitid: `${fitid}-7` },
		]),
		"releve-septembre.ofx",
	);

	await openImportsTab(page, account);

	const rows = page.getByRole("tabpanel", { name: "Imports" }).getByRole("row");
	await expect(rows.nth(0)).toHaveText(/DateFichierFormatCrééesRapprochéesDéjà présentesRejetées/u);
	// Latest first: 1 created and 1 possible duplicate under « Créées », 1
	// matched, 3 already present, 1 rejected.
	await expect(rows.nth(1).getByRole("cell")).toHaveText([
		today(),
		"releve-septembre.ofx",
		"OFX",
		"2",
		"1",
		"3",
		"1",
		"Annuler l'import",
	]);
	await expect(rows.nth(2).getByRole("cell")).toHaveText([
		today(),
		"releve.ofx",
		"OFX",
		"3",
		"0",
		"0",
		"0",
		"Annuler l'import",
	]);
});

test("reverting an import removes its transactions, puts the balance back and marks the row", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00" });
	const lines = threeLines();
	await api.importFile(account.id, sgml(lines, { ledger: { amount: "2408,61", daysAgo: 2 } }));

	await openImportsTab(page, account);
	await expect(header(page, account.name)).toContainText(euros(240_861));
	await page.getByRole("button", { name: `Annuler l'import de releve.ofx du ${today()}` }).click();

	const confirm = page.getByRole("alertdialog", { name: "Annuler l'import de releve.ofx ?" });
	await expect(confirm.getByText("3 opérations et 1 solde relevé seront supprimés.")).toBeVisible();
	await confirm.getByRole("button", { name: "Supprimer 3 opérations" }).click();

	await expect(confirm).toBeHidden();
	await expect(page.getByText("Import annulé, 3 opérations supprimées.")).toBeVisible();
	const row = page.getByRole("tabpanel", { name: "Imports" }).getByRole("row").nth(1);
	await expect(row).toContainText(`Annulé le ${today()}`);
	await expect(row.getByRole("button")).toHaveCount(0);
	await expect(header(page, account.name)).toContainText(euros(100_000));

	await page.getByRole("tab", { name: "Opérations" }).click();
	await expect(page.getByText("Aucune opération.")).toBeVisible();
});

test("a reverted file imported again lists its lines under À créer", async ({ page, api }) => {
	const account = await api.openAccount();
	const file = sgml(threeLines());
	await api.importFile(account.id, file);

	await openImportsTab(page, account);
	await page.getByRole("button", { name: `Annuler l'import de releve.ofx du ${today()}` }).click();
	await page
		.getByRole("alertdialog", { name: "Annuler l'import de releve.ofx ?" })
		.getByRole("button", { name: "Supprimer 3 opérations" })
		.click();
	await expect(page.getByText("Import annulé, 3 opérations supprimées.")).toBeVisible();

	await page.getByRole("button", { name: "Importer", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Importer un fichier" });
	await dialog
		.getByLabel("Relevé bancaire")
		.setInputFiles({ name: "releve.ofx", mimeType: "application/x-ofx", buffer: file });

	await expect(dialog.getByRole("tab", { name: "À créer 3" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(dialog.getByRole("tab", { name: "Déjà présentes 0" })).toBeVisible();
});

// Story 11.1: a revert puts the opening date back, so the same file is read
// the same way again instead of counting on top.
test("a revert puts back the opening date a file moved, and the file imported again gives the same balance", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const id = uniqueName("O").replace(" ", "-");
	const file = sgml([
		{ daysAgo: 35, amount: "-20,00", label: uniqueName("CB ANCIEN"), fitid: `${id}-1` },
		{ daysAgo: 30, amount: "50,00", label: uniqueName("VIR ANCIEN"), fitid: `${id}-2` },
	]);
	const dialog = page.getByRole("dialog", { name: "Importer un fichier" });
	const move = `Avancer la date d'ouverture au ${formatTableDate(daysAgo(36))}`;
	const importWithMove = async () => {
		await page.getByRole("button", { name: "Importer", exact: true }).click();
		await dialog
			.getByLabel("Relevé bancaire")
			.setInputFiles({ name: "releve.ofx", mimeType: "application/x-ofx", buffer: file });
		await expect(dialog.getByRole("tab", { name: "Rejetées 2" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await dialog.getByRole("button", { name: move }).click();
		await expect(
			dialog.getByText(
				`Le solde du ${formatTableDate(daysAgo(30))}, date d'ouverture actuelle, ne change pas.`,
				{ exact: false },
			),
		).toBeVisible();
		await dialog.getByRole("button", { name: "Importer 2 opérations" }).click();
		await expect(dialog).toBeHidden();
	};

	await openImportsTab(page, account);
	await importWithMove();
	await expect(header(page, account.name)).toContainText(euros(100_000));

	await page.getByRole("tab", { name: "Imports" }).click();
	await page.getByRole("button", { name: `Annuler l'import de releve.ofx du ${today()}` }).click();
	await page
		.getByRole("alertdialog", { name: "Annuler l'import de releve.ofx ?" })
		.getByRole("button", { name: "Supprimer 2 opérations" })
		.click();
	await expect(page.getByText("Import annulé, 2 opérations supprimées.")).toBeVisible();
	await expect(header(page, account.name)).toContainText(euros(100_000));

	// The lines fall before the opening date again, which the offer names.
	await importWithMove();
	await expect(header(page, account.name)).toContainText(euros(100_000));
});

test("reverting an import that only matched manual transactions deletes nothing", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00" });
	await api.addTransaction(account.id, { date: daysAgo(12), label: "Café", amount: "-42,90" });
	await api.importFile(
		account.id,
		sgml([{ daysAgo: 11, amount: "-42,90", label: uniqueName("CB CAFÉ"), fitid: uniqueName("M") }]),
	);

	await openImportsTab(page, account);
	await page.getByRole("button", { name: `Annuler l'import de releve.ofx du ${today()}` }).click();

	const confirm = page.getByRole("alertdialog", { name: "Annuler l'import de releve.ofx ?" });
	await expect(confirm.getByText("Aucune opération ne sera supprimée.")).toBeVisible();
	const action = confirm.getByRole("button", { name: "Annuler l'import", exact: true });
	await expect(action).toHaveAttribute("data-variant", "default");
	await action.click();

	await expect(page.getByText("Import annulé.", { exact: true })).toBeVisible();
	await expect(header(page, account.name)).toContainText(euros(100_000 - 4290));
	await page.getByRole("tab", { name: "Opérations" }).click();
	await expect(page.getByRole("main").getByRole("button", { name: /Café/u })).toBeVisible();
});
