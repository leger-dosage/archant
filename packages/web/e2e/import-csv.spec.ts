import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Story 2.3: import a CSV file with a saved mapping. Files are built here with
// dates relative to today, after the opening date `openAccount` puts 30 days ago.

type Line = { daysAgo: number; amount: string; label: string };

/** A bank-like export: a comment line, a header, then `Date;Libellé;Montant`. */
function csvFile(lines: Line[], encoding: "utf8" | "latin1" = "utf8"): Buffer {
	const text = [
		"# Export de test",
		"Date;Libellé;Montant",
		...lines.map((line) => `${typed(daysAgo(line.daysAgo))};${line.label};${line.amount}`),
		"",
	].join("\r\n");

	return Buffer.from(text, encoding);
}

function threeLines(): [Line, Line, Line] {
	return [
		{ daysAgo: 12, amount: "-42,90", label: uniqueName("CB CAFÉ") },
		{ daysAgo: 8, amount: "-87,12", label: uniqueName("PRLV ÉLECTRICITÉ") },
		{ daysAgo: 5, amount: "2 150,00", label: uniqueName("VIR SALAIRE") },
	];
}

const header = (page: Page, name: string) =>
	page.getByRole("heading", { level: 1, name }).locator("..");

const dialog = (page: Page) => page.getByRole("dialog", { name: "Importer un fichier" });

const tab = (page: Page, name: string, count: number) =>
	dialog(page).getByRole("tab", { name: `${name} ${count}` });

const step = (page: Page) => dialog(page).locator('[aria-current="step"]');

async function openImport(page: Page, accountId: string, name: string) {
	await page.goto(`/comptes/${accountId}`);
	await expect(header(page, name)).toBeVisible();
	await page.getByRole("button", { name: "Importer", exact: true }).click();
	await expect(dialog(page)).toBeVisible();
}

async function choose(page: Page, buffer: Buffer) {
	await dialog(page)
		.getByLabel("Relevé bancaire")
		.setInputFiles({ name: "releve.csv", mimeType: "text/csv", buffer });
}

async function pick(page: Page, column: string, role: string) {
	await dialog(page)
		.getByRole("combobox", { name: `Rôle de la colonne ${column}` })
		.click();
	await page.getByRole("option", { name: role, exact: true }).click();
}

/** Skips the comment line and gives the three columns their roles. */
async function mapColumns(page: Page) {
	await dialog(page).getByLabel("Lignes à ignorer au début").fill("1");
	await pick(page, "Date", "Date");
	await pick(page, "Libellé", "Libellé");
	await pick(page, "Montant", "Montant");
}

test("a first CSV opens on its columns, then counts the lines once they are mapped, and confirm writes them", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00" });
	const lines = threeLines();

	await openImport(page, account.id, account.name);
	await choose(page, csvFile(lines));

	await expect(step(page)).toHaveText(/Colonnes/u);
	await expect(dialog(page).getByRole("cell", { name: lines[0].label })).toBeVisible();
	await expect(
		dialog(page).getByRole("button", { name: /^Importer \d+ opération/u }),
	).toBeDisabled();

	await mapColumns(page);

	await expect(tab(page, "À créer", 3)).toBeVisible();
	await expect(dialog(page).getByRole("status")).toHaveText(
		"3 à créer, 0 déjà présentes, 0 rapprochées, 0 doublons possibles, 0 rejetées.",
	);
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(page.getByText("3 opérations importées.")).toBeVisible();
	await expect(header(page, account.name)).toContainText(euros(100_000 - 4290 - 8712 + 215_000));
});

test("a mapping made invalid after its preview disables confirm and says what is missing", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();

	await openImport(page, account.id, account.name);
	await choose(page, csvFile(threeLines()));
	await mapColumns(page);
	await expect(dialog(page).getByRole("button", { name: "Importer 3 opérations" })).toBeEnabled();

	await pick(page, "Libellé", "Date");

	await expect(
		dialog(page).getByText(
			"Choisissez une colonne Date, au moins une colonne Libellé, puis une colonne Montant, ou des colonnes Débit et Crédit.",
		),
	).toBeVisible();
	await expect(
		dialog(page).getByRole("button", { name: /^Importer \d+ opération/u }),
	).toBeDisabled();
});

test("a line the mapping cannot read is listed under Rejetées with its line number", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const [first, second] = threeLines();

	await openImport(page, account.id, account.name);
	await choose(page, csvFile([first, { ...second, amount: "12.50" }]));
	await mapColumns(page);

	await expect(tab(page, "Rejetées", 1)).toBeVisible();
	await tab(page, "Rejetées", 1).click();
	// The comment line is 1, the header 2, the first line 3.
	await expect(dialog(page).getByRole("row", { name: /Ligne 4/u })).toContainText(
		"Montant illisible",
	);
	await expect(dialog(page).getByRole("button", { name: "Importer 1 opération" })).toBeEnabled();
});

test("the next CSV into the same account opens on its preview, and the columns can still change", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();

	await openImport(page, account.id, account.name);
	await choose(page, csvFile(threeLines()));
	await mapColumns(page);
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();
	await expect(dialog(page)).toBeHidden();

	await page.keyboard.press("i");
	await expect(dialog(page)).toBeVisible();
	await choose(page, csvFile(threeLines()));

	await expect(step(page)).toHaveText(/Aperçu/u);
	await expect(tab(page, "À créer", 3)).toHaveAttribute("aria-selected", "true");
	await dialog(page).getByRole("button", { name: "Modifier les colonnes" }).click();

	await expect(step(page)).toHaveText(/Colonnes/u);
	await expect(dialog(page).getByRole("combobox", { name: "Rôle de la colonne Date" })).toHaveText(
		"Date",
	);
	await expect(
		dialog(page).getByRole("combobox", { name: "Rôle de la colonne Montant" }),
	).toHaveText("Montant");
	await expect(dialog(page).getByLabel("Lignes à ignorer au début")).toHaveValue("1");
});

test("the same CSV again is already present, and confirm is disabled", async ({ page, api }) => {
	const account = await api.openAccount();
	const file = csvFile(threeLines());

	await openImport(page, account.id, account.name);
	await choose(page, file);
	await mapColumns(page);
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

test("a Windows-1252 CSV shows its accented labels intact", async ({ page, api }) => {
	const account = await api.openAccount();
	const lines = threeLines();
	const accented = { ...lines[0], label: uniqueName("Prélèvement Crédit Agricole") };

	await openImport(page, account.id, account.name);
	await choose(page, csvFile([accented, lines[1]], "latin1"));

	await expect(dialog(page).getByRole("cell", { name: accented.label })).toBeVisible();
	await mapColumns(page);

	await expect(tab(page, "À créer", 2)).toBeVisible();
	await expect(dialog(page).getByRole("cell", { name: accented.label })).toHaveCount(2);
});
