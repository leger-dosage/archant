import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { randomInt } from "node:crypto";

import { createDb } from "@archant/data/client";

import { FAKE_ACCOUNTS, FAKE_LINES, TIP_BANK, TIP_LINE } from "./fake-enable-banking.ts";
import { daysAgo, euros, expect, sgml, test, uniqueName } from "./fixtures.ts";
import { DATABASE_FILE, WEB_URL } from "./settings.ts";

// Story 10.6: a line an import found two entries equally near is created
// flagged « Doublon possible », then merged into one of them or dismissed.

const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

const rowButton = (page: Page, label: string) =>
	rowItem(page, label).locator("button[data-transaction-id]");

const sheet = (page: Page) => page.getByRole("dialog", { name: "Modifier l'opération" });

const mergeDialog = (page: Page) => page.getByRole("dialog", { name: "Fusionner avec…" });

/**
 * Two entries typed by hand on the 6th and the 4th day before today, then an
 * OFX line of the same amount on the 5th: equally near both, it is created
 * flagged. Manual entries carry no key, so both are its candidates.
 */
async function tie(api: Api, prefix: string) {
	const account = await api.openAccount({ name: uniqueName("Compte courant") });
	const amount = `-${randomInt(100, 900)},${String(randomInt(100)).padStart(2, "0")}`;
	const survivor = `${prefix} saisie A`;
	const other = `${prefix} saisie B`;
	const imported = `${prefix} import`;
	await api.addTransaction(account.id, { date: daysAgo(6), label: survivor, amount });
	await api.addTransaction(account.id, { date: daysAgo(4), label: other, amount });
	const file = sgml([{ daysAgo: 5, amount, label: imported, fitid: uniqueName("FIT") }]);
	await api.importFile(account.id, file);

	return { account, survivor, other, imported, file };
}

async function visitOperations(page: Page, q: string) {
	await page.goto(`/transactions?q=${encodeURIComponent(q)}`);
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await expect(rowItem(page, q).first()).toBeVisible();
}

test("a tie shows « Doublon possible », and « Fusionner avec… » keeps the one picked", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Péage");
	const { survivor, other, imported } = await tie(api, prefix);
	const tag = await api.createTag();

	await visitOperations(page, prefix);
	const flaggedId = (await rowButton(page, imported).getAttribute("data-transaction-id")) ?? "";
	await api.setTags([flaggedId], [tag.id]);
	await page.reload();

	await expect(rowButton(page, imported)).toContainText("Doublon possible");
	await expect(rowButton(page, survivor)).not.toContainText("Doublon possible");
	await rowButton(page, imported).click();
	await expect(sheet(page).getByText("Doublon possible")).toBeVisible();
	await sheet(page).getByRole("button", { name: "Fusionner avec…" }).click();

	await expect(mergeDialog(page).getByRole("radio")).toHaveCount(2);
	await expect(mergeDialog(page).getByRole("button", { name: "Fusionner" })).toBeDisabled();
	await mergeDialog(page)
		.getByRole("radio", { name: new RegExp(survivor) })
		.check();
	await mergeDialog(page).getByRole("button", { name: "Fusionner" }).click();

	await expect(sheet(page)).toBeHidden();
	await expect(page.getByText("Opérations fusionnées")).toBeVisible();
	await expect(rowItem(page, imported)).toHaveCount(0);
	await expect(
		page.getByRole("main").getByRole("listitem").filter({ hasText: prefix }),
	).toHaveCount(2);
	await expect(rowButton(page, survivor)).toContainText(tag.name);
	await expect(rowButton(page, other)).not.toContainText(tag.name);
	await expect(rowButton(page, survivor)).toBeFocused();
});

test("« Ce n'est pas un doublon » removes the marker, and importing the file again adds nothing", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Péage");
	const { account, imported, file } = await tie(api, prefix);

	await visitOperations(page, prefix);
	await rowButton(page, imported).click();
	await sheet(page).getByRole("button", { name: "Ce n'est pas un doublon" }).click();

	await expect(page.getByText("Ce n'est plus signalé comme doublon")).toBeVisible();
	await expect(sheet(page).getByText("Doublon possible")).toBeHidden();
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();
	await expect(rowButton(page, imported)).not.toContainText("Doublon possible");

	await api.importFile(account.id, file);
	await page.reload();

	const rows = page.getByRole("main").getByRole("listitem").filter({ hasText: prefix });
	await expect(rows).toHaveCount(3);
	await expect(rows.filter({ hasText: "Doublon possible" })).toHaveCount(0);
});

// Story 29.7: a pending line booked at another amount, a tip, is suggested
// on the pending row, as Sure's « Doublon ? », and merged from its sheet.

const CONNECTION_URL = /\/settings\/banks\/([0-9a-f-]{36})$/u;

const toast = (page: Page, text: string) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

const bankRows = (page: Page, label: string) =>
	page.getByRole("main").getByRole("button", { name: new RegExp(label, "u") });

/** Two hours ago, past the hour the button waits between two syncs. */
async function syncedHoursAgo(connectionId: string) {
	const db = await createDb(`file:${DATABASE_FILE}`);

	try {
		await db.$client.execute({
			sql: "update bank_connections set last_synced_at = ? where id = ?",
			args: [Date.now() - 2 * 60 * 60_000, connectionId],
		});
	} finally {
		db.$client.close();
	}
}

/**
 * Connects `TIP_BANK` and links its current account, which syncs the pending
 * bill; returns the connection's id and the account's.
 */
async function connectTipBank(page: Page) {
	await page.goto("/settings/banks");
	await page
		.getByRole("region", { name: "Connecter une banque" })
		.getByRole("button", { name: "Choisir une banque" })
		.click();
	await page
		.getByRole("dialog", { name: "Choisir une banque" })
		.getByRole("button", { name: `Connecter ${TIP_BANK}` })
		.click();
	await expect(toast(page, `${TIP_BANK} est connectée.`)).toBeVisible();
	await expect(page).toHaveURL(CONNECTION_URL);
	const connectionId = CONNECTION_URL.exec(page.url())?.[1] ?? "";

	await page.getByRole("combobox", { name: `Que faire de ${FAKE_ACCOUNTS.card.name}` }).click();
	await page.getByRole("option", { name: "Ignorer", exact: true }).click();
	await page.getByRole("button", { name: "Valider" }).click();
	await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
	await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();
	const link = page
		.getByRole("list", { name: "Comptes de la banque" })
		.getByRole("link", { name: FAKE_ACCOUNTS.checking.name });
	const accountId = (await link.getAttribute("href"))?.split("/").at(-1) ?? "";

	return { connectionId, accountId };
}

test("a sync suggests the pending bill booked with a tip, and « Oui, fusionnez-les » leaves one line", async ({
	page,
	request,
}) => {
	const { connectionId, accountId } = await connectTipBank(page);

	try {
		await page.goto(`/accounts/${accountId}`);
		await expect(bankRows(page, TIP_LINE.label)).toHaveCount(1);
		await expect(bankRows(page, TIP_LINE.label)).not.toContainText("Doublon ?");

		// The bank books the bill with the tip: the next sync suggests the two are one.
		await syncedHoursAgo(connectionId);
		await page.goto(`/settings/banks/${connectionId}`);
		await page.getByRole("button", { name: "Synchroniser" }).click();
		await expect(toast(page, "Synchronisation terminée.")).toBeVisible();
		await page.goto(`/accounts/${accountId}`);

		const suggested = bankRows(page, TIP_LINE.label).filter({ hasText: "Doublon ?" });
		await expect(bankRows(page, TIP_LINE.label)).toHaveCount(2);
		await expect(suggested).toHaveCount(1);
		await expect(suggested).toContainText("En attente");
		await suggested.click();

		const alert = sheet(page).getByRole("region", { name: "Doublon possible détecté" });
		await expect(alert).toContainText(TIP_LINE.label);
		await expect(alert).toContainText(euros(-2300));
		await alert.getByRole("button", { name: "Oui, fusionnez-les" }).click();

		await expect(sheet(page)).toBeHidden();
		await expect(toast(page, "Opérations fusionnées avec succès")).toBeVisible();
		await expect(bankRows(page, TIP_LINE.label)).toHaveCount(1);
		await expect(bankRows(page, TIP_LINE.label)).not.toContainText("Doublon ?");
		await expect(bankRows(page, TIP_LINE.label)).not.toContainText("En attente");
		await expect(bankRows(page, TIP_LINE.label)).toContainText(euros(-2300));

		// « Ouvrir la fusion » merges any pending line by hand into a booked one.
		await bankRows(page, FAKE_LINES.pending.label).click();
		await sheet(page).getByRole("button", { name: "Ouvrir la fusion" }).click();
		const dialog = page.getByRole("dialog", { name: "Fusionner avec une opération validée" });
		const submit = dialog.getByRole("button", { name: "Fusionner les opérations" });
		await expect(dialog.getByRole("radio").first()).toBeVisible();
		await expect(submit).toBeDisabled();
		await dialog.getByRole("radio", { name: new RegExp(TIP_LINE.label, "u") }).check();
		await submit.click();

		await expect(dialog).toBeHidden();
		await expect(
			toast(page, "Opération en attente fusionnée avec l'opération validée"),
		).toBeVisible();
		await expect(bankRows(page, FAKE_LINES.pending.label)).toHaveCount(0);
		// The merged row's reads, refetched as the sheet closes, find it gone in silence.
		await page.waitForLoadState("networkidle");
		await expect(toast(page, "Cette ressource n'existe pas.")).toHaveCount(0);
	} finally {
		await request.delete(`/api/bank-connections/${connectionId}`, { headers: { origin: WEB_URL } });
	}
});
