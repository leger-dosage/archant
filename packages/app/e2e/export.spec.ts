import { readFile } from "node:fs/promises";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 18.1: « Réglages › Données » says what the archive holds, and
// downloads it under Sure's kind of name.

test("« Réglages › Données » lists what the archive holds and leaves out, and downloads it", async ({
	api,
	page,
}) => {
	const account = await api.openAccount({ name: uniqueName("Export") });
	await api.addTransaction(account.id, { date: daysAgo(1), label: "Boulangerie", amount: "-4,20" });

	await page.goto("/settings/categories");
	await page.getByRole("link", { name: "Données" }).click();

	await expect(page).toHaveURL(/\/settings\/data$/u);
	await expect(page.getByRole("heading", { level: 1, name: "Données" })).toBeVisible();
	await expect(page).toHaveTitle("Données · Archant");
	const holds = page.getByRole("region", { name: "Ce que l'archive contient" });
	await expect(holds.getByRole("listitem")).toHaveCount(8);
	await expect(holds.getByText("Vos budgets, mois par mois")).toBeVisible();
	const leavesOut = page.getByRole("region", { name: "Ce qu'elle laisse de côté" });
	await expect(
		leavesOut.getByText("Votre mot de passe, vos sessions, vos clés et vos jetons"),
	).toBeVisible();
	await expect(
		page.getByText("les montants suivent le signe de Sure", { exact: false }),
	).toBeVisible();
	await expect(page.getByText("Ce n'est pas une sauvegarde", { exact: false })).toBeVisible();

	const downloading = page.waitForEvent("download");
	await page.getByRole("link", { name: "Exporter mes données" }).click();
	const download = await downloading;

	expect(download.suggestedFilename()).toMatch(/^archant_export_\d{8}_\d{6}\.zip$/u);
	const bytes = await readFile(await download.path());
	// A ZIP's local headers name each entry in clear, before its deflated bytes.
	expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
	for (const entry of ["version.txt", "accounts.csv", "transactions.csv", "all.ndjson"]) {
		expect(bytes.includes(Buffer.from(entry))).toBe(true);
	}
});
