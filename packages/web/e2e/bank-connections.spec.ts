import type { Page } from "@playwright/test";

import { createDb } from "@archant/data/client";

import { FAKE_BANKS } from "./fake-enable-banking.ts";
import { expect, test } from "./fixtures.ts";
import { DATABASE_FILE, TIME_ZONE } from "./settings.ts";

// Story 10.1: connecting a bank from « Réglages > Banques », against the fake
// Enable Banking that e2e/start-api.ts starts on loopback.

const PAGE = "/reglages/banques";

const banks = (page: Page) => page.getByRole("list", { name: "Banques disponibles" });

const toast = (page: Page, text: string | RegExp) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

const longDate = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: TIME_ZONE,
});

async function visit(page: Page) {
	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 2, name: "Banques" })).toBeVisible();
}

test("France is selected and its banks are listed, filtered by the search", async ({ page }) => {
	await visit(page);

	await expect(page.getByRole("combobox", { name: "Pays" })).toHaveText("France");
	await Promise.all(
		FAKE_BANKS.map((name) =>
			expect(banks(page).getByRole("button", { name: `Connecter ${name}` })).toBeVisible(),
		),
	);
	await expect(banks(page).getByRole("button")).toHaveCount(FAKE_BANKS.length);

	// Accents and case ignored, as the user types.
	await page.getByLabel("Rechercher une banque").fill("neobanque");
	await expect(banks(page).getByRole("button")).toHaveCount(1);
	await expect(banks(page).getByRole("button", { name: "Connecter Néobanque Test" })).toBeVisible();

	// The BIC matches too.
	await page.getByLabel("Rechercher une banque").fill("demofrpp");
	await expect(banks(page).getByRole("button")).toHaveCount(1);
	await expect(banks(page).getByRole("button", { name: "Connecter Banque Démo" })).toBeVisible();

	await page.getByLabel("Rechercher une banque").fill("introuvable");
	await expect(page.getByText("Aucune banque ne correspond à cette recherche.")).toBeVisible();
});

test("another country lists its own banks", async ({ page }) => {
	await visit(page);

	await page.getByRole("combobox", { name: "Pays" }).click();
	await page.getByRole("option", { name: "Belgique" }).click();

	await expect(banks(page).getByRole("button", { name: "Connecter Banque BE" })).toBeVisible();
	await expect(banks(page).getByRole("button")).toHaveCount(1);
});

test("choosing a bank and approving lands on Banques with the connection and its consent end", async ({
	page,
}) => {
	await visit(page);

	await banks(page).getByRole("button", { name: "Connecter Banque Démo" }).click();

	// The fake bank approves at once and sends the browser back through the
	// return page, which posts the code and lands on the list.
	await expect(toast(page, "Banque Démo est connectée.")).toBeVisible();
	await expect(page).toHaveURL(/\/reglages\/banques$/u);

	// The bank allows 180 days; Archant asks for 90 at most.
	const consentEnd = longDate.format(new Date(Date.now() + 90 * 86_400_000));
	const connections = page.getByRole("list", { name: "Banques connectées" });
	const row = connections.getByRole("listitem").filter({ hasText: "Banque Démo" }).last();
	await expect(row).toContainText("France");
	await expect(row).toContainText(`Consentement valable jusqu'au ${consentEnd}`);

	const db = await createDb(`file:${DATABASE_FILE}`);

	try {
		const stored = await db.$client.execute(
			"select session_id, status from bank_connections where institution_name = 'Banque Démo' and status = 'active'",
		);

		expect(stored.rows.length).toBeGreaterThan(0);
		for (const connection of stored.rows) {
			expect(connection["session_id"]).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/u);
		}
	} finally {
		db.$client.close();
	}
});

test("a redirect URL the provider refuses is named in the toast", async ({ page }) => {
	const url = "http://localhost:8788/reglages/banques/retour";
	await page.route("**/api/bank-connections", (route) =>
		route.request().method() === "POST"
			? route.fulfill({
					status: 502,
					json: { error: { code: "BANK_REDIRECT_NOT_ALLOWED", message: "x", params: { url } } },
				})
			: route.fallback(),
	);

	await visit(page);
	await banks(page).getByRole("button", { name: "Connecter Banque Démo" }).click();

	await expect(toast(page, url)).toBeVisible();
	await expect(page).toHaveURL(/\/reglages\/banques$/u);
});

test("a server without ENCRYPTION_KEY names it and links to the guide", async ({ page }) => {
	await page.route("**/api/bank-connections/setup", (route) =>
		route.fulfill({ json: { data: { available: false, missing: ["ENCRYPTION_KEY"] } } }),
	);

	await visit(page);

	const alert = page.getByRole("alert");
	await expect(alert).toContainText("La connexion bancaire n'est pas configurée");
	await expect(alert.getByText("ENCRYPTION_KEY", { exact: true })).toBeVisible();
	await expect(alert.getByRole("link", { name: "Lire le guide de déploiement" })).toHaveAttribute(
		"href",
		/docs\/deployment\.md/u,
	);
	await expect(page.getByRole("combobox", { name: "Pays" })).toBeHidden();
});

test("a bank refusal shows its message without calling the API", async ({ page }) => {
	const callbacks: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/bank-connections/callback")) {
			callbacks.push(request.url());
		}
	});

	await page.goto("/reglages/banques/retour?error=access_denied&state=whatever");

	await expect(page.getByRole("alert")).toContainText("La banque n'a pas donné son accord.");
	await page.getByRole("link", { name: "Retour aux banques" }).click();
	await expect(page).toHaveURL(/\/reglages\/banques$/u);
	expect(callbacks).toEqual([]);
});

test("a spent or unknown state shows the translated error", async ({ page }) => {
	await page.goto(
		"/reglages/banques/retour?code=a-code&state=00000000-0000-4000-8000-000000000000",
	);

	await expect(page.getByRole("alert")).toContainText(
		"Cette autorisation bancaire est inconnue, déjà utilisée ou expirée.",
	);
});
