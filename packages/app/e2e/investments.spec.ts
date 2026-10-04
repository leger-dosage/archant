import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";

// Story 22.1: « Réglages › Placements » turns price fetching on, says which
// host it reaches and what that host learns, and updates the prices on a
// press. The suite's server holds no security to price, and points
// `YAHOO_FINANCE_URL` at a closed loopback port (start-api.ts): a provider's
// failure is shown by answering `GET /api/prices` here.

const PRICES = "**/api/prices";

const toast = (page: Page, text: string | RegExp) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

const fetchSwitch = (page: Page) =>
	page.getByRole("switch", { name: "Récupérer les cours chaque jour" });

const status = (overrides: Record<string, unknown>) => ({
	data: {
		enabled: true,
		host: "query1.finance.yahoo.com",
		lastUpdatedAt: null,
		lastError: null,
		updating: false,
		...overrides,
	},
});

test("price fetching is off by default, and the page says which host it would tell what", async ({
	page,
}) => {
	await page.goto("/settings");
	await page
		.getByRole("navigation", { name: "Réglages" })
		.getByRole("link", { name: "Placements" })
		.click();

	await expect(page).toHaveURL(/\/settings\/investments$/u);
	await expect(page.getByRole("heading", { level: 1, name: "Placements" })).toBeVisible();
	await expect(fetchSwitch(page)).not.toBeChecked();
	// The server's own `YAHOO_FINANCE_URL`, the suite's closed port.
	await expect(fetchSwitch(page)).toHaveAccessibleDescription(
		/Archant demande les cours à Yahoo Finance \(127\.0\.0\.1:9\) .* Yahoo apprend ainsi quels titres le foyer détient .* jamais une quantité ni un montant\. Chercher un titre lui envoie aussi le texte saisi\. Désactivée, aucune requête ne quitte le serveur/u,
	);
	await expect(page.getByRole("button", { name: "Mettre à jour les cours" })).toHaveCount(0);
});

test("turned on, « Mettre à jour les cours » runs and shows the last update", async ({ page }) => {
	await page.goto("/settings/investments");

	await fetchSwitch(page).click();

	await expect(toast(page, "Récupération des cours activée.")).toBeVisible();
	await expect(fetchSwitch(page)).toBeChecked();

	// A reload is a visit, which may start the day's run: the button comes
	// back once it is over.
	await page.reload();
	const update = page.getByRole("button", { name: "Mettre à jour les cours" });
	await expect(update).toBeVisible({ timeout: 10_000 });
	await update.click();

	await expect(toast(page, "Cours mis à jour.")).toBeVisible();
	await expect(
		page.getByText(/^Dernière mise à jour : \d{1,2} \S+ \d{4} à \d{2}:\d{2}$/u),
	).toBeVisible();

	// Off again with the keyboard, as the rest of the suite expects.
	await fetchSwitch(page).focus();
	await page.keyboard.press("Space");
	await expect(toast(page, "Récupération des cours désactivée.")).toBeVisible();
	await expect(fetchSwitch(page)).not.toBeChecked();
	await expect(update).toHaveCount(0);
});

test("a failed update shows its error translated", async ({ page }) => {
	await page.route(PRICES, (route) => route.fulfill({ json: status({}) }));
	await page.route("**/api/prices/update", (route) =>
		route.fulfill({
			json: status({ lastUpdatedAt: Date.now(), lastError: "PRICE_PROVIDER_ERROR" }),
		}),
	);

	await page.goto("/settings/investments");
	await page.getByRole("button", { name: "Mettre à jour les cours" }).click();

	await expect(toast(page, "Mise à jour terminée avec une erreur.")).toBeVisible();
	await expect(
		page.getByRole("status").filter({ hasText: "La dernière mise à jour a échoué" }),
	).toHaveText(
		"La dernière mise à jour a échoué : Yahoo Finance n'a pas répondu correctement. Réessayez plus tard.",
	);
});

test("a run started by the day's first visit shows, and the button waits for it", async ({
	page,
}) => {
	let calls = 0;
	await page.route(PRICES, (route) => {
		calls += 1;

		return route.fulfill({
			json: status(
				calls === 1
					? { updating: true }
					: { lastUpdatedAt: Date.now(), lastError: "PRICE_UNAVAILABLE" },
			),
		});
	});

	await page.goto("/settings/investments");

	await expect(page.getByRole("button", { name: "Mise à jour en cours" })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Mettre à jour les cours" })).toBeVisible();
	await expect(
		page.getByRole("status").filter({ hasText: "La dernière mise à jour a échoué" }),
	).toContainText("Yahoo Finance n'a pas de cours pour au moins un titre.");
});
