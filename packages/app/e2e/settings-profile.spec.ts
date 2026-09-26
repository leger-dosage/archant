import { expect, test } from "./fixtures.ts";
import { ADMIN_FIRST_NAME, WEB_URL } from "./settings.ts";

// Story 12.2: the first name in « Réglages › Sécurité », which the dashboard
// greets. The administrator is shared by every test, so the name `setup`
// gave is put back whatever happens.

test.afterEach(async ({ request }) => {
	const response = await request.post("/api/auth/update-user", {
		headers: { origin: WEB_URL },
		data: { name: ADMIN_FIRST_NAME },
	});

	expect(response.ok(), await response.text()).toBe(true);
});

test("a first name is set, cleared and refused in « Sécurité », and the greeting follows", async ({
	page,
	api,
}) => {
	await api.openAccount();
	const sent: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/api/auth/update-user")) {
			sent.push(request.url());
		}
	});

	await page.goto("/settings/security");
	const field = page.getByLabel("Prénom");
	const save = page.getByRole("button", { name: "Enregistrer le prénom" });
	await expect(field).toHaveValue(ADMIN_FIRST_NAME);

	// Refused by the form, before any request.
	await field.fill("x".repeat(61));
	await save.click();
	await expect(page.getByText("Ce texte est trop long.")).toBeVisible();
	expect(sent).toEqual([]);

	await field.fill(" Dominique ");
	await save.click();
	await expect(page.getByText("Prénom enregistré.")).toBeVisible();
	// No reload: the sidebar link keeps this page's session in memory.
	await page.getByRole("link", { name: "Tableau de bord", exact: true }).click();
	await expect(page.getByText("Bonjour Dominique", { exact: true })).toBeVisible();

	await page.goto("/settings/security");
	await expect(field).toHaveValue("Dominique");
	await field.fill("   ");
	await save.click();
	await expect(page.getByText("Prénom enregistré.").last()).toBeVisible();
	await page.getByRole("link", { name: "Tableau de bord", exact: true }).click();
	await expect(page.getByText("Bonjour", { exact: true })).toBeVisible();
	await expect(page.getByText(/^Bonjour /u)).toHaveCount(0);
});
