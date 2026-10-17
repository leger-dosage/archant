import type { Page } from "@playwright/test";

import { toMinorUnits } from "@archant/data/money";

import { formatSignedMoney, formatTableDate } from "../src/lib/balance-change.ts";
import { longDate } from "../src/lib/dates.ts";
import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Story 1.4: balance snapshots.

const header = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

// Anchored: « 1 septembre 2026 » is also the end of « 11 septembre 2026 ».
const snapshotRow = (page: Page, iso: string) =>
	page.getByRole("row", { name: new RegExp(`^${formatTableDate(iso)} `, "u") });

const dayRow = (iso: string) => new RegExp(`^${formatTableDate(iso)} `, "u");

const gap = (amount: number) => formatSignedMoney(toMinorUnits(amount), "EUR");

// Story 28.19: Sure's confirmation step, which every balance form shows before it saves.
const createStep = (page: Page) => page.getByRole("dialog", { name: "Confirmer le nouveau solde" });
const updateStep = (page: Page) => page.getByRole("dialog", { name: "Mettre à jour le solde" });

/** What the API holds, read beside the page with its session. */
async function stored(page: Page, path: string): Promise<unknown> {
	const response = await page.request.get(path);
	expect(response.ok(), `GET ${path} answered ${response.status()}`).toBe(true);
	const body: unknown = await response.json();

	return typeof body === "object" && body !== null && "data" in body ? body.data : undefined;
}

async function confirmNew(page: Page) {
	await createStep(page).getByRole("button", { name: "Confirmer", exact: true }).click();
	await expect(createStep(page)).toBeHidden();
}

async function confirmUpdate(page: Page) {
	await updateStep(page).getByRole("button", { name: "Mettre à jour", exact: true }).click();
	await expect(updateStep(page)).toBeHidden();
}

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
	// Only the opening balance: no snapshot is recorded.
	await expect(page.getByRole("row", { name: "Solde d'ouverture" })).toBeVisible();
	await expect(page.locator("[data-snapshot-id]")).toHaveCount(0);

	await page.getByRole("button", { name: "Ajouter un solde" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un solde" });
	await dialog.getByLabel("Date", { exact: true }).fill(typed(date));
	await dialog.getByLabel("Solde").fill("2 000,00");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	// Sure's `confirm_create`: the same dialog, nothing written yet.
	await expect(createStep(page)).toContainText(
		`Définir le solde du compte au ${longDate(date)} à ${euros(200_000)}.`,
	);
	await expect(createStep(page)).toContainText(
		"Toutes les transactions et soldes futurs seront recalculés sur la base de cette mise à jour.",
	);
	await expect(createStep(page).getByRole("button", { name: "Confirmer" })).toBeFocused();
	await expect(page.locator("[data-snapshot-id]")).toHaveCount(0);
	await confirmNew(page);

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
	await expect(createStep(page)).toContainText(
		`Définir le solde du prêt au ${longDate(date)} à ${euros(17_500_000)}.`,
	);
	await confirmNew(page);

	await expect(header(page, loan.name)).toContainText(euros(17_500_000));

	await page.getByRole("tab", { name: "Opérations" }).click();
	await page.getByRole("button", { name: "Voir le tableau" }).click();
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

	// Sure's investment split: without trades, the whole value is brokerage cash.
	const step = createStep(page);
	await expect(step).toContainText(`Cela définira la valeur du compte au ${longDate(date)} à :`);
	await expect(step.getByRole("definition")).toHaveText([
		euros(2_630_000),
		euros(0),
		euros(2_630_000),
	]);
	await expect(step.getByRole("term")).toHaveText([
		"Valeur totale du compte",
		"Valeur des positions",
		"Trésorerie de courtage",
	]);
	await confirmNew(page);

	await expect(header(page, account.name)).toContainText(euros(2_630_000));

	await page.getByRole("tab", { name: "Opérations" }).click();
	await page.getByRole("button", { name: "Voir le tableau" }).click();
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
	await expect(createStep(page)).toContainText(
		`Définir la valeur du bien au ${longDate(date)} à ${euros(33_500_000)}.`,
	);
	await confirmNew(page);

	await expect(header(page, account.name)).toContainText(euros(33_500_000));

	await page.getByRole("tab", { name: "Opérations" }).click();
	await expect(
		page.getByRole("heading", { name: "Aucune opération pour l'instant" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Voir le tableau" }).click();
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
	await confirmNew(page);

	await expect(snapshotRow(page, date)).toHaveCount(1);
	await expect(snapshotRow(page, date)).toContainText(euros(250_000));
	// The header, the snapshot, then the opening balance.
	await expect(page.getByRole("main").getByRole("row")).toHaveCount(3);
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

	// Sure's `confirm_update`, nothing written yet.
	await expect(updateStep(page)).toContainText(
		`Mettre à jour le solde du compte au ${longDate(date)} à ${euros(150_000)}.`,
	);
	await expect(updateStep(page)).toContainText(
		"Toutes les transactions et soldes futurs seront recalculés sur la base de ce changement.",
	);
	// The page behind the modal step is hidden from roles: ask the API.
	await expect(stored(page, `/api/accounts/${account.id}/snapshots`)).resolves.toMatchObject({
		items: [{ date, balance: 200_000 }],
	});
	await confirmUpdate(page);

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
	// Only the opening balance: no snapshot is recorded.
	await expect(page.getByRole("row", { name: "Solde d'ouverture" })).toBeVisible();
	await expect(page.locator("[data-snapshot-id]")).toHaveCount(0);
	await expect(header(page, account.name)).toContainText(euros(100_000));
});

test("a snapshot's notes are written in its dialog, kept, and cleared, as Sure's valuation", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const date = daysAgo(5);
	await api.recordSnapshot(account.id, { date, balance: "2 000,00" });

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await page.getByRole("button", { name: "Ajouter un solde" }).click();
	await expect(
		page.getByRole("dialog", { name: "Ajouter un solde" }).getByLabel("Notes"),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Annuler" }).click();

	await page.getByRole("button", { name: formatTableDate(date), exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le solde" });
	const notes = dialog.getByLabel("Notes");
	await expect(notes).toHaveValue("");
	await expect(notes).toHaveAttribute(
		"placeholder",
		"Ajoutez tout détail supplémentaire à ce bilan",
	);
	await notes.fill("Relevé de fin de mois, page 2");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog).toBeHidden();

	await page.getByRole("button", { name: formatTableDate(date), exact: true }).click();
	await expect(notes).toHaveValue("Relevé de fin de mois, page 2");
	await notes.fill("");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog).toBeHidden();

	await page.getByRole("button", { name: formatTableDate(date), exact: true }).click();
	await expect(notes).toHaveValue("");
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

// Story 27.17: the opening balance, Sure's valuation drawer on its anchor.

test("« Solde d'ouverture » moves the opening balance to an earlier date, and the balance follows", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	await api.addTransaction(account.id, {
		date: daysAgo(10),
		label: uniqueName("Courses"),
		amount: "-100,00",
	});

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	const row = page.getByRole("row", { name: "Solde d'ouverture" });
	await expect(row.getByRole("cell")).toHaveText([
		`${formatTableDate(daysAgo(30))}Solde d'ouverture`,
		euros(100_000),
		"—",
		"—",
	]);

	await row.getByRole("button").click();
	const sheet = page.getByRole("dialog", { name: "Solde d'ouverture" });
	await expect(sheet.getByLabel("Date", { exact: true })).toHaveValue(typed(daysAgo(30)));
	await expect(sheet.getByLabel("Valeur du compte à ce jour")).toHaveValue("1000,00");
	await sheet.getByLabel("Date", { exact: true }).fill(typed(daysAgo(40)));
	await sheet.getByLabel("Valeur du compte à ce jour").fill("1 500,00");
	await sheet.getByRole("button", { name: "Mettre à jour la valeur" }).click();

	// Sure's `confirm_update`, over the sheet, nothing written yet.
	await expect(updateStep(page)).toContainText(
		`Mettre à jour le solde du compte au ${longDate(daysAgo(40))} à ${euros(150_000)}.`,
	);
	await expect(
		updateStep(page).getByRole("button", { name: "Mettre à jour", exact: true }),
	).toBeFocused();
	await expect(stored(page, `/api/accounts/${account.id}`)).resolves.toMatchObject({
		openingDate: daysAgo(30),
	});
	await confirmUpdate(page);

	await expect(sheet).toBeHidden();
	await expect(row.getByRole("cell").first()).toHaveText(
		`${formatTableDate(daysAgo(40))}Solde d'ouverture`,
	);
	await expect(header(page, account.name)).toContainText(euros(140_000));
	await expect(row.getByRole("button")).toBeFocused();
});

test("« Solde d'ouverture » refuses a date on the oldest line, naming it", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	await api.addTransaction(account.id, {
		date: daysAgo(10),
		label: uniqueName("Courses"),
		amount: "-100,00",
	});

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await page.getByRole("row", { name: "Solde d'ouverture" }).getByRole("button").click();
	const sheet = page.getByRole("dialog", { name: "Solde d'ouverture" });
	await sheet.getByLabel("Date", { exact: true }).fill(typed(daysAgo(10)));
	await sheet.getByRole("button", { name: "Mettre à jour la valeur" }).click();
	// The dry run checks only the date's format, as Sure's: the ledger refuses at the save.
	await confirmUpdate(page);

	await expect(
		sheet.getByText(
			`La date doit précéder la plus ancienne opération du compte, le ${formatTableDate(daysAgo(10))}.`,
		),
	).toBeVisible();
	await expect(sheet.getByLabel("Date", { exact: true })).toHaveAttribute("aria-invalid", "true");
	await expect(sheet.getByLabel("Date", { exact: true })).toBeFocused();
	await sheet.getByRole("button", { name: "Annuler" }).click();
	await expect(header(page, account.name)).toContainText(euros(90_000));
});

test("a blank balance is refused before any request, and « Annuler » on the step writes nothing", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const dryRuns: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/snapshots/dry-run")) {
			dryRuns.push(request.url());
		}
	});

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await page.getByRole("button", { name: "Ajouter un solde" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un solde" });
	await dialog.getByLabel("Solde").fill("   ");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog.getByText("Le montant est requis.")).toBeVisible();
	await expect(dialog.getByLabel("Solde")).toHaveAttribute("aria-invalid", "true");
	expect(dryRuns).toEqual([]);

	await dialog.getByLabel("Solde").fill("2 000,00");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(createStep(page)).toBeVisible();
	await createStep(page).getByRole("button", { name: "Annuler" }).click();

	// Back to the form, what was typed kept.
	await expect(createStep(page)).toBeHidden();
	await expect(dialog.getByLabel("Solde")).toHaveValue("2 000,00");
	await expect(dialog.getByLabel("Date", { exact: true })).toBeFocused();
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator("[data-snapshot-id]")).toHaveCount(0);
	await expect(header(page, account.name)).toContainText(euros(100_000));
	expect(dryRuns).toHaveLength(1);
});

test("« Solde d'ouverture » saves its notes alone at once, as Sure's drawer", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await page.getByRole("row", { name: "Solde d'ouverture" }).getByRole("button").click();
	const sheet = page.getByRole("dialog", { name: "Solde d'ouverture" });
	await sheet.getByLabel("Notes").fill("Relevé d'ouverture");
	await sheet.getByRole("button", { name: "Mettre à jour la valeur" }).click();

	await expect(sheet).toBeHidden();
	await expect(updateStep(page)).toHaveCount(0);
	await page.getByRole("row", { name: "Solde d'ouverture" }).getByRole("button").click();
	await expect(sheet.getByLabel("Notes")).toHaveValue("Relevé d'ouverture");
});

test("a refusal at save returns from the step to « Modifier le solde », the date marked", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const date = daysAgo(5);
	await api.recordSnapshot(account.id, { date, balance: "2 000,00" });

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await page.getByRole("button", { name: formatTableDate(date), exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le solde" });
	await dialog.getByLabel("Date", { exact: true }).fill(typed(daysAgo(30)));
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	// The dry run checks only the date's format, as Sure's: the ledger refuses at the save.
	await updateStep(page).getByRole("button", { name: "Mettre à jour", exact: true }).click();

	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByText("Un solde est déjà saisi à cette date. Modifiez-le ou supprimez-le d'abord."),
	).toBeVisible();
	await expect(dialog.getByLabel("Date", { exact: true })).toHaveAttribute("aria-invalid", "true");
	await expect(dialog.getByLabel("Date", { exact: true })).toBeFocused();
	await expect(stored(page, `/api/accounts/${account.id}/snapshots`)).resolves.toMatchObject({
		items: [{ date, balance: 200_000 }],
	});
});

test("a PEA's balance dated before its history reads wholly as positions, as Sure's missing cash", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "25 000,00",
		openingDate: daysAgo(30),
	});

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await page.getByRole("button", { name: "Ajouter un solde" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un solde" });
	await dialog.getByLabel("Date", { exact: true }).fill(typed(daysAgo(40)));
	await dialog.getByLabel("Solde").fill("26 300,00");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(createStep(page).getByRole("definition")).toHaveText([
		euros(2_630_000),
		euros(2_630_000),
		euros(0),
	]);
});

test("« Annuler » on the opening balance's step returns to the sheet, nothing written", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });

	await page.goto(`/accounts/${account.id}?tab=snapshots`);
	await page.getByRole("row", { name: "Solde d'ouverture" }).getByRole("button").click();
	const sheet = page.getByRole("dialog", { name: "Solde d'ouverture" });
	await sheet.getByLabel("Valeur du compte à ce jour").fill("1 500,00");
	await sheet.getByRole("button", { name: "Mettre à jour la valeur" }).click();
	await updateStep(page).getByRole("button", { name: "Annuler" }).click();

	await expect(updateStep(page)).toBeHidden();
	await expect(sheet.getByLabel("Valeur du compte à ce jour")).toHaveValue("1 500,00");
	await expect(stored(page, `/api/accounts/${account.id}`)).resolves.toMatchObject({
		openingDate: daysAgo(30),
		openingBalance: { balance: 100_000 },
	});
});
