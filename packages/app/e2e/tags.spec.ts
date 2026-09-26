import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Stories 4.4 and 11.12: tag management under « Réglages ». One database serves the
// whole run, so each test works on tags of its own.

const PAGE = "/settings/tags";

const tagRow = (page: Page, name: string) =>
	page.getByRole("button", { name: `Actions pour ${name}`, exact: true }).locator("..");

async function openAction(page: Page, name: string, action: "Renommer" | "Supprimer") {
	await page.getByRole("button", { name: `Actions pour ${name}`, exact: true }).click();
	await page.getByRole("menuitem", { name: action }).click();
}

/** A transaction labelled `label`, carrying the tag. */
async function tagged(api: Api, label: string, tagId: string) {
	const account = await api.openAccount();
	const id = await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-9,90" });
	await api.setTags([id], [tagId]);
}

const rowButton = (page: Page, label: string) =>
	page
		.getByRole("main")
		.getByRole("listitem")
		.filter({ hasText: label })
		.locator("button[data-transaction-id]");

async function visitOperations(page: Page, q: string) {
	await page.goto(`/transactions?q=${encodeURIComponent(q)}`);
	await expect(rowButton(page, q)).toBeVisible();
}

test("renaming a tag renames it on its rows", async ({ page, api }) => {
	const label = uniqueName("HOTEL");
	const tag = await api.createTag(uniqueName("Vacnces"));
	const renamed = uniqueName("Vacances");
	await tagged(api, label, tag.id);

	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 2, name: "Étiquettes" })).toBeVisible();
	await expect(tagRow(page, tag.name)).toContainText("1 opération");
	await openAction(page, tag.name, "Renommer");
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Nom").fill(renamed);
	await dialog.getByRole("button", { name: "Renommer" }).click();

	await expect(dialog).toBeHidden();
	await expect(tagRow(page, renamed)).toBeVisible();
	await visitOperations(page, label);
	await expect(rowButton(page, label)).toContainText(renamed);
});

test("deleting a used tag, once confirmed, takes it off its rows", async ({ page, api }) => {
	const label = uniqueName("PEINTURE");
	const tag = await api.createTag(uniqueName("Travaux"));
	await tagged(api, label, tag.id);

	await page.goto(PAGE);
	await openAction(page, tag.name, "Supprimer");
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText("1 opération perdra cette étiquette.");
	await dialog.getByRole("button", { name: "Supprimer" }).click();

	await expect(dialog).toBeHidden();
	await expect(tagRow(page, tag.name)).toHaveCount(0);
	await visitOperations(page, label);
	await expect(rowButton(page, label)).not.toContainText(tag.name);
});

test("a tag added from the header is listed with no transaction", async ({ page }) => {
	const name = uniqueName("Voyage");

	await page.goto(PAGE);
	// The header's, first: an empty list shows a second one below.
	await page.getByRole("button", { name: "Ajouter une étiquette", exact: true }).first().click();
	const dialog = page.getByRole("dialog", { name: "Ajouter une étiquette" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("button", { name: "Ajouter une étiquette", exact: true }).click();

	await expect(dialog).toBeHidden();
	await expect(
		page.locator("[data-sonner-toast]").filter({ hasText: `Étiquette « ${name} » ajoutée.` }),
	).toBeVisible();
	await expect(tagRow(page, name)).toContainText("0 opération");
});

test("a tag name held in another case keeps the dialog open with the error under the field", async ({
	page,
	api,
}) => {
	const existing = await api.createTag(uniqueName("Voyage"));
	const upper = existing.name.toUpperCase();

	await page.goto(PAGE);
	await page.getByRole("button", { name: "Ajouter une étiquette", exact: true }).first().click();
	const dialog = page.getByRole("dialog", { name: "Ajouter une étiquette" });
	await dialog.getByLabel("Nom").fill(upper);
	await dialog.getByRole("button", { name: "Ajouter une étiquette", exact: true }).click();

	await expect(dialog.getByText("Une étiquette porte déjà ce nom.")).toBeVisible();
	await expect(dialog.getByLabel("Nom")).toHaveAttribute("aria-invalid", "true");
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(tagRow(page, existing.name)).toBeVisible();
	await expect(tagRow(page, upper)).toHaveCount(0);
});

test("an empty tag list says so and offers the button that adds one", async ({ page }) => {
	// The shared database already holds other tests' tags; the empty state
	// is what the API's empty list looks like.
	await page.route("**/api/tags", (route) =>
		route.request().method() === "GET" ? route.fulfill({ json: { data: [] } }) : route.continue(),
	);

	await page.goto(PAGE);
	const empty = page.getByText("Aucune étiquette pour l'instant.").locator("..");
	await expect(empty).toBeVisible();
	await empty.getByRole("button", { name: "Ajouter une étiquette", exact: true }).click();

	await expect(page.getByRole("dialog", { name: "Ajouter une étiquette" })).toBeVisible();
});
