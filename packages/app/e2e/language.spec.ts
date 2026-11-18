import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";
import { ADMIN, ADMIN_FIRST_NAME, WEB_URL } from "./settings.ts";

// Story 37.1: a browser that asks for English reads the interface in English
// while the user has chosen nothing. Only the browser's language changes: the
// administrator's saved language is shared by the whole run and stays null.
test.use({ locale: "en-US" });

test("a browser in English reads the interface in English, « Langue du navigateur » selected", async ({
	page,
}) => {
	await page.goto("/");

	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	const rail = page.getByRole("navigation", { name: "Main navigation" });
	await expect(rail.getByRole("link", { name: "Settings" })).toBeVisible();

	await rail.getByRole("link", { name: "Settings" }).click();
	await page
		.getByRole("navigation", { name: "Settings" })
		.getByRole("link", { name: "Preferences" })
		.click();

	await expect(page.getByRole("heading", { level: 1, name: "Preferences" })).toBeVisible();
	await expect(page.getByRole("combobox", { name: "Language", exact: true })).toHaveText(
		"Browser language",
	);
});

test.describe("an English browser from sign-in to dashboard", () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test("signs in, adds an account and imports a statement in English", async ({ page }) => {
		const accountName = uniqueName("Everyday account");
		const transactionName = uniqueName("Bookshop");

		await test.step("Sign in", async () => {
			await page.goto("/sign-in");
			await expect(page.locator("html")).toHaveAttribute("lang", "en");
			await page.getByLabel("Email address", { exact: true }).fill(ADMIN.email);
			await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
			await page.getByRole("button", { name: "Sign in", exact: true }).click();
			await expect(page).toHaveURL(`${WEB_URL}/`);
		});

		await test.step("Create a cash account", async () => {
			await page.getByRole("link", { name: "Accounts", exact: true }).click();
			const main = page.getByRole("main");
			await main.getByRole("button", { name: "Add account", exact: true }).click();
			const dialog = page.getByRole("dialog");
			await expect(
				dialog.getByRole("heading", { name: "What would you like to add?" }),
			).toBeVisible();
			await dialog.getByRole("button", { name: "Cash", exact: true }).click();
			await dialog.getByRole("button", { name: "Enter account balance", exact: true }).click();
			await dialog.getByLabel("Account name", { exact: true }).fill(accountName);
			await dialog.getByLabel("Balance as of:", { exact: true }).fill("1000.00");
			await dialog.getByRole("button", { name: "Add account", exact: true }).click();

			await expect(dialog).toBeHidden();
			await expect(
				page.getByText(`Account "${accountName}" added.`, { exact: true }),
			).toBeVisible();
			await main.getByRole("link", { name: new RegExp(accountName, "u") }).click();
			await expect(page.getByRole("heading", { level: 1, name: accountName })).toBeVisible();
		});

		await test.step("Confirm a statement import", async () => {
			await page.getByRole("button", { name: "Import", exact: true }).click();
			const dialog = page.getByRole("dialog", { name: "Import a file" });
			await dialog.getByLabel("Bank statement", { exact: true }).setInputFiles({
				name: "statement.qif",
				mimeType: "text/plain",
				buffer: Buffer.from(`!Type:Bank\nD${daysAgo(2)}\nT-12.50\nP${transactionName}\n^\n`),
			});
			await expect(dialog.getByRole("tab", { name: "To create 1", exact: true })).toBeVisible();
			await expect(dialog.getByRole("cell", { name: transactionName })).toBeVisible();
			await dialog.getByRole("button", { name: "Import 1 transaction", exact: true }).click();

			await expect(dialog).toBeHidden();
			await expect(page.getByText("1 transaction imported.", { exact: true })).toBeVisible();
			await expect(
				page.getByRole("button", { name: `${transactionName} −€12.50`, exact: true }),
			).toBeVisible();
			await expect(page.getByRole("region", { name: accountName, exact: true })).toContainText(
				"€987.50",
			);
		});

		await test.step("Read the dashboard", async () => {
			await page.goto("/");
			await expect(page.locator("html")).toHaveAttribute("lang", "en");
			await expect(
				page.getByRole("heading", { level: 1, name: `Hello ${ADMIN_FIRST_NAME}`, exact: true }),
			).toBeVisible();
			await expect(page.getByText("Here is where the household's finances stand.")).toBeVisible();
			await expect(page.getByRole("region", { name: "Net worth", exact: true })).toBeVisible();
		});
	});
});
