import { expect, test } from "./fixtures.ts";
import { ADMIN_FIRST_NAME } from "./settings.ts";

// Stories 30.8 and 30.9: Sure's « Zone dangereuse › Réinitialiser le compte »
// and « Réinitialiser et précharger ». They empty the shared database, so the
// `reset` project runs them alone, after every `chromium` test and before the
// password change. The sample-data test runs last on purpose: `password`,
// `two-factor` and `ceiling` then run on a filled household, as an owner's.

test("a refused reset keeps its dialog while pending, then toasts the error and deletes nothing", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const rail = page.getByRole("navigation", { name: "Navigation principale" });
	// A sync's lease cannot be held without a bank provider: the server's
	// refusal is answered here, late enough to press Escape meanwhile.
	await page.route("**/api/financial-data", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		await route.fulfill({
			status: 409,
			json: {
				error: { code: "SYNC_IN_PROGRESS", message: "This bank connection is already syncing." },
			},
		});
	});

	await page.goto("/settings/security");
	const zone = page.getByRole("region", { name: "Zone dangereuse" });
	await zone.getByRole("button", { name: "Réinitialiser le compte" }).click();
	const dialog = page.getByRole("alertdialog", { name: "Réinitialiser le compte ?" });
	await dialog.getByRole("button", { name: "Réinitialiser le compte" }).click();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();

	await expect(page.getByText("Synchronisation déjà en cours.")).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(page.getByText("Votre compte a été réinitialisé.")).toHaveCount(0);
	await rail.getByRole("link", { name: "Comptes", exact: true }).click();
	await expect(
		page.getByRole("complementary", { name: "Liste des comptes" }).getByText(account.name),
	).toBeVisible();
});

test("« Réinitialiser le compte » asks first, then empties every list without a reload", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const rail = page.getByRole("navigation", { name: "Navigation principale" });

	await page.goto("/settings/security");
	const zone = page.getByRole("region", { name: "Zone dangereuse" });
	await expect(zone.getByRole("heading", { name: "Réinitialiser le compte" })).toBeVisible();
	await expect(zone).toContainText(
		"La réinitialisation de votre compte supprimera tous vos comptes, catégories, marchands, étiquettes et autres données, mais gardera votre compte utilisateur intact.",
	);

	// Annuler first: a stray Enter never resets.
	await zone.getByRole("button", { name: "Réinitialiser le compte" }).click();
	const dialog = page.getByRole("alertdialog", { name: "Réinitialiser le compte ?" });
	await expect(dialog).toContainText(
		"Êtes-vous sûr(e) de vouloir réinitialiser votre compte ? Cela supprimera tous vos comptes, catégories, marchands, étiquettes et autres données. Cette action ne peut pas être annulée.",
	);
	await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(dialog).toBeHidden();

	await rail.getByRole("link", { name: "Comptes", exact: true }).click();
	const column = page.getByRole("complementary", { name: "Liste des comptes" });
	await expect(column.getByText(account.name)).toBeVisible();

	await rail.getByRole("link", { name: "Réglages", exact: true }).click();
	await page
		.getByRole("navigation", { name: "Réglages" })
		.getByRole("link", { name: "Sécurité", exact: true })
		.click();
	await zone.getByRole("button", { name: "Réinitialiser le compte" }).click();
	await dialog.getByRole("button", { name: "Réinitialiser le compte" }).click();
	await expect(page.getByText("Votre compte a été réinitialisé.")).toBeVisible();
	await expect(dialog).toBeHidden();

	await rail.getByRole("link", { name: "Comptes", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Aucun compte pour l'instant" })).toBeVisible();
	await expect(column.getByText(account.name)).toHaveCount(0);
	await rail.getByRole("link", { name: "Réglages", exact: true }).click();
	await page
		.getByRole("navigation", { name: "Réglages" })
		.getByRole("link", { name: "Catégories", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Aucune catégorie pour l'instant" }),
	).toBeVisible();
	// The users stay: still signed in, the greeting by the same name.
	await rail.getByRole("link", { name: "Accueil", exact: true }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: `Bonjour ${ADMIN_FIRST_NAME}` }),
	).toBeVisible();
});

test("« Réinitialiser et précharger » asks first, then the dashboard lists Sure's sample accounts without a reload", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const rail = page.getByRole("navigation", { name: "Navigation principale" });

	await page.goto("/settings/security");
	const zone = page.getByRole("region", { name: "Zone dangereuse" });
	await expect(zone.getByRole("heading", { name: "Réinitialiser et précharger" })).toBeVisible();
	await expect(zone).toContainText(
		"Supprime toutes vos données existantes puis charge des données d'exemple afin que vous puissiez explorer avec un environnement pré-rempli.",
	);

	await zone.getByRole("button", { name: "Réinitialiser et précharger" }).click();
	const dialog = page.getByRole("alertdialog", {
		name: "Réinitialiser le compte et charger des données d'exemple ?",
	});
	await expect(dialog).toContainText(
		"Êtes-vous sûr(e) de vouloir réinitialiser votre compte et charger des données d'exemple ? Cela supprimera vos données existantes et les remplacera par des données de démonstration afin que vous puissiez explorer Archant en toute sécurité.",
	);
	// Annuler first: a stray Enter never resets.
	await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
	await dialog.getByRole("button", { name: "Réinitialiser et précharger" }).click();
	await expect(
		page.getByText("Votre compte a été réinitialisé et les données d'exemple sont chargées."),
	).toBeVisible();
	await expect(dialog).toBeHidden();

	await rail.getByRole("link", { name: "Accueil", exact: true }).click();
	const bilan = page.getByRole("region", { name: "Bilan" });
	const assets = bilan
		.getByRole("group", { name: "Actifs", exact: true })
		.getByRole("list", { name: "Comptes" });
	const liabilities = bilan
		.getByRole("group", { name: "Passifs", exact: true })
		.getByRole("list", { name: "Comptes" });
	await expect(assets.getByRole("link", { name: /Compte courant Chase Premier/u })).toBeVisible();
	await expect(assets.getByRole("link", { name: /Résidence principale/u })).toBeVisible();
	await expect(liabilities.getByRole("link", { name: /Prêt immobilier/u })).toBeVisible();
	await expect(bilan.getByText(account.name)).toHaveCount(0);
});
