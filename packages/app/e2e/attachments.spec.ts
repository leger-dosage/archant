import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { formatFileSize } from "../src/lib/file-size.ts";
import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 19.3: a receipt or an invoice attached to a transaction from its sheet.

const rowButton = (page: Page, label: string) =>
	page.getByRole("main").locator("button[data-transaction-id]").filter({ hasText: label });

const sheet = (page: Page) => page.getByRole("dialog", { name: "Modifier l'opération" });

const section = (page: Page) => sheet(page).getByRole("region", { name: "Pièces jointes" });

const listOf = (page: Page, label: string) =>
	section(page).getByRole("list", { name: `Pièces jointes de « ${label} »` });

const fileInput = (page: Page) => section(page).getByLabel("Fichiers à joindre");

// A 1×1 transparent PNG, which the browser shows when it is opened.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

const PDF = Buffer.from(
	"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n",
);

const png = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });

/** An account with one transaction of -42,00 € two days ago, labelled `<prefix>`. */
async function receiptFor(api: Api, prefix: string) {
	const account = await api.openAccount({ name: uniqueName("Compte joint") });
	const id = await api.addTransaction(account.id, {
		date: daysAgo(2),
		label: prefix,
		amount: "-42,00",
	});

	return { account, id };
}

async function openSheet(page: Page, accountId: string, label: string) {
	await page.goto(`/accounts/${accountId}`);
	await rowButton(page, label).first().click();
	await expect(sheet(page)).toBeVisible();
}

test("files chosen in the sheet are listed with their size, open in a new tab, and go with a confirmation", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Pharmacie");
	const { account } = await receiptFor(api, prefix);

	await openSheet(page, account.id, prefix);
	await expect(section(page)).toContainText("Aucune pièce jointe.");
	await fileInput(page).setInputFiles([
		png("ticket.png"),
		{ name: "facture.pdf", mimeType: "application/pdf", buffer: PDF },
	]);

	const list = listOf(page, prefix);
	await expect(list.getByRole("listitem")).toHaveCount(2);
	await expect(list.getByRole("listitem").nth(0)).toContainText("ticket.png");
	await expect(list.getByRole("listitem").nth(0)).toContainText(formatFileSize(PNG.byteLength));
	await expect(list.getByRole("listitem").nth(1)).toContainText("facture.pdf");
	await expect(list.getByRole("listitem").nth(1)).toContainText(formatFileSize(PDF.byteLength));

	const link = list.getByRole("link", { name: "ticket.png" });
	await expect(link).toHaveAttribute("target", "_blank");
	await expect(link).toHaveAttribute("rel", "noreferrer");
	const opening = page.waitForEvent("popup");
	await link.click();
	const tab = await opening;
	await tab.waitForLoadState();
	await expect.poll(async () => tab.evaluate(() => document.contentType)).toBe("image/png");
	await expect(tab.locator("img")).toBeVisible();
	expect(tab.url()).toMatch(/\/api\/transactions\/[^/]+\/attachments\/[^/]+$/u);
	await tab.close();

	await list.getByRole("button", { name: "Supprimer « ticket.png »" }).click();
	const confirm = page.getByRole("alertdialog", { name: "Supprimer la pièce jointe ?" });
	await expect(confirm).toContainText("« ticket.png » sera supprimée définitivement.");
	await confirm.getByRole("button", { name: "Supprimer" }).click();

	await expect(confirm).toBeHidden();
	await expect(list.getByRole("listitem")).toHaveCount(1);
	await expect(list).toContainText("facture.pdf");
	// Attachments save at once and never touch the form: nothing to discard.
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();
});

test("a file over 10 MB, a page named .pdf and an eleventh are refused under the list, naming each file", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Garage");
	const { account, id } = await receiptFor(api, prefix);
	// One after the other: each is an immediate ledger write.
	await Array.from({ length: 9 }, (_, index) => index + 1).reduce(async (previous, index) => {
		await previous;
		await api.attachFile(id, png(`photo-${String(index)}.png`));
	}, Promise.resolve());

	await openSheet(page, account.id, prefix);
	await expect(listOf(page, prefix).getByRole("listitem")).toHaveCount(9);
	await fileInput(page).setInputFiles([
		{
			name: "scan.png",
			mimeType: "image/png",
			buffer: Buffer.concat([PNG, Buffer.alloc(12 * 1024 * 1024)]),
		},
		{
			name: "facture.pdf",
			mimeType: "application/pdf",
			buffer: Buffer.from("<html><script>alert(1)</script></html>"),
		},
		png("dixieme.png"),
		png("onzieme.png"),
	]);

	await expect(listOf(page, prefix).getByRole("listitem")).toHaveCount(10);
	await expect(listOf(page, prefix)).toContainText("dixieme.png");
	const refusals = section(page).getByRole("alert");
	await expect(refusals).toContainText("« scan.png » : Ce fichier dépasse 10 Mo.");
	await expect(refusals).toContainText(
		"« facture.pdf » : Seules les images JPEG, PNG, GIF ou WebP et les PDF sont acceptés.",
	);
	await expect(refusals).toContainText(
		"« onzieme.png » : Une opération compte 10 pièces jointes au plus.",
	);
	await expect(section(page).getByRole("button", { name: "Ajouter" })).toBeDisabled();
	await expect(section(page)).toContainText(
		"Supprimez une pièce jointe pour en ajouter une autre.",
	);
});

test("a split's line has attachments of its own", async ({ page, api }) => {
	const prefix = uniqueName("Hyper");
	const { account, id } = await receiptFor(api, prefix);
	const [food = ""] = await api.splitTransaction(id, [
		{ label: `${prefix} courses`, amount: "-30,00" },
		{ label: `${prefix} maison`, amount: "-12,00" },
	]);
	await api.attachFile(food, png("courses.png"));
	await api.attachFile(id, png("ticket-entier.png"));

	await openSheet(page, account.id, `${prefix} courses`);
	await expect(listOf(page, `${prefix} courses`).getByRole("listitem")).toHaveCount(1);
	await expect(listOf(page, `${prefix} courses`)).toContainText("courses.png");
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

	await rowButton(page, `${prefix} maison`).click();
	await expect(sheet(page)).toBeVisible();
	await expect(section(page)).toContainText("Aucune pièce jointe.");
	await fileInput(page).setInputFiles(png("maison.png"));
	await expect(listOf(page, `${prefix} maison`)).toContainText("maison.png");
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

	await rowButton(page, prefix).first().click();
	await expect(sheet(page)).toBeVisible();
	await expect(listOf(page, prefix).getByRole("listitem")).toHaveCount(1);
	await expect(listOf(page, prefix)).toContainText("ticket-entier.png");
	// Undoing the split deletes the lines, and their files with them.
	await sheet(page).getByRole("button", { name: "Annuler la division" }).click();
	await expect(page.getByRole("alertdialog")).toContainText(
		"Les 2 pièces jointes de ses lignes seront supprimées aussi.",
	);
	await page.getByRole("alertdialog").getByRole("button", { name: "Garder la division" }).click();
	await expect(page.getByRole("alertdialog")).toBeHidden();
	// The parent goes with its lines, and every one of their files with them.
	await sheet(page).getByRole("button", { name: "Supprimer", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toContainText(
		"3 pièces jointes seront supprimées aussi.",
	);
});

test("the delete confirmation counts the attachments that go with the transaction", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Opticien");
	const { account, id } = await receiptFor(api, prefix);
	const lone = await api.addTransaction(account.id, {
		date: daysAgo(3),
		label: `${prefix} seule`,
		amount: "-5,00",
	});
	await api.attachFile(id, png("ordonnance.png"));
	await api.attachFile(id, png("facture.png"));
	await api.attachFile(lone, png("recu.png"));

	await openSheet(page, account.id, `${prefix} seule`);
	await sheet(page).getByRole("button", { name: "Supprimer", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toContainText("1 pièce jointe sera supprimée aussi.");
	await page.getByRole("alertdialog").getByRole("button", { name: "Annuler" }).click();
	// The sheet is hidden from the accessibility tree while the dialog is open.
	await expect(page.getByRole("alertdialog")).toBeHidden();
	await expect(sheet(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

	await rowButton(page, prefix).first().click();
	await expect(sheet(page)).toBeVisible();
	await sheet(page).getByRole("button", { name: "Supprimer", exact: true }).click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm).toContainText("2 pièces jointes seront supprimées aussi.");
	await confirm.getByRole("button", { name: "Supprimer" }).click();

	await expect(sheet(page)).toBeHidden();
	await expect(rowButton(page, `${prefix} seule`)).toBeVisible();
	await expect(page.getByRole("main").getByText(prefix, { exact: true })).toHaveCount(0);
});
