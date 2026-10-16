import type { Page } from "@playwright/test";

import { euros, expect, test, uniqueName } from "./fixtures.ts";

// Story 28.13: a default account for new transactions, as Sure's
// `set_default` and `default_account_for_transactions`. The administrator's
// default is one per user and shared by the whole run: the test clears it
// before and after.

const listRow = (page: Page, accountId: string) =>
	page
		.getByRole("main")
		.getByRole("listitem")
		.filter({ has: page.locator(`a[href="/accounts/${accountId}"]`) });

async function openRowMenu(page: Page, account: { id: string; name: string }) {
	await listRow(page, account.id)
		.getByRole("button", { name: `Actions du compte ${account.name}` })
		.click();
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();

	return menu;
}

async function openNewSheet(page: Page) {
	await page.goto("/transactions");
	await page.getByRole("button", { name: "Ajouter une opération", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Ajouter une opération" });
	await expect(sheet).toBeVisible();

	return sheet;
}

test("a row sets the default account, which a new transaction on /transactions starts on", async ({
	page,
	api,
	request,
}) => {
	const main = await api.openAccount({ name: uniqueName("Courant"), openingBalance: "500,00" });
	const other = await api.openAccount({
		name: uniqueName("Livret"),
		kind: "savings",
		openingBalance: "100,00",
	});
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "mortgage",
		openingBalance: "10 000,00",
	});
	await api.clearDefaultAccount(main.id);

	try {
		await test.step("« Définir par défaut » marks the row « Par défaut »", async () => {
			await page.goto("/accounts");
			await expect(listRow(page, main.id)).not.toContainText("Par défaut");
			const menu = await openRowMenu(page, main);
			await expect(menu.locator("svg.lucide-star")).toBeVisible();
			await menu.getByRole("menuitem", { name: "Définir par défaut" }).click();
			await expect(menu).toBeHidden();
			await expect(listRow(page, main.id)).toContainText("Par défaut");
			await expect(listRow(page, other.id)).not.toContainText("Par défaut");

			const again = await openRowMenu(page, main);
			await expect(again.getByRole("menuitem", { name: "Retirer par défaut" })).toBeVisible();
			await expect(again.locator("svg.lucide-star-off")).toBeVisible();
			await expect(again.getByRole("menuitem", { name: "Définir par défaut" })).toHaveCount(0);
			await page.keyboard.press("Escape");
		});

		await test.step("a loan offers no default", async () => {
			const menu = await openRowMenu(page, loan);
			await expect(menu.getByRole("menuitem")).toHaveText([
				"Modifier",
				"Désactiver le compte",
				"Exclure de tous les rapports",
				"Supprimer le compte",
			]);
			await page.keyboard.press("Escape");
		});

		await test.step("« Ajouter une opération » starts on the default and saves there", async () => {
			const label = uniqueName("Marché");
			const sheet = await openNewSheet(page);
			const field = sheet.getByRole("combobox", { name: "Compte" });
			await expect(field).toHaveText(main.name);
			await sheet.getByLabel("Libellé").fill(label);
			await sheet.getByLabel("Montant").fill("12,50");
			await sheet.getByRole("button", { name: "Enregistrer" }).click();
			await expect(sheet).toBeHidden();
			await expect(
				page.getByRole("main").getByRole("button", { name: new RegExp(label) }),
			).toContainText(euros(-1250));

			await page.goto(`/accounts/${main.id}`);
			await expect(
				page.getByRole("main").getByRole("button", { name: new RegExp(label) }),
			).toContainText(euros(-1250));
		});

		await test.step("a deactivated default keeps its caption, and the form ignores it until reactivated", async () => {
			await api.deactivateAccount(main.id);
			try {
				await page.goto("/accounts");
				await expect(listRow(page, main.id)).toContainText("Par défaut");
				const sheet = await openNewSheet(page);
				await expect(sheet.getByRole("combobox", { name: "Compte" })).toHaveText(
					"Sélectionnez un compte",
				);
				await page.keyboard.press("Escape");
				await expect(sheet).toBeHidden();
			} finally {
				const reactivated = await request.patch(`/api/accounts/${main.id}`, {
					data: { active: true },
				});
				expect(reactivated.ok()).toBe(true);
			}

			const sheet = await openNewSheet(page);
			await expect(sheet.getByRole("combobox", { name: "Compte" })).toHaveText(main.name);
			await page.keyboard.press("Escape");
			await expect(sheet).toBeHidden();
		});

		await test.step("a change of account alone counts as unsaved", async () => {
			const sheet = await openNewSheet(page);
			await sheet.getByRole("combobox", { name: "Compte" }).click();
			await page.getByRole("option", { name: other.name }).click();
			await expect(sheet.getByRole("combobox", { name: "Compte" })).toHaveText(other.name);
			await page.keyboard.press("Escape");

			const discard = page.getByRole("alertdialog", { name: "Abandonner les modifications ?" });
			await expect(discard).toBeVisible();
			await discard.getByRole("button", { name: "Abandonner" }).click();
			await expect(discard).toBeHidden();
			await expect(sheet).toBeHidden();
		});

		await test.step("another account keeps what was typed and takes the save", async () => {
			const label = uniqueName("Virement");
			const sheet = await openNewSheet(page);
			await sheet.getByLabel("Libellé").fill(label);
			await sheet.getByLabel("Montant").fill("7,00");
			await sheet.getByRole("combobox", { name: "Compte" }).click();
			await page.getByRole("option", { name: other.name }).click();
			await expect(sheet.getByLabel("Libellé")).toHaveValue(label);
			await expect(sheet.getByLabel("Montant")).toHaveValue("7,00");
			await sheet.getByRole("button", { name: "Enregistrer" }).click();
			await expect(sheet).toBeHidden();

			await page.goto(`/accounts/${other.id}`);
			await expect(
				page.getByRole("main").getByRole("button", { name: new RegExp(label) }),
			).toContainText(euros(-700));
		});

		await test.step("« Retirer par défaut » clears it, and a save without an account is refused", async () => {
			await page.goto("/accounts");
			const menu = await openRowMenu(page, main);
			await menu.getByRole("menuitem", { name: "Retirer par défaut" }).click();
			await expect(menu).toBeHidden();
			await expect(listRow(page, main.id)).not.toContainText("Par défaut");

			const sheet = await openNewSheet(page);
			const field = sheet.getByRole("combobox", { name: "Compte" });
			await expect(field).toHaveText("Sélectionnez un compte");
			await sheet.getByLabel("Libellé").fill(uniqueName("Sans compte"));
			await sheet.getByLabel("Montant").fill("3,00");
			const posted: string[] = [];
			page.on("request", (sent) => {
				if (sent.method() === "POST" && sent.url().includes("/transactions")) {
					posted.push(sent.url());
				}
			});
			await sheet.getByRole("button", { name: "Enregistrer" }).click();
			await expect(sheet.getByText("Ce champ est obligatoire.")).toBeVisible();
			await expect(field).toHaveAttribute("aria-invalid", "true");
			await expect(sheet).toBeVisible();
			expect(posted).toEqual([]);
		});
	} finally {
		await api.clearDefaultAccount(main.id);
	}
});
