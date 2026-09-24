import type { Page } from "@playwright/test";

import { formatShortDate } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Story 2.4: import a QIF file. Files are built here with dates relative to
// today, after the opening date `openAccount` puts 30 days ago.

type QifRecord = { date: string; amount: string; label: string; number?: string };

/** A bank's QIF export: `DD/MM/YYYY` dates and decimal commas. */
function qifFile(records: QifRecord[], type = "Bank"): Buffer {
	const text = [
		`!Type:${type}`,
		...records.flatMap((record) => [
			`D${typed(record.date)}`,
			`T${record.amount}`,
			...(record.number === undefined ? [] : [`N${record.number}`]),
			`P${record.label}`,
			"^",
		]),
		"",
	].join("\r\n");

	return Buffer.from(text, "latin1");
}

function threeRecords(): [QifRecord, QifRecord, QifRecord] {
	return [
		{ date: daysAgo(12), amount: "-42,90", label: uniqueName("CARTE MONOP") },
		{ date: daysAgo(8), amount: "-150,00", label: uniqueName("CHEQUE"), number: "1234567" },
		{ date: daysAgo(5), amount: "2 150,00", label: uniqueName("VIR SALAIRE") },
	];
}

/**
 * A recent day whose day of the month is 12 or less and differs from its
 * month, so that it reads both ways, and the other way gives another day.
 */
function ambiguousDay(): { date: string; swapped: string } {
	for (let days = 1; days <= 40; days += 1) {
		const date = daysAgo(days);
		const [year = "", month = "", day = ""] = date.split("-");

		if (Number(day) <= 12 && day !== month) {
			return { date, swapped: `${year}-${day}-${month}` };
		}
	}

	throw new Error("No day of the last 40 reads both ways.");
}

const header = (page: Page, name: string) =>
	page.getByRole("heading", { level: 1, name }).locator("..");

const dialog = (page: Page) => page.getByRole("dialog", { name: "Importer un fichier" });

const tab = (page: Page, name: string, count: number) =>
	dialog(page).getByRole("tab", { name: `${name} ${count}` });

async function openImport(page: Page, accountId: string, name: string) {
	await page.goto(`/accounts/${accountId}`);
	await expect(header(page, name)).toBeVisible();
	await page.getByRole("button", { name: "Importer", exact: true }).click();
	await expect(dialog(page)).toBeVisible();
}

async function choose(page: Page, buffer: Buffer) {
	await dialog(page)
		.getByLabel("Relevé bancaire")
		.setInputFiles({ name: "releve.qif", mimeType: "text/plain", buffer });
}

test("a QIF bank file lists its records, and confirm writes them and moves the balance", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00" });
	const records = threeRecords();

	await openImport(page, account.id, account.name);
	await expect(dialog(page).getByLabel("Relevé bancaire")).toHaveAttribute("accept", /\.qif/u);
	await choose(page, qifFile(records));

	await expect(dialog(page).locator('[aria-current="step"]')).toHaveText(/Aperçu/u);
	await expect(tab(page, "À créer", 3)).toHaveAttribute("aria-selected", "true");
	await expect(dialog(page).getByRole("cell", { name: records[0].label })).toBeVisible();
	await expect(dialog(page).getByRole("cell", { name: records[1].label })).toBeVisible();
	await expect(dialog(page).getByRole("cell", { name: records[2].label })).toBeVisible();
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(page.getByText("3 opérations importées.")).toBeVisible();
	await expect(header(page, account.name)).toContainText(euros(100_000 - 4290 - 15_000 + 215_000));
});

test("dates that read both ways start day-first, and « Mois d'abord » changes them", async ({
	page,
	api,
}) => {
	// Old enough that the month-first reading also falls after the opening date.
	const account = await api.openAccount({ openingDate: daysAgo(800) });
	const { date, swapped } = ambiguousDay();
	const label = uniqueName("CARTE MONOP");

	await openImport(page, account.id, account.name);
	await choose(page, qifFile([{ date, amount: "-42,90", label }]));

	const order = dialog(page).getByRole("combobox", { name: "Ordre des dates" });
	await expect(order).toHaveText("Jour d'abord (31/01/2026)");
	const row = dialog(page).getByRole("row", { name: new RegExp(label, "u") });
	await expect(row).toContainText(formatShortDate(date));

	await order.click();
	await page.getByRole("option", { name: "Mois d'abord (01/31/2026)" }).click();

	await expect(order).toHaveText("Mois d'abord (01/31/2026)");
	await expect(row).toContainText(formatShortDate(swapped));
});

test("the same QIF file again is already present, and confirm is disabled", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const file = qifFile(threeRecords());

	await openImport(page, account.id, account.name);
	await choose(page, file);
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();
	await expect(dialog(page)).toBeHidden();

	await page.keyboard.press("i");
	await choose(page, file);

	await expect(tab(page, "Déjà présentes", 3)).toHaveAttribute("aria-selected", "true");
	await expect(
		dialog(page).getByText("Toutes les opérations de ce fichier sont déjà présentes."),
	).toBeVisible();
	await expect(dialog(page).getByRole("button", { name: /^Importer 0 opération/u })).toBeDisabled();
});

test("an investment QIF is refused, naming its type, and nothing is stored", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();

	await openImport(page, account.id, account.name);
	await choose(page, qifFile(threeRecords(), "Invst"));

	await expect(dialog(page).getByRole("alert")).toHaveText(
		"Les relevés QIF de type Invst ne sont pas pris en charge.",
	);
	await expect(dialog(page).locator('[aria-current="step"]')).toHaveText(/Fichier/u);
	await dialog(page).getByRole("button", { name: "Annuler" }).click();
	await expect(page.getByText("Aucune opération.")).toBeVisible();
});

test("an imported record's sheet shows its number", async ({ page, api }) => {
	const account = await api.openAccount();
	const records = threeRecords();

	await openImport(page, account.id, account.name);
	await choose(page, qifFile(records));
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();
	await expect(dialog(page)).toBeHidden();

	await page
		.getByRole("main")
		.getByRole("button", { name: new RegExp(records[1].label, "u") })
		.click();

	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(
		sheet.getByText(`Import QIF du ${formatShortDate(daysAgo(0))}, n° 1234567`),
	).toBeVisible();
});
