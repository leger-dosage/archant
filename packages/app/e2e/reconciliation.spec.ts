import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

test.afterEach(async ({ request }) => {
	const response = await request.patch("/api/preferences", {
		data: { manualReconciliation: false },
	});
	expect(response.ok()).toBe(true);
});

test("reconciles from the list and sheet, filters statuses, pauses, and reconciles in bulk", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Club");
	const label = `${prefix} Cotisation`;
	const account = await api.openAccount({ name: uniqueName("Compte du relevé") });
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-12,34" });
	const operations = `/transactions?q=${encodeURIComponent(label)}`;
	const rowFor = (name: string) =>
		page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
	const row = rowFor(label);
	const status = (name: string) => row.getByRole("button", { name, exact: true });
	const preferences = "/settings/preferences";
	const setting = () => page.getByRole("switch", { name: "Rapprochement manuel" });

	await page.emulateMedia({ colorScheme: "light" });
	await page.goto(operations);
	await expect(row).toBeVisible();
	await expect(status("Non pointée")).toHaveCount(0);

	await page.goto(preferences);
	await expect(setting()).not.toBeChecked({ timeout: 4000 });
	await setting().click();
	await expect(setting()).toBeChecked();

	await page.goto(operations);
	await status("Non pointée").click();
	await expect(status("Pointée")).toBeVisible();
	await row.locator("button[data-transaction-id]").click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await sheet.getByRole("button", { name: /pointée/i }).click();
	await expect(sheet.getByRole("button", { name: /rapprochée/i })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(status("Rapprochée")).toBeVisible();

	await page.getByRole("button", { name: "Filtrer" }).click();
	await page.getByRole("button", { name: "Rapprochement", exact: true }).click();
	await page.getByRole("checkbox", { name: "Pointée", exact: true }).click();
	await page.getByRole("button", { name: "Appliquer", exact: true }).click();
	await expect(row).toHaveCount(0);
	await expect(page.getByRole("checkbox", { name: "Pointée", exact: true })).toBeHidden();
	await page.getByRole("button", { name: "Pointée", exact: true }).click();
	await page.getByRole("checkbox", { name: "Rapprochée", exact: true }).click();
	await page.getByRole("button", { name: "Appliquer", exact: true }).click();
	await expect(row).toBeVisible();
	await page.keyboard.press("Escape");

	await page.goto(preferences);
	await setting().click();
	await expect(setting()).not.toBeChecked();
	await page.goto(operations);
	await expect(row).toBeVisible();
	await expect(status("Rapprochée")).toHaveCount(0);

	await page.goto(preferences);
	await setting().click();
	await expect(setting()).toBeChecked();
	await page.goto(operations);
	await expect(status("Rapprochée")).toBeVisible();
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(status("Rapprochée")).toBeVisible();
	await status("Rapprochée").click();
	await expect(status("Non pointée")).toBeVisible();

	const other = `${prefix} Remboursement`;
	await api.addTransaction(account.id, { date: daysAgo(1), label: other, amount: "22,10" });
	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
	await page.getByRole("checkbox", { name: `Sélectionner « ${label} »` }).check();
	await page.getByRole("checkbox", { name: `Sélectionner « ${other} »` }).check();
	await page
		.getByRole("toolbar", { name: "Actions sur la sélection" })
		.getByRole("button", { name: "Modifier" })
		.click();
	const bulk = page.getByRole("dialog", { name: "Modifier les opérations" });
	await bulk.getByRole("combobox", { name: "Rapprochement" }).click();
	await page.getByRole("option", { name: "Pointée", exact: true }).click();
	await bulk.getByRole("button", { name: "Enregistrer" }).click();
	await expect(bulk).toBeHidden();
	await expect(status("Pointée")).toBeVisible();
	await expect(rowFor(other).getByRole("button", { name: "Pointée", exact: true })).toBeVisible();
});
