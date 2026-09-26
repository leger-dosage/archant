import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { randomInt } from "node:crypto";

import { daysAgo, expect, sgml, test, uniqueName } from "./fixtures.ts";

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
