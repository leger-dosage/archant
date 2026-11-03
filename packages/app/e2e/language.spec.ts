import { expect, test } from "./fixtures.ts";

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
