import type { Page } from "@playwright/test";

import { z } from "zod";

import { shiftMonth } from "@archant/data/months";

import { ofMonth } from "../src/lib/dates.ts";
import { daysAgo, euros, expect, rgb, test, uniqueName } from "./fixtures.ts";

// Story 17.1: a month's budget. One database serves the whole run, so each
// test owns months of 2023, which no other test writes to: the actuals are
// exact. The medians take every earlier month, so they stay exact only while
// no other test records a line in euros before November 2023.

const heading = (page: Page, month: string) =>
	page.getByRole("heading", { level: 1, name: `Budget ${ofMonth(month)}` });

const donut = (page: Page) => page.getByRole("region", { name: "Dépenses", exact: true });

const summary = (page: Page) => page.getByRole("region", { name: "Résumé" });

const plan = (page: Page, name: "Revenus attendus" | "Dépenses prévues") =>
	summary(page).getByRole("group", { name });

const breadcrumbs = (page: Page) => page.getByRole("navigation", { name: "Fil d'Ariane" });

/** The ring's slices, in drawing order: each category that spent, then what is left. */
const slices = (page: Page) => donut(page).locator(".recharts-pie-sector path");

const UNUSED = "var(--inset)";

const budgetBody = z.object({ data: z.object({ bounds: z.object({ from: z.string() }) }) });

test("/budgets opens this month, and the arrows and the picker stop at the bounds", async ({
	page,
	request,
}) => {
	const current = daysAgo(0).slice(0, 7);
	const last = shiftMonth(current, 24);

	await page.goto("/budgets");

	await expect(page).toHaveURL(`/budgets/${current}`);
	await expect(heading(page, current)).toBeVisible();
	await expect(
		page
			.getByRole("navigation", { name: "Navigation principale" })
			.getByRole("link", { name: "Budgets", exact: true }),
	).toHaveAttribute("aria-current", "page");

	// Two years ahead is the last month.
	await page.goto(`/budgets/${last}`);
	await expect(heading(page, last)).toBeVisible();
	await expect(page.getByRole("button", { name: "Mois suivant" })).toBeDisabled();
	await expect(page.getByRole("link", { name: "Mois précédent" })).toHaveAttribute(
		"href",
		`/budgets/${shiftMonth(last, -1)}`,
	);

	await page.getByRole("button", { name: /^Choisir un mois/u }).click();
	const months = page.getByRole("list", { name: `Mois de ${last.slice(0, 4)}` });
	await expect(months.getByRole("listitem")).toHaveCount(12);
	await expect(months.locator('[aria-current="page"]')).toHaveAttribute("href", `/budgets/${last}`);
	await expect(page.getByRole("button", { name: "Année suivante" })).toBeDisabled();
	await page.getByRole("button", { name: "Année précédente" }).click();
	const yearBefore = page.getByRole("list", {
		name: `Mois de ${Number(last.slice(0, 4)) - 1}`,
	});
	await yearBefore.locator(`a[href="/budgets/${shiftMonth(last, -12)}"]`).click();

	await expect(page).toHaveURL(`/budgets/${shiftMonth(last, -12)}`);
	await expect(yearBefore).toBeHidden();

	// The first month is two years back, or the oldest entry's month.
	const response = await request.get(`/api/budgets/${current}`);
	const { from } = budgetBody.parse(await response.json()).data.bounds;
	await page.goto(`/budgets/${from}`);
	await expect(heading(page, from)).toBeVisible();
	await expect(page.getByRole("button", { name: "Mois précédent" })).toBeDisabled();

	// One month past either bound is refused; « Aujourd'hui » leads back.
	await page.goto(`/budgets/${shiftMonth(last, 1)}`);
	await expect(page.getByRole("heading", { name: "Mois hors de portée" })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Choisir un mois/u })).toBeDisabled();
	await page.getByRole("link", { name: "Aujourd'hui" }).click();

	await expect(page).toHaveURL(`/budgets/${current}`);
	await expect(heading(page, current)).toBeVisible();
});

test("a month is set up with « Suggérer », then shows its donut and its summary", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "0", openingDate: "2023-06-01" });
	const groceries = await api.createCategory({ name: uniqueName("Courses") });
	// One after the other: each is an `immediate` ledger write.
	const spent = await (
		[
			["2023-07-10", "-100,00"],
			["2023-08-10", "-300,00"],
			["2023-09-10", "-200,00"],
			["2023-10-10", "-400,00"],
			["2023-11-10", "-1 500,00"],
		] as const
	).reduce<Promise<string[]>>(
		async (previous, [date, amount]) => [
			...(await previous),
			await api.addTransaction(account.id, { date, label: "Courses", amount }),
		],
		Promise.resolve([]),
	);
	await api.categorise(spent, groceries.id);
	await api.addTransaction(account.id, {
		date: "2023-08-25",
		label: "Salaire",
		amount: "2 000,00",
	});
	await api.addTransaction(account.id, {
		date: "2023-10-25",
		label: "Salaire",
		amount: "3 000,00",
	});
	await api.addTransaction(account.id, { date: "2023-11-12", label: "Retrait", amount: "-100,00" });
	await api.addTransaction(account.id, {
		date: "2023-11-25",
		label: "Salaire",
		amount: "2 800,00",
	});

	await page.goto("/budgets/2023-11");

	await expect(page.getByRole("heading", { name: "Aucun budget pour ce mois" })).toBeVisible();
	await expect(donut(page)).toBeHidden();
	await page.getByRole("link", { name: "Définir le budget" }).click();

	await expect(page).toHaveURL("/budgets/2023-11/edit");
	await expect(
		page.getByRole("heading", { level: 1, name: "Définir le budget de novembre 2023" }),
	).toBeVisible();
	const spending = page.getByLabel("Dépenses prévues");
	const income = page.getByLabel("Revenus attendus");

	// Both required.
	await page.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText("Ce champ est obligatoire.")).toHaveCount(2);

	// The medians of July to October: 100, 300, 200, 400, and 2 000, 3 000.
	await page.getByRole("button", { name: "Suggérer" }).click();
	await expect(spending).toHaveValue("250,00");
	await expect(income).toHaveValue("2500,00");

	await page.getByRole("button", { name: "Enregistrer" }).click();

	await expect(page).toHaveURL("/budgets/2023-11");
	await expect(heading(page, "2023-11")).toBeVisible();
	await expect(donut(page).getByRole("img")).toHaveAccessibleName(
		`Dépenses de novembre 2023 : ${euros(160_000)} sur ${euros(25_000)}, réparties sur 2 catégories.`,
	);
	// Over budget: the amount spent in the destructive colour, and by how much.
	const amountSpent = donut(page).getByText(euros(160_000), { exact: true });
	await expect(amountSpent).toHaveCSS("color", rgb("#c91313"));
	await expect(breadcrumbs(page)).toHaveText("Budgets/Budget de novembre 2023");
	await expect(breadcrumbs(page).getByRole("link", { name: "Budgets" })).toHaveAttribute(
		"href",
		"/budgets",
	);
	// Over budget, nothing is left: the two lines that spent, no grey slice.
	await expect(slices(page)).toHaveCount(2);
	await expect(slices(page).first()).toHaveAttribute("fill", "#e99537");
	await expect(plan(page, "Dépenses prévues")).toContainText(euros(25_000));
	await expect(plan(page, "Dépenses prévues")).toContainText(`${euros(160_000)} dépensés`);
	const overflow = plan(page, "Dépenses prévues").getByText(`${euros(135_000)} de dépassement`);
	await expect(overflow).toHaveCSS("color", rgb("#c91313"));
	await expect(plan(page, "Revenus attendus")).toContainText(euros(250_000));
	await expect(plan(page, "Revenus attendus")).toContainText(`${euros(280_000)} gagnés`);
	await expect(plan(page, "Revenus attendus")).toContainText(`${euros(30_000)} de plus`);

	// The centre's link edits the budget.
	await donut(page)
		.getByRole("link", { name: `sur ${euros(25_000)} Modifier le budget` })
		.click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Modifier le budget de novembre 2023" }),
	).toBeVisible();
	await expect(spending).toHaveValue("250,00");
	await spending.fill("-5");
	await page.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText("Le montant ne peut pas être négatif.")).toBeVisible();
	await spending.fill("2 000,00");
	await page.getByRole("button", { name: "Enregistrer" }).click();

	await expect(page).toHaveURL("/budgets/2023-11");
	await expect(plan(page, "Dépenses prévues")).toContainText(`${euros(40_000)} restants`);
	// Under budget, what is left closes the ring in grey.
	await expect(slices(page)).toHaveCount(3);
	await expect(slices(page).last()).toHaveAttribute("fill", UNUSED);
	await expect(donut(page).getByText(euros(160_000), { exact: true })).not.toHaveCSS(
		"color",
		rgb("#c91313"),
	);
});

test("an account in another currency is named under the budget", async ({ page, api, request }) => {
	const dollars = await api.openAccount({
		name: uniqueName("Compte US"),
		currency: "USD",
		openingBalance: "0",
		openingDate: "2023-04-01",
	});
	await api.addTransaction(dollars.id, { date: "2023-05-10", label: "Diner", amount: "-80.00" });
	const saved = await request.put("/api/budgets/2023-05", {
		data: { budgetedSpending: "100,00", expectedIncome: "0" },
	});
	expect(saved.ok(), await saved.text()).toBe(true);

	await page.goto("/budgets/2023-05");

	// Its spending stays out: nothing else was spent in May 2023.
	await expect(donut(page).getByRole("img")).toHaveAccessibleName(
		`Dépenses de mai 2023 : ${euros(0)} sur ${euros(10_000)}.`,
	);
	// Nothing spent: one grey ring.
	await expect(slices(page)).toHaveCount(1);
	await expect(slices(page)).toHaveAttribute("fill", UNUSED);
	await expect(page.getByText(/^Hors des totaux, faute de conversion/u)).toContainText(
		dollars.name,
	);
});
