import type { Page } from "@playwright/test";

import { expect, test, uniqueName } from "./fixtures.ts";

// Story 28.14: Sure's « Ordre d'affichage des comptes par défaut », saved per
// user, which `BalanceSheet#sorted` applies to each classification group.
// The administrator's order is shared by the whole run: the test sets it
// back to the name order before and after.

/** The accounts column, beside every page but settings. */
const column = (page: Page) => page.getByRole("complementary", { name: "Liste des comptes" });

/** The rail, the app's main navigation. */
const rail = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

/** « Bilan »'s assets on the dashboard. */
const bilanAssets = (page: Page) =>
	page
		.getByRole("region", { name: "Bilan" })
		.getByRole("group", { name: "Actifs" })
		.getByRole("list", { name: "Comptes" });

/** The given accounts' links inside `scope`, in the order they are listed. */
const linksOf = (scope: ReturnType<Page["getByRole"]>, prefix: string) =>
	scope.getByRole("link").filter({ hasText: prefix });

test("« Préférences » sorts every account list by balance, highest first", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Ordre");
	const alpha = `${prefix} A`;
	const bravo = `${prefix} B`;
	const charlie = `${prefix} C`;
	await api.openAccount({ name: alpha, openingBalance: "200 000,00" });
	await api.openAccount({ name: bravo, openingBalance: "900 000,00" });
	await api.openAccount({ name: charlie, openingBalance: "50 000,00" });
	await api.setAccountOrder("name_asc");

	try {
		await test.step("the accounts page, the column and « Bilan » list them by name first", async () => {
			const byName = [new RegExp(alpha), new RegExp(bravo), new RegExp(charlie)];
			await page.goto("/");
			await expect(linksOf(bilanAssets(page), prefix)).toHaveText(byName);
			await rail(page).getByRole("link", { name: "Comptes" }).click();
			await expect(linksOf(page.getByRole("region", { name: "Actifs" }), prefix)).toHaveText(
				byName,
			);
			await expect(linksOf(column(page), prefix)).toHaveText(byName);
		});

		await test.step("« Solde (haut à bas) » saves on change, with Sure's notice", async () => {
			// Through the app's links, so the lists cached above stay cached.
			await rail(page).getByRole("link", { name: "Réglages" }).click();
			await page
				.getByRole("navigation", { name: "Réglages" })
				.getByRole("link", { name: "Préférences" })
				.click();
			await expect(page.getByRole("heading", { level: 1, name: "Préférences" })).toBeVisible();
			const general = page.getByRole("region", { name: "Général" });
			await expect(general.getByText("Configurez vos préférences")).toBeVisible();
			const select = general.getByRole("combobox", {
				name: "Ordre d'affichage des comptes par défaut",
			});
			await expect(select).toHaveText("Nom (A-Z)");

			await select.click();
			await expect(page.getByRole("option")).toHaveText([
				"Nom (A-Z)",
				"Nom (Z-A)",
				"Solde (de bas en haut)",
				"Solde (haut à bas)",
			]);
			await page.getByRole("option", { name: "Solde (haut à bas)" }).click();

			await expect(page.getByText("Votre profil a été mis à jour.")).toBeVisible();
			await expect(select).toHaveText("Solde (haut à bas)");
		});

		await test.step("the cached lists follow it without a reload", async () => {
			const byBalance = [new RegExp(bravo), new RegExp(alpha), new RegExp(charlie)];
			await rail(page).getByRole("link", { name: "Comptes" }).click();
			await expect(page).toHaveURL(/\/accounts$/u);
			await expect(linksOf(page.getByRole("region", { name: "Actifs" }), prefix)).toHaveText(
				byBalance,
			);
			await expect(linksOf(column(page), prefix)).toHaveText(byBalance);

			await rail(page).getByRole("link", { name: "Accueil" }).click();
			await expect(linksOf(bilanAssets(page), prefix)).toHaveText(byBalance);
		});

		await test.step("the saved order survives a reload", async () => {
			await page.goto("/settings/preferences");
			await expect(
				page.getByRole("combobox", { name: "Ordre d'affichage des comptes par défaut" }),
			).toHaveText("Solde (haut à bas)");
		});
	} finally {
		await api.setAccountOrder("name_asc");
	}
});
