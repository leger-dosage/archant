import type { Page } from "@playwright/test";

import { expect, test, uniqueName } from "./fixtures.ts";

// Story 28.15: an account's institution and notes, in Sure's closed
// « Détails supplémentaires », and the institution on the accounts page's
// row, after « • » on a wide screen and under the name on a phone.

const listRow = (page: Page, name: string) =>
	page
		.getByRole("main")
		.getByRole("listitem")
		.filter({ has: page.getByRole("link", { name: new RegExp(name, "u") }) });

test("an account created with its institution and notes shows the institution on its row and edits all three", async ({
	page,
}) => {
	const name = uniqueName("Courant BNP");
	const institution = uniqueName("BNP");

	await page.goto("/accounts");
	await page.getByRole("main").getByRole("button", { name: "Ajouter un compte" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom", { exact: true }).fill(name);
	await dialog.getByLabel("Solde à la date :").fill("100,00");

	// Closed until asked for, as Sure's `<details>`.
	const institutionName = dialog.getByLabel("Nom de l'institution");
	await expect(institutionName).toBeHidden();
	await dialog.getByText("Détails supplémentaires").click();
	await expect(institutionName).toHaveAttribute("placeholder", "ex., Banque Populaire");
	await expect(dialog.getByLabel("Domaine de l'institution")).toHaveAttribute(
		"placeholder",
		"ex., banquepopulaire.fr",
	);
	await expect(dialog.getByLabel("Notes")).toHaveAttribute(
		"placeholder",
		"Stockez des informations supplémentaires comme les numéros de compte, codes de tri, IBAN, numéros de routage, etc.",
	);
	await expect(dialog.getByLabel("Notes")).toHaveAttribute("rows", "4");
	// Creation holds no exclusion switch: Story 28.16 rebuilds it in Sure's steps.
	await expect(dialog.getByRole("switch")).toHaveCount(0);

	await institutionName.fill(` ${institution} `);
	await dialog.getByLabel("Domaine de l'institution").fill("bnp.fr");
	await dialog.getByLabel("Notes").fill("IBAN dans le classeur");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	// A wide screen: « • institution » after the name, the bullet hidden from
	// assistive technology.
	await page.setViewportSize({ width: 1440, height: 900 });
	const row = listRow(page, name);
	const beside = row.locator("span").filter({ hasText: "•" }).filter({ hasText: institution });
	await expect(beside).toBeVisible();
	await expect(beside.locator('[aria-hidden="true"]')).toHaveText("•");
	// Read as « name, institution », never run together.
	await expect(row.getByRole("link")).toHaveAccessibleName(
		new RegExp(`${name}\\s*,\\s*${institution}`, "u"),
	);
	await expect(row.getByText(institution, { exact: true })).toBeHidden();

	// A phone: the institution on its own line under the name instead.
	await page.setViewportSize({ width: 375, height: 800 });
	await expect(beside).toBeHidden();
	await expect(row.getByText(institution, { exact: true })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });

	// The edit dialog shows the stored values, and the exclusion switch last.
	await row.getByRole("button", { name: `Actions du compte ${name}` }).click();
	await page.getByRole("menu").getByRole("menuitem", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier le compte" });
	await edit.getByText("Détails supplémentaires").click();
	await expect(edit.getByLabel("Nom de l'institution")).toHaveValue(institution);
	await expect(edit.getByLabel("Domaine de l'institution")).toHaveValue("bnp.fr");
	await expect(edit.getByLabel("Notes")).toHaveValue("IBAN dans le classeur");
	await expect(edit.getByRole("switch", { name: "Exclure des rapports" })).toBeVisible();

	await edit.getByLabel("Nom de l'institution").fill("");
	await edit.getByLabel("Notes").fill("");
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(edit).toBeHidden();
	await expect(row.getByText("•")).toHaveCount(0);

	// Cleared fields save null, the domain left as it was.
	await row.getByRole("button", { name: `Actions du compte ${name}` }).click();
	await page.getByRole("menu").getByRole("menuitem", { name: "Modifier" }).click();
	await edit.getByText("Détails supplémentaires").click();
	await expect(edit.getByLabel("Nom de l'institution")).toHaveValue("");
	await expect(edit.getByLabel("Domaine de l'institution")).toHaveValue("bnp.fr");
	await expect(edit.getByLabel("Notes")).toHaveValue("");
});

test("a refused field opens « Détails supplémentaires » on its own", async ({ page, api }) => {
	const account = await api.openAccount({ name: uniqueName("Livret") });

	await page.goto("/accounts");
	await listRow(page, account.name)
		.getByRole("button", { name: `Actions du compte ${account.name}` })
		.click();
	await page.getByRole("menu").getByRole("menuitem", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier le compte" });
	await edit.getByText("Détails supplémentaires").click();
	await edit.getByLabel("Nom de l'institution").fill("a".repeat(256));
	// Closed again: the refusal must reopen it.
	await edit.getByText("Détails supplémentaires").click();
	await expect(edit.getByLabel("Nom de l'institution")).toBeHidden();
	await edit.getByRole("button", { name: "Enregistrer" }).click();

	await expect(edit.getByLabel("Nom de l'institution")).toBeVisible();
	await expect(edit.getByLabel("Nom de l'institution")).toHaveAccessibleDescription(
		"Ce texte est trop long.",
	);
});
