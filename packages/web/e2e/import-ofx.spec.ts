import type { Page } from "@playwright/test";

import { toMinorUnits } from "@archant/data/money";

import { formatShortDate, formatSignedMoney, formatTableDate } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

// Stories 2.1 and 2.2: import an OFX file with preview, and its ledger
// balance. Files are built here with dates relative to today, so they always
// fall after the account's opening date, which `openAccount` puts 30 days ago.

type Line = { daysAgo: number; amount: string; label: string; fitid: string };

const ofxDate = (days: number) => daysAgo(days).replaceAll("-", "");

type SgmlOptions = {
	/** `LEDGERBAL`, signed as the bank prints it; none when absent. */
	ledger?: { amount: string; daysAgo: number };
	/** A credit card statement, `CCSTMTRS`, rather than a bank one. */
	card?: boolean;
};

/** An OFX 1.x SGML statement: unclosed leaves, an empty MEMO, decimal commas. */
function sgml(lines: Line[], options: SgmlOptions = {}): Buffer {
	const transactions = lines.map((line) =>
		[
			"<STMTTRN>",
			"<TRNTYPE>OTHER",
			`<DTPOSTED>${ofxDate(line.daysAgo)}`,
			`<TRNAMT>${line.amount}`,
			`<FITID>${line.fitid}`,
			`<NAME>${line.label}`,
			"<MEMO>",
			"</STMTTRN>",
		].join("\r\n"),
	);
	const text = [
		"OFXHEADER:100",
		"DATA:OFXSGML",
		"VERSION:102",
		"CHARSET:1252",
		"",
		"<OFX>",
		options.card === true
			? "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>"
			: "<BANKMSGSRSV1><STMTTRNRS><STMTRS>",
		"<CURDEF>EUR",
		"<BANKTRANLIST>",
		...transactions,
		"</BANKTRANLIST>",
		...(options.ledger === undefined
			? []
			: [
					"<LEDGERBAL>",
					`<BALAMT>${options.ledger.amount}`,
					`<DTASOF>${ofxDate(options.ledger.daysAgo)}`,
					"</LEDGERBAL>",
				]),
		options.card === true
			? "</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>"
			: "</STMTRS></STMTTRNRS></BANKMSGSRSV1>",
		"</OFX>",
	].join("\r\n");

	return Buffer.from(text, "latin1");
}

/** An OFX 2.x XML statement in UTF-8, every tag closed, decimal points. */
function xml(lines: Line[]): Buffer {
	const transactions = lines.map(
		(line) =>
			`<STMTTRN><TRNTYPE>OTHER</TRNTYPE><DTPOSTED>${ofxDate(line.daysAgo)}120000.000[+2:CEST]</DTPOSTED><TRNAMT>${line.amount.replace(",", ".")}</TRNAMT><FITID>${line.fitid}</FITID><NAME>${line.label}</NAME><MEMO></MEMO></STMTTRN>`,
	);

	return Buffer.from(
		[
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>',
			"<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR</CURDEF><BANKTRANLIST>",
			...transactions,
			"</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
		].join("\n"),
		"utf8",
	);
}

/** Three lines with labels no other test uses, and a FITID of their own. */
function threeLines(): [Line, Line, Line] {
	const id = uniqueName("F").replace(" ", "-");

	return [
		{ daysAgo: 12, amount: "-42,90", label: uniqueName("CB CAFÉ"), fitid: `${id}-1` },
		{ daysAgo: 8, amount: "-87,12", label: uniqueName("PRLV ÉLECTRICITÉ"), fitid: `${id}-2` },
		{ daysAgo: 5, amount: "2150,00", label: uniqueName("VIR SALAIRE"), fitid: `${id}-3` },
	];
}

const header = (page: Page, name: string) =>
	page.getByRole("heading", { level: 1, name }).locator("..");

const dialog = (page: Page) => page.getByRole("dialog", { name: "Importer un fichier" });

const tab = (page: Page, name: string, count: number) =>
	dialog(page).getByRole("tab", { name: `${name} ${count}` });

async function openImport(page: Page, accountId: string, name: string) {
	await page.goto(`/comptes/${accountId}`);
	await expect(header(page, name)).toBeVisible();
	await page.getByRole("button", { name: "Importer", exact: true }).click();
	await expect(dialog(page)).toBeVisible();
}

async function choose(page: Page, buffer: Buffer, name = "releve.ofx") {
	await dialog(page)
		.getByLabel("Relevé bancaire")
		.setInputFiles({ name, mimeType: "application/x-ofx", buffer });
}

test.describe("OFX files 1.x and 2.x", () => {
	for (const [format, build] of [
		["1.x SGML", sgml],
		["2.x XML", xml],
	] as const) {
		test(`an OFX ${format} file shows its preview with counts and writes nothing`, async ({
			page,
			api,
			request,
		}) => {
			const account = await api.openAccount({ openingBalance: "1 000,00" });
			const lines = threeLines();

			await openImport(page, account.id, account.name);
			await choose(page, build(lines));

			await expect(dialog(page).locator('[aria-current="step"]')).toHaveText(/Aperçu/u);
			await expect(tab(page, "À créer", 3)).toHaveAttribute("aria-selected", "true");
			await expect(tab(page, "Déjà présentes", 0)).toBeVisible();
			await expect(tab(page, "Rapprochées", 0)).toBeVisible();
			await expect(tab(page, "Doublons possibles", 0)).toBeVisible();
			await expect(tab(page, "Rejetées", 0)).toBeVisible();
			await expect(dialog(page).getByRole("status")).toHaveText(
				"3 à créer, 0 déjà présentes, 0 rapprochées, 0 doublons possibles, 0 rejetées.",
			);
			// Accented labels survive windows-1252 and UTF-8 alike.
			await expect(dialog(page).getByRole("cell", { name: lines[0].label })).toBeVisible();
			await expect(
				dialog(page).getByRole("button", { name: "Importer 3 opérations" }),
			).toBeEnabled();

			const response = await request.get(`/api/accounts/${account.id}/transactions`);
			expect(await response.json()).toMatchObject({ data: { total: 0 } });
			await dialog(page).getByRole("button", { name: "Annuler" }).click();
			await expect(dialog(page)).toBeHidden();
			await expect(header(page, account.name)).toContainText(euros(100_000));
			await expect(page.getByText("Aucune opération.")).toBeVisible();
		});
	}
});

test("confirming writes the lines, moves the balance and gives the counts", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00" });
	const lines = threeLines();

	await openImport(page, account.id, account.name);
	await choose(page, sgml(lines));
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(page.getByText("3 opérations importées.")).toBeVisible();
	await expect(header(page, account.name)).toContainText(euros(100_000 - 4290 - 8712 + 215_000));
	const cafe = page.getByRole("main").getByRole("button", { name: new RegExp(lines[0].label) });
	await expect(cafe).toContainText(euros(-4290));

	await cafe.click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(sheet.getByText(`Import OFX du ${formatShortDate(daysAgo(0))}`)).toBeVisible();
});

test("the same file again is already present, and confirm is disabled", async ({ page, api }) => {
	const account = await api.openAccount();
	const file = sgml(threeLines());

	await openImport(page, account.id, account.name);
	await choose(page, file);
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();
	await expect(dialog(page)).toBeHidden();

	await page.keyboard.press("i");
	await expect(dialog(page)).toBeVisible();
	await choose(page, file);

	await expect(tab(page, "Déjà présentes", 3)).toHaveAttribute("aria-selected", "true");
	await expect(tab(page, "À créer", 0)).toBeVisible();
	await expect(
		dialog(page).getByText("Toutes les opérations de ce fichier sont déjà présentes."),
	).toBeVisible();
	await expect(dialog(page).getByRole("button", { name: /^Importer 0 opération/u })).toBeDisabled();
});

test("lines before the opening date can go in by moving it, keeping today's balance", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00", openingDate: daysAgo(30) });
	const [first, second] = threeLines();
	const lines = [
		{ daysAgo: 35, amount: "-20,00", label: first.label, fitid: first.fitid },
		{ daysAgo: 30, amount: "50,00", label: second.label, fitid: second.fitid },
	];

	await openImport(page, account.id, account.name);
	await choose(page, sgml(lines));

	await expect(tab(page, "Rejetées", 2)).toHaveAttribute("aria-selected", "true");
	await expect(
		dialog(page).getByRole("cell", { name: "Datée au plus tard le jour d'ouverture du compte" }),
	).toHaveCount(2);
	await dialog(page)
		.getByRole("button", { name: `Avancer la date d'ouverture au ${formatTableDate(daysAgo(36))}` })
		.click();

	await expect(tab(page, "À créer", 2)).toHaveAttribute("aria-selected", "true");
	await expect(tab(page, "Rejetées", 0)).toBeVisible();
	// 1 000,00 − (−20,00 + 50,00): the old opening day still ends at 1 000,00.
	await expect(
		dialog(page).getByText(
			`La date d'ouverture passera au ${formatTableDate(daysAgo(36))}, avec un solde initial de ${euros(97_000)}. Le solde du ${formatTableDate(daysAgo(30))}, date d'ouverture actuelle, ne change pas.`,
		),
	).toBeVisible();
	await dialog(page).getByRole("button", { name: "Importer 2 opérations" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(page.getByText("2 opérations importées.")).toBeVisible();
	await expect(header(page, account.name)).toContainText(euros(100_000));
	await expect(
		page.getByRole("main").getByRole("button", { name: new RegExp(first.label) }),
	).toBeVisible();
});

test("a transaction added since the preview shows the stale message over the new preview", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const lines = threeLines();

	await openImport(page, account.id, account.name);
	await choose(page, sgml(lines));
	await expect(tab(page, "À créer", 3)).toBeVisible();
	await api.addTransaction(account.id, { date: daysAgo(11), label: "Café", amount: "-42,90" });

	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();

	await expect(dialog(page).getByRole("alert")).toHaveText(
		"Le compte a changé depuis l'aperçu. Vérifiez avant d'importer.",
	);
	await expect(tab(page, "À créer", 2)).toBeVisible();
	await expect(tab(page, "Rapprochées", 1)).toBeVisible();
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();
	await expect(dialog(page)).toBeHidden();
	await expect(page.getByText("3 opérations importées.")).toBeVisible();
});

test("a text file shows the unreadable-file message", async ({ page, api }) => {
	const account = await api.openAccount();

	await openImport(page, account.id, account.name);
	await choose(page, Buffer.from("Liste de courses : pain, lait", "utf8"), "courses.txt");

	await expect(dialog(page).getByRole("alert")).toHaveText(
		"Ce fichier n'est pas un relevé bancaire lisible.",
	);
	await expect(dialog(page).locator('[aria-current="step"]')).toHaveText(/Fichier/u);
});

test("the palette offers the import on an account page, and a narrow screen is told to use a computer", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();

	await page.goto(`/comptes/${account.id}`);
	await expect(header(page, account.name)).toBeVisible();
	await page.keyboard.press("ControlOrMeta+K");
	await page
		.getByRole("dialog", { name: "Palette de commandes" })
		.getByRole("combobox")
		.fill("importer");
	await page.keyboard.press("Enter");
	await expect(dialog(page).getByLabel("Relevé bancaire")).toBeVisible();
	await page.keyboard.press("Escape");

	await page.setViewportSize({ width: 600, height: 900 });
	await page.getByRole("button", { name: "Importer", exact: true }).click();
	await expect(dialog(page).getByText("Disponible sur ordinateur")).toBeVisible();
	await expect(dialog(page).getByLabel("Relevé bancaire")).toHaveCount(0);
});

// Story 2.2: the file's LEDGERBAL becomes a snapshot.

// Anchored: « 1 septembre 2026 » is also the end of « 11 septembre 2026 ».
const snapshotRow = (page: Page, iso: string) =>
	page.getByRole("row", { name: new RegExp(`^${formatTableDate(iso)} `, "u") });

async function openSnapshots(page: Page) {
	await page.getByRole("tab", { name: "Soldes" }).click();
	await expect(page.getByRole("tab", { name: "Soldes" })).toHaveAttribute("aria-selected", "true");
}

test("the file's ledger balance is stated in the preview, then sets the balance and joins Soldes", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00" });
	const date = daysAgo(2);

	await openImport(page, account.id, account.name);
	await choose(page, sgml(threeLines(), { ledger: { amount: "2408,61", daysAgo: 2 } }));

	await expect(
		dialog(page).getByText(
			`Le relevé indique un solde de ${euros(240_861)} au ${formatTableDate(date)}. Il sera enregistré dans l'onglet Soldes.`,
		),
	).toBeVisible();
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(header(page, account.name)).toContainText(euros(240_861));
	await openSnapshots(page);
	await expect(snapshotRow(page, date)).toContainText(euros(240_861));
});

test("a snapshot I typed on the statement date is kept, and the preview gives the gap", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00" });
	const date = daysAgo(2);
	await api.recordSnapshot(account.id, { date, balance: "2 400,00" });

	await openImport(page, account.id, account.name);
	await choose(page, sgml(threeLines(), { ledger: { amount: "2408,61", daysAgo: 2 } }));

	await expect(
		dialog(page).getByText(
			`Vous avez saisi un solde de ${euros(240_000)} au ${formatTableDate(date)}, il est conservé. Le relevé indique ${euros(240_861)}, soit un écart de ${formatSignedMoney(toMinorUnits(861), "EUR")}.`,
		),
	).toBeVisible();
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(header(page, account.name)).toContainText(euros(240_000));
	await openSnapshots(page);
	await expect(snapshotRow(page, date)).toContainText(euros(240_000));
	await expect(page.getByRole("main").getByText(euros(240_861))).toHaveCount(0);
});

test("a card file's negative ledger balance shows as a positive amount owed", async ({
	page,
	api,
}) => {
	const card = await api.openAccount({ kind: "credit_card", openingBalance: "0,00" });
	const [purchase] = threeLines();

	await openImport(page, card.id, card.name);
	await choose(
		page,
		sgml([{ ...purchase, amount: "-123,40" }], {
			card: true,
			ledger: { amount: "-512,30", daysAgo: 1 },
		}),
	);

	await expect(
		dialog(page).getByText(
			`Le relevé indique un solde de ${euros(51_230)} au ${formatTableDate(daysAgo(1))}. Il sera enregistré dans l'onglet Soldes.`,
		),
	).toBeVisible();
	await dialog(page).getByRole("button", { name: "Importer 1 opération" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(header(page, card.name)).toContainText(euros(51_230));
	await expect(header(page, card.name)).not.toContainText(euros(-51_230));
});

test("a file without a ledger balance states none and leaves Soldes empty", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();

	await openImport(page, account.id, account.name);
	await choose(page, sgml(threeLines()));

	await expect(tab(page, "À créer", 3)).toBeVisible();
	await expect(
		dialog(page).getByText(/relevé indique|solde du relevé|Vous avez saisi un solde/u),
	).toHaveCount(0);
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();

	await expect(dialog(page)).toBeHidden();
	await openSnapshots(page);
	await expect(page.getByText("Aucun solde saisi.")).toBeVisible();
});

test("a ledger balance dated before the opening date is not recorded, and the preview says why", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(30) });

	await openImport(page, account.id, account.name);
	await choose(page, sgml(threeLines(), { ledger: { amount: "2408,61", daysAgo: 40 } }));

	await expect(
		dialog(page).getByText(
			`Le solde du relevé au ${formatTableDate(daysAgo(40))} ne sera pas enregistré : il précède la date d'ouverture du compte.`,
		),
	).toBeVisible();
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();

	await expect(dialog(page)).toBeHidden();
	await openSnapshots(page);
	await expect(page.getByText("Aucun solde saisi.")).toBeVisible();
});

test("the same lines with a later ledger balance offer « Enregistrer le solde », and the balance follows", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "1 000,00" });
	const lines = threeLines();
	await openImport(page, account.id, account.name);
	await choose(page, sgml(lines, { ledger: { amount: "2408,61", daysAgo: 2 } }));
	await dialog(page).getByRole("button", { name: "Importer 3 opérations" }).click();
	await expect(dialog(page)).toBeHidden();
	await expect(header(page, account.name)).toContainText(euros(240_861));

	await page.keyboard.press("i");
	await expect(dialog(page)).toBeVisible();
	await choose(page, sgml(lines, { ledger: { amount: "2500,00", daysAgo: 1 } }));

	await expect(tab(page, "Déjà présentes", 3)).toHaveAttribute("aria-selected", "true");
	await expect(
		dialog(page).getByText("Toutes les opérations de ce fichier sont déjà présentes."),
	).toHaveCount(0);
	await dialog(page).getByRole("button", { name: "Enregistrer le solde" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(page.getByText("Solde du relevé enregistré.")).toBeVisible();
	await expect(header(page, account.name)).toContainText(euros(250_000));
});
