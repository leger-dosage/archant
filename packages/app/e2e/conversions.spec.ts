import type { Page } from "@playwright/test";

import { randomInt } from "node:crypto";

import { formatTableDate } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, sgml, test, uniqueName } from "./fixtures.ts";

// Story 22.5: a line of an investment account becomes a trade from its
// sheet, as Sure's « Convert to trade », and deleting the trade undoes it.

const header = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

const rowButton = (page: Page, label: string) =>
	page.getByRole("main").locator("button[data-transaction-id]").filter({ hasText: label });

const sheet = (page: Page) => page.getByRole("dialog", { name: "Modifier l'opération" });

const toast = (page: Page, text: string) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

test("an imported buy converted from « Opérations » leaves it for « Ordres » and « Positions », the balance unchanged, until the conversion is undone", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "25 000,00",
		openingDate: daysAgo(30),
	});
	const label = uniqueName("ACHAT LVMH");
	const fund = uniqueName("Fonds");
	const date = daysAgo(5);
	// The broker's statement, with its closing balance, as a PEA's export gives it.
	const statement = sgml(
		[{ daysAgo: 5, amount: "-6126,50", label, fitid: `${label.replaceAll(" ", "-")}-1` }],
		{ ledger: { amount: "18873,50", daysAgo: 0 } },
	);
	await api.importFile(account.id, statement);

	await page.goto(`/accounts/${account.id}`);
	await expect(header(page, account.name)).toContainText(euros(1_887_350));

	await test.step("the line's sheet converts it into a buy, its fees what the amount leaves", async () => {
		await rowButton(page, label).click();
		await sheet(page).getByRole("button", { name: "Convertir en ordre" }).click();
		const dialog = page.getByRole("dialog", { name: "Convertir en ordre" });
		// Money out: a buy, as Sure infers it.
		await expect(dialog.getByRole("radio", { name: "Achat" })).toBeChecked();
		await dialog.getByRole("button", { name: "Titre" }).click();
		await page.getByRole("combobox", { name: "Rechercher un titre" }).fill(fund);
		await page.getByRole("option", { name: "Saisir un titre manuellement" }).click();
		await expect(dialog.getByLabel("Nom du titre")).toHaveValue(fund);
		await dialog.getByLabel("Quantité").fill("10");
		await dialog.getByLabel("Prix unitaire").fill("700");
		await dialog.getByRole("button", { name: "Convertir" }).click();
		await expect(dialog.getByLabel("Prix unitaire")).toHaveAccessibleDescription(
			"Quantité × prix ne laisse pas de frais positifs ou nuls pour le montant de l'opération.",
		);
		await dialog.getByLabel("Prix unitaire").fill("612,40");
		await expect(dialog.getByRole("definition")).toHaveText(euros(250));
		await dialog.getByRole("button", { name: "Convertir" }).click();

		await expect(toast(page, "Opération convertie en ordre.")).toBeVisible();
		await expect(dialog).toBeHidden();
		await expect(sheet(page)).toBeHidden();
		await expect(rowButton(page, label)).toHaveCount(0);
		await expect(header(page, account.name)).toContainText(euros(1_887_350));
	});

	await test.step("the buy is in « Ordres », the fund in « Positions »", async () => {
		await page.getByRole("tab", { name: "Ordres" }).click();
		await expect(
			page
				.getByRole("row", { name: new RegExp(`^${formatTableDate(date)} `, "u") })
				.getByRole("cell"),
		).toHaveText([formatTableDate(date), "Achat", fund, "10 × 612,40 €", euros(-612_650)]);
		await page.getByRole("tab", { name: "Positions" }).click();
		await expect(page.getByRole("button", { name: fund, exact: true })).toBeVisible();
	});

	await test.step("the same statement again writes nothing", async () => {
		await api.importFile(account.id, statement);
		await page.getByRole("tab", { name: "Opérations" }).click();
		await expect(page.getByText("Aucune opération pour l'instant")).toBeVisible();
		await page.getByRole("tab", { name: "Ordres" }).click();
		await expect(page.locator("[data-trade-id]")).toHaveCount(1);
	});

	await test.step("the converted trade opens read only, and undoing it brings the line back", async () => {
		await page.locator("[data-trade-id]").click();
		const dialog = page.getByRole("dialog", { name: "Modifier l'ordre" });
		await expect(dialog.getByText(`Cet ordre vient de l'opération « ${label} »`)).toBeVisible();
		await expect(dialog.getByLabel("Quantité")).toBeDisabled();
		await expect(dialog.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
		await dialog.getByRole("button", { name: "Annuler la conversion" }).click();
		await page
			.getByRole("alertdialog", { name: "Annuler la conversion ?" })
			.getByRole("button", { name: "Annuler la conversion" })
			.click();

		await expect(toast(page, "Conversion annulée.")).toBeVisible();
		await expect(page.getByText("Aucun ordre saisi.")).toBeVisible();
		await page.getByRole("tab", { name: "Opérations" }).click();
		await expect(rowButton(page, label)).toBeVisible();
		await expect(header(page, account.name)).toContainText(euros(1_887_350));
	});
});

test("a contribution matched as a transfer stays a line of the PEA, with nothing to convert", async ({
	page,
	api,
}) => {
	const current = await api.openAccount({ name: uniqueName("Compte courant") });
	const account = await api.openAccount({ name: uniqueName("PEA"), kind: "pea" });
	const label = uniqueName("VERSEMENT PEA");
	// An amount of its own: step 6 links the pair on creation, no other test's row a candidate.
	const amount = `${String(randomInt(100, 999))},${String(randomInt(10, 99))}`;
	await api.addTransaction(current.id, {
		date: daysAgo(4),
		label: uniqueName("VIR PEA"),
		amount: `-${amount}`,
	});
	await api.addTransaction(account.id, { date: daysAgo(4), label, amount });

	await page.goto(`/accounts/${account.id}`);
	await rowButton(page, label).click();

	await expect(sheet(page).getByText(`Depuis ${current.name}`).first()).toBeVisible();
	await expect(sheet(page).getByRole("button", { name: "Convertir en ordre" })).toHaveCount(0);
});

test("a dividend line converted from its sheet counts once as the month's income, beside interest on cash", async ({
	page,
	api,
}) => {
	// October 2024 belongs to this test alone, so the month's income is exact.
	const account = await api.openAccount({
		name: uniqueName("PEA"),
		kind: "pea",
		openingBalance: "0",
		openingDate: "2023-12-01",
	});
	const fund = uniqueName("Fonds");
	await api.recordTrade(account.id, {
		security: { source: "manual", name: fund },
		date: "2024-10-02",
		quantity: "10",
		price: "100",
	});
	const label = uniqueName("DIVIDENDE");
	await api.addTransaction(account.id, { date: "2024-10-15", label, amount: "12,34" });
	await api.recordTrade(account.id, {
		side: "interest",
		security: null,
		date: "2024-10-31",
		amount: "3,00",
	});

	await page.goto(`/accounts/${account.id}`);
	await rowButton(page, label).click();
	await sheet(page).getByRole("button", { name: "Convertir en ordre" }).click();
	const dialog = page.getByRole("dialog", { name: "Convertir en ordre" });
	await dialog.getByRole("radio", { name: "Dividende" }).click();
	await dialog.getByRole("combobox", { name: "Titre" }).click();
	await page.getByRole("option", { name: fund }).click();
	await dialog.getByRole("button", { name: "Convertir" }).click();

	await expect(toast(page, "Opération convertie en ordre.")).toBeVisible();
	await expect(rowButton(page, label)).toHaveCount(0);
	await page.getByRole("tab", { name: "Ordres" }).click();
	await expect(
		page.getByRole("row", { name: new RegExp(`^${formatTableDate("2024-10-15")} `, "u") }),
	).toContainText("Dividende");

	await page.goto("/?month=2024-10");
	await expect(
		page
			.getByRole("region", { name: "Flux d'octobre 2024" })
			.getByRole("group", { name: "Revenus", exact: true }),
	).toContainText(`+${euros(1534)}`);
});
