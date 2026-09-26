import type { Api } from "./fixtures.ts";
import type { Page, Route } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 4.4: tag transactions and filter by tag. One database serves the
// whole run, so every test narrows the list to its own rows by a unique
// label, and names its tags uniquely.

const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

/** The row's open button, which carries the tags as badges on the caption line. */
const rowButton = (page: Page, label: string) =>
	rowItem(page, label).locator("button[data-transaction-id]");

const tagSearch = (page: Page) => page.getByRole("combobox", { name: "Rechercher une étiquette" });

const toast = (page: Page, text: string) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

/** Opens `/transactions` on the rows labelled with `q`, and waits for them. */
async function visitOperations(page: Page, q: string) {
	await page.goto(`/transactions?q=${encodeURIComponent(q)}`);
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await expect(rowItem(page, q).first()).toBeVisible();
}

async function oneTransaction(api: Api, label: string) {
	const account = await api.openAccount();

	return api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-42,90" });
}

/** Focuses the row and opens its tag combobox with `t`. */
async function pressT(page: Page, label: string) {
	await rowButton(page, label).focus();
	await expect(rowButton(page, label)).toBeFocused();
	await page.keyboard.press("t");
	await expect(tagSearch(page)).toBeFocused();
}

test("t on a focused row creates a tag, picks another, and saves both on close, kept after a reload", async ({
	page,
	api,
}) => {
	const label = uniqueName("HOTEL");
	const created = uniqueName("Vacances 2026");
	const existing = await api.createTag(uniqueName("Bretagne"));
	await oneTransaction(api, label);
	let patches = 0;
	page.on("request", (request) => {
		if (request.method() === "PATCH" && request.url().includes("/api/transactions/")) {
			patches += 1;
		}
	});

	await visitOperations(page, label);
	await page.keyboard.press("j");
	await expect(rowButton(page, label)).toBeFocused();
	await page.keyboard.press("t");
	await expect(tagSearch(page)).toBeFocused();
	await page.keyboard.type(created);
	await page.getByRole("option", { name: `Créer "${created}"` }).click();
	// Picking keeps the list open, the new tag checked once the server made it.
	await expect(page.getByRole("option", { name: created })).toHaveAttribute("aria-checked", "true");
	await tagSearch(page).fill(existing.name);
	await page.getByRole("option", { name: existing.name }).click();
	await expect(tagSearch(page)).toBeVisible();
	await expect(page.getByRole("option", { name: existing.name })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await page.keyboard.press("Escape");

	await expect(tagSearch(page)).toBeHidden();
	await expect(rowButton(page, label)).toContainText(created);
	await expect(rowButton(page, label)).toContainText(existing.name);
	await expect(toast(page, "Étiquettes modifiées")).toBeVisible();
	// Focus goes back to the row, so `j` carries on from there.
	await expect(rowButton(page, label)).toBeFocused();
	expect(patches).toBe(1);

	await page.reload();
	await expect(rowButton(page, label)).toContainText(created);
	await expect(rowButton(page, label)).toContainText(existing.name);
});

test("an existing tag is offered as its name is typed in another case, and « Créer » is not", async ({
	page,
	api,
}) => {
	const label = uniqueName("GITE");
	const tag = await api.createTag(uniqueName("Vacances"));
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await pressT(page, label);
	await page.keyboard.type(tag.name.toLowerCase());

	await expect(page.getByRole("option", { name: tag.name })).toBeVisible();
	await expect(page.getByRole("option", { name: /^Créer/u })).toHaveCount(0);
});

test("« Annuler » in the toast takes the tags off the row", async ({ page, api }) => {
	const label = uniqueName("TRAIN");
	const tag = await api.createTag(uniqueName("Voyage"));
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await pressT(page, label);
	await page.keyboard.type(tag.name);
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await expect(rowButton(page, label)).toContainText(tag.name);
	await toast(page, "Étiquettes modifiées").getByRole("button", { name: "Annuler" }).click();

	await expect(rowButton(page, label)).not.toContainText(tag.name);
	await page.reload();
	await expect(rowButton(page, label)).toBeVisible();
	await expect(rowButton(page, label)).not.toContainText(tag.name);
});

test("a tag added in the sheet shows on the row once saved", async ({ page, api }) => {
	const label = uniqueName("PEINTURE");
	const tag = await api.createTag(uniqueName("Travaux"));
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await rowButton(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	const field = sheet.getByRole("button", { name: "Étiquettes", exact: true });
	await expect(field).toHaveText("Aucune étiquette");
	await field.click();
	await tagSearch(page).fill(tag.name);
	await page.getByRole("option", { name: tag.name }).click();
	await page.keyboard.press("Escape");
	await expect(field).toHaveText(tag.name);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(rowButton(page, label)).toContainText(tag.name);
});

test("the sheet saves another field when one of its tags was deleted since it opened", async ({
	page,
	api,
}) => {
	const label = uniqueName("CAMPING");
	// Still matched by the list's `q`, which is the old label.
	const renamed = `${label} Ardèche`;
	const tag = await api.createTag(uniqueName("Été"));
	await api.setTags([await oneTransaction(api, label)], [tag.id]);

	await visitOperations(page, label);
	await rowButton(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(sheet.getByRole("button", { name: "Étiquettes", exact: true })).toHaveText(tag.name);
	await api.deleteTag(tag.id);
	await sheet.getByLabel("Libellé").fill(renamed);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(rowButton(page, renamed)).toBeVisible();
});

test("the tag filter keeps the tagged rows only, and names the tag in its chip", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Filtre");
	const account = await api.openAccount();
	const holidays = await api.createTag(uniqueName("Vacances"));
	const other = await api.createTag(uniqueName("Travaux"));
	const add = (label: string, days: number) =>
		api.addTransaction(account.id, {
			date: daysAgo(days),
			label: `${prefix} ${label}`,
			amount: "-1",
		});
	await api.setTags([await add("HOTEL", 1)], [holidays.id, other.id]);
	await api.setTags([await add("TRAIN", 2)], [holidays.id]);
	await api.setTags([await add("PEINTURE", 3)], [other.id]);
	await add("Virement", 4);
	const rows = page.getByRole("main").getByRole("listitem");

	await visitOperations(page, prefix);
	await expect(rows).toHaveCount(4);

	await page.getByRole("button", { name: "Filtrer" }).click();
	const menu = page.getByRole("dialog");
	await menu.getByRole("button", { name: "Étiquette", exact: true }).click();
	await menu.getByRole("searchbox", { name: "Rechercher une étiquette" }).fill(holidays.name);
	await expect(menu.getByLabel(other.name)).toHaveCount(0);
	await menu.getByLabel(holidays.name).check();
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(
		page.getByRole("button", { name: `Retirer le filtre ${holidays.name}` }),
	).toBeVisible();
	await expect(rows).toHaveText([
		new RegExp(`${prefix} HOTEL`, "u"),
		new RegExp(`${prefix} TRAIN`, "u"),
	]);
	await expect(page).toHaveURL(/[?&]tag=/u);
});

test("a rejected change puts the previous tags back and shows a destructive toast", async ({
	page,
	api,
}) => {
	const label = uniqueName("CINEMA");
	const before = await api.createTag(uniqueName("Sorties"));
	const after = await api.createTag(uniqueName("Anniversaire"));
	await api.setTags([await oneTransaction(api, label)], [before.id]);
	let release: (() => void) | undefined;
	const server = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/transactions/*", async (route: Route) => {
		if (route.request().method() !== "PATCH") {
			await route.fallback();

			return;
		}

		await server;
		await route.fulfill({
			status: 500,
			json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
		});
	});

	await visitOperations(page, label);
	await expect(rowButton(page, label)).toContainText(before.name);
	// The list's refetch after the failure never answers, so only the rollback
	// can show the previous tags again.
	let refetched = false;
	await page.route(
		(url) => url.pathname === "/api/transactions",
		() => {
			refetched = true;
		},
	);
	await pressT(page, label);
	await page.getByRole("option", { name: before.name }).click();
	await tagSearch(page).fill(after.name);
	await page.getByRole("option", { name: after.name }).click();
	await page.keyboard.press("Escape");
	await expect(rowButton(page, label)).toContainText(after.name);
	await expect(rowButton(page, label)).not.toContainText(before.name);
	release?.();

	await expect(
		page.locator('[data-sonner-toast][data-type="error"]').filter({
			hasText: "Une erreur inattendue s'est produite.",
		}),
	).toBeVisible();
	await expect(rowButton(page, label)).toContainText(before.name);
	await expect(rowButton(page, label)).not.toContainText(after.name);
	expect(refetched).toBe(true);
});
