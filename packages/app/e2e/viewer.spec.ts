import type { Page } from "@playwright/test";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { acceptInvitation, apiHelpers, expect, sgml, test, uniqueName } from "./fixtures.ts";
import { ADMIN_STATE, WEB_URL } from "./settings.ts";

// Story 20.3: a viewer reads every page and is shown no control that writes.
// The administrator prepares the household beside the page, which signs in
// as the viewer through an invitation.
test.use({ storageState: { cookies: [], origins: [] } });

const FORBIDDEN = "Cette action n'est pas autorisée.";

// A 1×1 transparent PNG.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

// Months long past, which no other test sets up: one set up, the one after
// it left alone, and one whose categories share more than its total.
const MONTH = "2022-03";
const NEXT_MONTH = "2022-04";
const OVER_MONTH = "2022-05";

/** No button or link of these names anywhere on the page. */
async function expectNone(
	scope: Pick<Page, "getByRole">,
	roles: { role: "button" | "link"; name: string }[],
) {
	await Promise.all(
		roles.map(async ({ role, name }) =>
			expect(scope.getByRole(role, { name, exact: true })).toHaveCount(0),
		),
	);
}

test("a viewer reads every page with no control that writes, and the server refuses a write", async ({
	page,
	playwright,
}) => {
	const administrator = await playwright.request.newContext({
		baseURL: WEB_URL,
		storageState: ADMIN_STATE,
	});
	const api = apiHelpers(administrator);
	const prefix = uniqueName("Lecture");
	const name = uniqueName("Alix");

	// The household, as the administrator left it.
	const account = await api.openAccount({ name: `${prefix} compte`, openingDate: "2022-02-01" });
	const bakery = await api.addTransaction(account.id, {
		date: `${MONTH}-10`,
		label: `${prefix} boulangerie`,
		amount: "-12,00",
		notes: "Pain du dimanche",
	});
	const category = await api.createCategory({ name: uniqueName("Courses") });
	await api.categorise([bakery], category.id);
	await api.attachFile(bakery, { name: "ticket.png", mimeType: "image/png", buffer: PNG });
	await api.addRecurring(bakery);
	// A transfer, linked on creation, and a split, each with actions a viewer never sees.
	const savings = await api.openAccount({ name: `${prefix} épargne`, openingDate: "2022-02-01" });
	const transfer = await api.addTransaction(account.id, {
		date: `${MONTH}-12`,
		label: `${prefix} virement`,
		amount: "-100,00",
	});
	await api.addTransaction(savings.id, {
		date: `${MONTH}-12`,
		label: `${prefix} versement`,
		amount: "100,00",
	});
	const shopping = await api.addTransaction(account.id, {
		date: `${MONTH}-14`,
		label: `${prefix} courses`,
		amount: "-30,00",
	});
	const [food = ""] = await api.splitTransaction(shopping, [
		{ label: `${prefix} part repas`, amount: "-20,00" },
		{ label: `${prefix} part maison`, amount: "-10,00" },
	]);
	await api.recordSnapshot(account.id, { date: `${MONTH}-20`, balance: "990,00" });
	await api.importFile(
		account.id,
		sgml([{ daysAgo: 3, amount: "-7.50", label: `${prefix} import`, fitid: randomUUID() }]),
		"releve-lecteur.ofx",
	);
	const budget = await administrator.put(`/api/budgets/${MONTH}`, {
		data: { budgetedSpending: "500,00", expectedIncome: "0" },
	});
	expect(budget.ok(), await budget.text()).toBe(true);
	const over = await administrator.put(`/api/budgets/${OVER_MONTH}`, {
		data: { budgetedSpending: "100,00", expectedIncome: "0" },
	});
	expect(over.ok(), await over.text()).toBe(true);
	const overCategory = await administrator.put(
		`/api/budgets/${OVER_MONTH}/categories/${category.id}`,
		{ data: { budgetedSpending: "200" } },
	);
	expect(overCategory.ok(), await overCategory.text()).toBe(true);
	const goal = await api.createGoal({
		name: `${prefix} objectif`,
		targetAmount: "2 000",
		accounts: [{ accountId: savings.id, allocatedAmount: "50" }],
	});
	// Paused, so its page shows a banner whose button a viewer must not see.
	await api.goalEvent(goal.id, "pause");
	const rule = await api.createRule({
		name: `${prefix} règle`,
		conditions: [{ conditionType: "transaction_name", operator: "like", value: prefix }],
		actions: [{ actionType: "set_transaction_category", value: category.id }],
	});
	const disabled = await administrator.patch(`/api/rules/${rule}`, { data: { enabled: false } });
	expect(disabled.ok(), await disabled.text()).toBe(true);
	const { url } = await api.invite(`lecteur-${randomUUID().slice(0, 8)}@archant.test`);
	await acceptInvitation(page.request, url, { name, password: "mot de passe du lecteur" });

	// No page sends a read the server refuses a viewer, the bank setup included.
	const refused: string[] = [];
	page.on("response", (response) => {
		if (response.status() === 403) {
			refused.push(response.url());
		}
	});

	try {
		await test.step("the dashboard and the accounts offer no new account", async () => {
			await page.goto("/");
			await expect(page.getByRole("heading", { level: 1, name: `Bonjour ${name}` })).toBeVisible();
			await expect(page.getByRole("link", { name: account.name }).first()).toBeVisible();
			await expectNone(page, [{ role: "button", name: "Ajouter un compte" }]);

			await page.goto("/accounts");
			await expect(page.getByRole("link", { name: account.name }).first()).toBeVisible();
			await expectNone(page, [{ role: "button", name: "Ajouter un compte" }]);
		});

		await test.step("an account shows its rows, snapshots and imports, and nothing to change them", async () => {
			await page.goto(`/accounts/${account.id}`);
			await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
			await expect(page.getByText(`${prefix} boulangerie`)).toBeVisible();
			await expectNone(page, [
				{ role: "button", name: "Importer" },
				{ role: "button", name: "Ajouter une opération" },
				{ role: "button", name: `Actions du compte ${account.name}` },
			]);

			await page.getByRole("tab", { name: "Soldes" }).click();
			await expect(page.getByRole("cell", { name: "990,00 €" }).first()).toBeVisible();
			await expectNone(page, [{ role: "button", name: "Ajouter un solde" }]);
			await expect(page.locator("[data-snapshot-id]")).toHaveCount(0);

			await page.getByRole("tab", { name: "Imports" }).click();
			await expect(page.getByRole("cell", { name: "releve-lecteur.ofx" })).toBeVisible();
			await expect(page.getByRole("button", { name: /Annuler l'import/u })).toHaveCount(0);
		});

		await test.step("operations: no selection, plain category pills, and a sheet to read", async () => {
			await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
			const row = page.locator(`[data-transaction-id="${bakery}"]`);
			await expect(row).toBeVisible();
			await expect(page.getByRole("checkbox")).toHaveCount(0);
			await expect(page.getByText(category.name).first()).toBeVisible();
			await expectNone(page, [{ role: "button", name: `Catégorie : ${category.name}` }]);

			await row.click();
			const sheet = page.getByRole("dialog", { name: "Opération" });
			await expect(sheet).toBeVisible();
			await expect(sheet.getByLabel("Libellé")).toHaveValue(`${prefix} boulangerie`);
			await expect(sheet.getByLabel("Libellé")).toBeDisabled();
			await expect(sheet.getByLabel("Notes")).toHaveValue("Pain du dimanche");
			await expect(sheet.getByLabel("Notes")).toBeDisabled();
			await expect(sheet.getByText("Cette opération fait partie de la récurrence")).toBeVisible();
			await expect(sheet.getByRole("link", { name: "ticket.png" })).toBeVisible();
			await expectNone(
				sheet,
				[
					"Enregistrer",
					"Supprimer",
					"Ajouter",
					"Ajouter aux récurrences",
					"Rapprocher un virement",
					"Diviser",
				].map((action) => ({ role: "button", name: action })),
			);
			await expect(sheet.getByRole("button", { name: /Supprimer « ticket\.png »/u })).toHaveCount(
				0,
			);
			// ⌘Enter saves nothing: no request leaves, so `refused` stays empty.
			await sheet.getByLabel("Libellé").press("ControlOrMeta+Enter");
			await expect(sheet).toBeVisible();
			// The footer's, in « Annuler »'s place; the sheet's corner has one too.
			await sheet.getByRole("button", { name: "Fermer", exact: true }).first().click();
			await expect(sheet).toBeHidden();

			await page.locator(`[data-transaction-id="${transfer}"]`).click();
			await expect(sheet).toBeVisible();
			await expect(sheet.getByText(`Vers ${savings.name}`).first()).toBeVisible();
			await expectNone(sheet, [
				{ role: "button", name: "Dissocier" },
				{ role: "button", name: "Ne plus proposer" },
				{ role: "button", name: "Rapprocher un virement" },
			]);
			await sheet.getByRole("button", { name: "Fermer", exact: true }).first().click();
			await expect(sheet).toBeHidden();

			await page.locator(`[data-transaction-id="${food}"]`).click();
			await expect(sheet).toBeVisible();
			await expect(sheet.getByRole("region", { name: "Division" })).toContainText(
				`${prefix} courses`,
			);
			await expectNone(sheet, [
				{ role: "button", name: "Modifier la division" },
				{ role: "button", name: "Annuler la division" },
			]);
			await sheet.getByRole("button", { name: "Fermer", exact: true }).first().click();
			await expect(sheet).toBeHidden();
		});

		await test.step("budgets: no form, and its pages lead back to the month", async () => {
			await page.goto(`/budgets/${MONTH}`);
			await expect(
				page.getByRole("heading", { level: 1, name: "Budget de mars 2022" }),
			).toBeVisible();
			await expect(page.getByRole("region", { name: "Résumé" })).toBeVisible();
			await expectNone(page, [{ role: "link", name: "Modifier le budget des catégories" }]);
			await expect(page.getByRole("link", { name: /Modifier le budget/u })).toHaveCount(0);

			await page.goto(`/budgets/${NEXT_MONTH}`);
			await expect(page.getByRole("heading", { name: "Aucun budget pour ce mois" })).toBeVisible();
			await expectNone(page, [
				{ role: "button", name: "Copier mars 2022" },
				{ role: "link", name: "Partir de zéro" },
				{ role: "link", name: "Définir le budget" },
			]);

			await page.goto(`/budgets/${OVER_MONTH}`);
			await expect(page.getByRole("heading", { name: "Budget sur-alloué" })).toBeVisible();
			await expectNone(page, [{ role: "link", name: "Corriger les catégories" }]);

			await page.goto(`/budgets/${MONTH}/edit`);
			await expect(page).toHaveURL(`${WEB_URL}/budgets/${MONTH}`);
			await page.goto(`/budgets/${MONTH}/categories`);
			await expect(page).toHaveURL(`${WEB_URL}/budgets/${MONTH}`);
		});

		await test.step("goals: cards and a page to read, nothing to create, edit, delete, pause or resume", async () => {
			await page.goto("/goals");
			const goalCard = page
				.getByRole("list", { name: "Objectifs" })
				.getByRole("link", { name: new RegExp(goal.name, "u") });
			await expect(goalCard).toBeVisible();
			await expectNone(page, [{ role: "button", name: "Nouvel objectif" }]);

			await goalCard.click();
			await expect(page.getByRole("heading", { level: 1, name: goal.name })).toBeVisible();
			await expect(page.getByRole("region", { name: "Comptes liés" })).toContainText(savings.name);
			await expect(page.getByRole("region", { name: "Cet objectif est en pause" })).toBeVisible();
			await expect(page.getByRole("region", { name: "Projection" })).toBeVisible();
			await expectNone(page, [
				{ role: "button", name: "Modifier" },
				{ role: "button", name: "Supprimer" },
				{ role: "button", name: `Actions pour ${goal.name}` },
				{ role: "button", name: "Reprendre l'objectif" },
			]);
		});

		await test.step("recurring and rules: read, never changed", async () => {
			await page.goto("/recurring");
			await expect(page.getByRole("heading", { level: 1, name: "Récurrences" })).toBeVisible();
			await expect(page.getByRole("cell", { name: `${prefix} boulangerie` })).toBeVisible();
			await expectNone(page, [
				{ role: "button", name: "Détecter" },
				{ role: "button", name: `Actions pour ${prefix} boulangerie` },
			]);

			await page.goto("/rules");
			const row = page
				.getByRole("list", { name: "Règles" })
				.getByRole("listitem")
				.filter({ hasText: `${prefix} règle` });
			await expect(row).toContainText("Désactivée");
			await expect(page.getByRole("switch")).toHaveCount(0);
			await expectNone(page, [
				{ role: "button", name: "Appliquer toutes les règles" },
				{ role: "button", name: "Ajouter une règle" },
				{ role: "button", name: `Actions pour ${prefix} règle` },
			]);
		});

		await test.step("settings show « Sécurité » alone", async () => {
			await page.goto("/settings");
			await expect(page).toHaveURL(`${WEB_URL}/settings/security`);
			// Their own password, not an administrator's.
			await expect(page.getByText("Le mot de passe de votre compte.")).toBeVisible();
			const sections = page.getByRole("navigation", { name: "Réglages" });
			await expect(sections.getByRole("link", { name: "Sécurité" })).toBeVisible();
			await expectNone(
				sections,
				["Banques", "Catégories", "Assistants IA", "Données", "Membres"].map((section) => ({
					role: "link",
					name: section,
				})),
			);

			await page.goto("/settings/categories");
			await expect(page).toHaveURL(`${WEB_URL}/settings/security`);
			await page.goto("/settings/banks");
			await expect(page).toHaveURL(`${WEB_URL}/settings/security`);
		});

		await expect(page.getByText(FORBIDDEN)).toHaveCount(0);
		expect(refused).toEqual([]);

		// A write the interface would never send still fails on the server.
		const written = await page.evaluate(async () => {
			const response = await fetch("/api/accounts", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "Compte du lecteur",
					type: "depository",
					subtype: "checking",
					currency: "EUR",
					openingBalance: "0",
					openingDate: "2026-01-01",
				}),
			});

			return { status: response.status, body: (await response.json()) as unknown };
		});
		expect(written.status).toBe(403);
		expect(z.object({ error: z.object({ code: z.string() }) }).parse(written.body).error.code).toBe(
			"FORBIDDEN",
		);
	} finally {
		await api.deleteRules();
		await administrator.dispose();
	}
});
