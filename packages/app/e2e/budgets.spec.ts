import type { Page } from "@playwright/test";

import { z } from "zod";

import { shiftMonth } from "@archant/data/months";

import { ofMonth } from "../src/lib/dates.ts";
import { daysAgo, euros, expect, rgb, test, uniqueName } from "./fixtures.ts";

// Stories 17.1 to 17.4: a month's budget, its categories, then a copy and
// moves, then rollover. One database serves the whole run, so each test owns
// its months, of 2023, February to May 2024 and September to December 2024,
// which no other test writes to: the actuals are exact. The 2023-11 test runs
// before the 2023-05 one sets that month up, so it meets no earlier month set
// up and offers « Définir le budget », not a copy. The medians take every
// earlier month, so they stay exact only while no other test records a line
// in euros before November 2023; a category's own medians, of a category no
// other test uses, always are. December 2023 is this file's too.

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

	// Saving « Budget » leads to « Catégories », as Sure's; « Valider » to the month.
	await expect(page).toHaveURL("/budgets/2023-11/categories");
	await page.getByRole("button", { name: "Valider" }).click();
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

	await expect(page).toHaveURL("/budgets/2023-11/categories");
	await page.getByRole("button", { name: "Valider" }).click();
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

const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });

const allocation = (page: Page) => page.locator('[data-slot="budget-allocation"]');

const categoriesCard = (page: Page) =>
	page.getByRole("region", { name: "Catégories", exact: true });

const group = (page: Page, name: "Dépassées" | "Dans les clous") =>
	categoriesCard(page).getByRole("region", { name, exact: true });

const card = (page: Page, name: string) =>
	categoriesCard(page).getByRole("button", { name: new RegExp(`^${name} `, "u") });

test("a month is spread over its categories, which show their status and open a sheet", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "10 000,00", openingDate: "2023-12-01" });
	const house = await api.createCategory({ name: uniqueName("Maison"), color: "#4ea7fc" });
	const works = await api.createCategory({ name: uniqueName("Travaux"), parentId: house.id });
	const garden = await api.createCategory({ name: uniqueName("Jardin"), parentId: house.id });
	const gifts = await api.createCategory({ name: uniqueName("Cadeaux") });
	const leisure = await api.createCategory({ name: uniqueName("Loisirs") });
	// One after the other: each is an `immediate` ledger write.
	const lines = [
		["2023-12-10", "-100,00", house.id, "Quincaillerie"],
		// December only: the dashboard's tests own January 2024.
		["2023-12-12", "-300,00", works.id, "Plombier"],
		["2024-02-03", "-100,00", works.id, "Peinture"],
		["2024-02-04", "-650,00", garden.id, "Pépinière"],
		["2024-02-05", "-20,00", gifts.id, "Fleuriste"],
		// Four in « Cadeaux »: its sheet lists the three latest.
		["2024-02-07", "-5,00", gifts.id, "Carte"],
		["2024-02-08", "-5,00", gifts.id, "Ruban"],
		["2024-02-09", "-5,00", gifts.id, "Papier"],
		// « Sans catégorie »: its outflow spends, its income does not.
		["2024-02-10", "-30,00", null, "Retrait"],
		["2024-02-11", "500,00", null, "Remboursement"],
	] as const;
	await lines.reduce(async (previous, [date, amount, categoryId, label]) => {
		await previous;
		const id = await api.addTransaction(account.id, { date, label, amount });

		if (categoryId !== null) {
			await api.categorise([id], categoryId);
		}
	}, Promise.resolve());

	await test.step("« Budget » leads to « Catégories »", async () => {
		await page.goto("/budgets/2024-02/edit");
		await page.getByLabel("Dépenses prévues").fill("1 000");
		await page.getByLabel("Revenus attendus").fill("0");
		await page.getByRole("button", { name: "Enregistrer" }).click();

		await expect(page).toHaveURL("/budgets/2024-02/categories");
		const steps = page.getByRole("navigation", { name: "Étapes du budget" });
		await expect(steps.getByRole("link", { name: "Budget, terminée" })).toBeVisible();
		await expect(steps.getByRole("link", { name: "Catégories" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		await expect(allocation(page)).toContainText("0 % alloués");
		await expect(allocation(page)).toContainText(`${euros(100_000)} restant à allouer`);
	});

	await test.step("each amount saves on change, beside its median", async () => {
		// December's 100 and the child's 300: a parent's month includes its children's.
		await expect(page.getByText(`${euros(40_000)}/mois en médiane`)).toBeVisible();
		await expect(field(page, works.name)).toHaveAttribute("placeholder", "Partagé");
		await expect(field(page, works.name)).toHaveAccessibleDescription(
			new RegExp(
				`^${euros(30_000)}/mois en médiane Laissez vide pour partager le budget de ${house.name}\\.$`,
				"u",
			),
		);

		await field(page, house.name).fill("700");
		await field(page, house.name).press("Tab");
		await expect(allocation(page)).toContainText("70 % alloués");

		// Ring-fenced: the parent keeps its reserve of 700 beside the child's 300.
		await field(page, works.name).fill("300");
		await field(page, works.name).press("Tab");
		await expect(field(page, house.name)).toHaveValue("1000,00");
		await expect(allocation(page)).toContainText("100 % alloués");
		await expect(field(page, "Sans catégorie")).toHaveValue("0,00");
	});

	await test.step("« Valider » waits while the categories pass the total", async () => {
		await field(page, leisure.name).fill("-5");
		await field(page, leisure.name).press("Tab");
		await expect(page.getByText("Le montant ne peut pas être négatif.")).toBeVisible();

		await field(page, leisure.name).fill("200");
		await field(page, leisure.name).press("Tab");
		await expect(allocation(page)).toContainText("Plus de 100 % alloués");
		await expect(allocation(page)).toContainText(`Budget dépassé de ${euros(20_000)}`);
		await expect(page.getByRole("button", { name: "Valider" })).toBeDisabled();

		// The month's donut gives way to the warning.
		await page.goto("/budgets/2024-02");
		await expect(page.getByRole("heading", { name: "Budget sur-alloué" })).toBeVisible();
		await expect(donut(page).getByRole("img")).toBeHidden();
		await page.getByRole("link", { name: "Corriger les catégories" }).click();

		await expect(page).toHaveURL("/budgets/2024-02/categories");
		await field(page, leisure.name).fill("");
		await field(page, leisure.name).press("Tab");
		await expect(allocation(page)).toContainText("100 % alloués");
		await page.getByRole("button", { name: "Valider" }).click();
		await expect(page).toHaveURL("/budgets/2024-02");
		await expect(donut(page).getByRole("img")).toBeVisible();
	});

	await test.step("the cards show each status, in « Dépassées » or « Dans les clous »", async () => {
		const over = group(page, "Dépassées");
		const onTrack = group(page, "Dans les clous");

		// Spent with no amount: over, its budget left out. « Sans catégorie »
		// has nothing left once the categories take the whole total.
		await expect(over.getByRole("button")).toHaveCount(2);
		await expect(card(page, gifts.name)).toContainText("Dépassé");
		await expect(card(page, gifts.name)).toContainText(`Dépensé : ${euros(3_500)}`);
		await expect(card(page, gifts.name)).toContainText(`Dépassement : ${euros(3_500)}`);
		await expect(card(page, gifts.name)).not.toContainText("Budgété");
		await expect(card(page, gifts.name).locator('[data-status="budgetOver"]')).toHaveCSS(
			"color",
			rgb("#c91313"),
		);

		await expect(card(page, "Sans catégorie")).toContainText(`Dépensé : ${euros(3_000)}`);
		await expect(card(page, "Sans catégorie")).toContainText(`Dépassement : ${euros(3_000)}`);

		// The parent, then its children: « Loisirs », neither budgeted nor
		// spending, is hidden.
		await expect(onTrack.getByRole("button")).toHaveCount(3);
		await expect(card(page, house.name)).toContainText("Dans les clous");
		await expect(card(page, house.name)).toContainText(`Dépensé : ${euros(75_000)}`);
		await expect(card(page, house.name)).toContainText(`Budgété : ${euros(100_000)}`);
		await expect(card(page, house.name)).toContainText(`Reste : ${euros(25_000)}`);
		await expect(card(page, works.name)).toContainText(`Reste : ${euros(20_000)}`);
		// Shared: what the parent keeps beyond « Travaux », 700, less its 650.
		await expect(card(page, garden.name)).toContainText("Bientôt atteint");
		await expect(card(page, garden.name)).toContainText("Budgété : Partagé");
		await expect(card(page, garden.name)).toContainText(`Reste : ${euros(5_000)}`);
		await expect(card(page, leisure.name)).toBeHidden();
	});

	await test.step("the filter keeps one group, in the URL", async () => {
		const filter = page.getByRole("radiogroup", { name: "Filtrer les catégories" });
		await filter.getByRole("radio", { name: "Dépassées" }).click();

		await expect(page).toHaveURL("/budgets/2024-02?filter=over-budget");
		await expect(group(page, "Dans les clous")).toBeHidden();
		await page.reload();
		await expect(card(page, gifts.name)).toBeVisible();
		await expect(group(page, "Dans les clous")).toBeHidden();

		await filter.getByRole("radio", { name: "Toutes" }).click();
		await expect(page).toHaveURL("/budgets/2024-02");
		await expect(group(page, "Dans les clous")).toBeVisible();
	});

	await test.step("a card opens its sheet, with the month's latest rows", async () => {
		await card(page, house.name).click();
		const sheet = page.getByRole("dialog", { name: house.name });

		await expect(sheet).toContainText(`Dépenses de février 2024${euros(75_000)}`);
		await expect(sheet).toContainText(`Statut${euros(25_000)} restants`);
		await expect(sheet).toContainText(`Budgété${euros(100_000)}`);
		// December, its one earlier month.
		await expect(sheet).toContainText(`Moyenne mensuelle${euros(40_000)}`);
		await expect(sheet).toContainText(`Médiane mensuelle${euros(40_000)}`);
		const recent = sheet.getByRole("list", { name: "Opérations récentes" });
		await expect(recent.getByRole("listitem")).toHaveCount(2);
		await expect(recent.getByRole("listitem").first()).toContainText("Pépinière");
		await expect(recent.getByRole("listitem").last()).toContainText("Peinture");

		await sheet.getByRole("link", { name: "Voir toutes les opérations" }).click();
		await expect(page).toHaveURL(/\/transactions\?/u);
		await expect(page).toHaveURL(new RegExp(`[?&]category=[^&]*${house.id}`, "u"));
		await expect(page).toHaveURL(/[?&]from=2024-02-01(&|$)/u);
		await expect(page).toHaveURL(/[?&]to=2024-02-29(&|$)/u);
		// The parent's rows and its children's, as the sheet listed them.
		await expect(page.getByText("Pépinière")).toBeVisible();
	});

	await test.step("a sheet lists three rows, « Sans catégorie »'s its outflow only", async () => {
		await page.goto("/budgets/2024-02");
		await card(page, gifts.name).click();
		const gifted = page.getByRole("dialog", { name: gifts.name });
		const giftRows = gifted
			.getByRole("list", { name: "Opérations récentes" })
			.getByRole("listitem");

		await expect(giftRows).toHaveCount(3);
		await expect(giftRows.nth(0)).toContainText("Papier");
		await expect(giftRows.nth(1)).toContainText("Ruban");
		await expect(giftRows.nth(2)).toContainText("Carte");
		await page.keyboard.press("Escape");
		await expect(gifted).toBeHidden();

		await card(page, "Sans catégorie").click();
		const uncategorised = page.getByRole("dialog", { name: "Sans catégorie" });
		const rows = uncategorised
			.getByRole("list", { name: "Opérations récentes" })
			.getByRole("listitem");

		await expect(rows).toHaveCount(1);
		await expect(rows).toContainText("Retrait");
		await uncategorised.getByRole("link", { name: "Voir toutes les opérations" }).click();
		await expect(page).toHaveURL(/[?&]category=[^&]*none/u);
		await expect(page).toHaveURL(/[?&]direction=[^&]*expense/u);
		await expect(page).toHaveURL(/[?&]from=2024-02-01(&|$)/u);
		await expect(page).toHaveURL(/[?&]to=2024-02-29(&|$)/u);
		await expect(page.getByText("Retrait")).toBeVisible();
		await expect(page.getByText("Remboursement")).toBeHidden();
	});
});

const moveButton = (page: Page, name: string) =>
	page.getByRole("button", { name: `Déplacer de l'argent depuis ${name}`, exact: true });

test("a month is copied from the latest one set up, then money moves between its categories", async ({
	page,
	api,
	request,
}) => {
	// Story 17.3: March 2024 is set up, April left alone, May copied. No line
	// is needed: the account only keeps March inside the budgets' bounds.
	await api.openAccount({ openingBalance: "0", openingDate: "2024-03-01" });
	const house = await api.createCategory({ name: uniqueName("Maison") });
	const works = await api.createCategory({ name: uniqueName("Travaux"), parentId: house.id });
	const garden = await api.createCategory({ name: uniqueName("Jardin"), parentId: house.id });
	const leisure = await api.createCategory({ name: uniqueName("Loisirs") });
	const setUp = await request.put("/api/budgets/2024-03", {
		data: { budgetedSpending: "1 500,00", expectedIncome: "2 000,00" },
	});
	expect(setUp.ok(), await setUp.text()).toBe(true);
	// One after the other: each is an `immediate` write. « Maison » ends at
	// 1 000, its reserve of 700 beside « Travaux », ring-fenced at 300.
	await (
		[
			[house.id, "700"],
			[works.id, "300"],
			[leisure.id, "200"],
		] as const
	).reduce(async (previous, [categoryId, budgetedSpending]) => {
		await previous;
		const saved = await request.put(`/api/budgets/2024-03/categories/${categoryId}`, {
			data: { budgetedSpending },
		});
		expect(saved.ok(), await saved.text()).toBe(true);
	}, Promise.resolve());

	await test.step("a month not set up offers the latest earlier month, or a blank form", async () => {
		await page.goto("/budgets/2024-04");
		await expect(page.getByRole("button", { name: "Copier mars 2024" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Définir le budget" })).toBeHidden();
		await page.getByRole("link", { name: "Partir de zéro" }).click();

		await expect(page).toHaveURL("/budgets/2024-04/edit");
		await expect(
			page.getByRole("heading", { level: 1, name: "Définir le budget d'avril 2024" }),
		).toBeVisible();
	});

	await test.step("« Copier » skips the month left alone, then opens « Catégories »", async () => {
		await page.goto("/budgets/2024-05");
		await expect(page.getByText("Reprenez les montants de mars 2024")).toBeVisible();
		await page.getByRole("button", { name: "Copier mars 2024" }).click();

		await expect(page).toHaveURL("/budgets/2024-05/categories");
		await expect(page.getByText("Budget copié depuis mars 2024.")).toBeVisible();
		await expect(field(page, house.name)).toHaveValue("1000,00");
		await expect(field(page, works.name)).toHaveValue("300,00");
		await expect(field(page, garden.name)).toHaveValue("");
		await expect(field(page, leisure.name)).toHaveValue("200,00");
		await expect(allocation(page)).toContainText("80 % alloués");
	});

	await test.step("only a category that can give some offers a move", async () => {
		await expect(moveButton(page, house.name)).toBeVisible();
		await expect(moveButton(page, works.name)).toBeVisible();
		// Shared, it holds nothing of its own.
		await expect(moveButton(page, garden.name)).toHaveCount(0);
	});

	await test.step("a move refuses more than the source can give, then moves", async () => {
		await moveButton(page, house.name).click();
		const dialog = page.getByRole("dialog", { name: `Déplacer de l'argent depuis ${house.name}` });
		// What « Maison » keeps beyond « Travaux »: 700, not its 1 000.
		await expect(dialog).toContainText(`${house.name} peut donner jusqu'à ${euros(70_000)}`);

		await dialog.getByRole("combobox", { name: "Vers" }).click();
		const options = page.getByRole("listbox");
		await expect(options.getByRole("option", { name: house.name, exact: true })).toBeDisabled();
		await expect(options.getByRole("option", { name: works.name, exact: true })).toBeDisabled();
		await expect(options.getByRole("option", { name: garden.name, exact: true })).toBeDisabled();
		await options.getByRole("option", { name: leisure.name, exact: true }).click();

		await dialog.getByLabel("Montant").fill("701");
		await dialog.getByRole("button", { name: "Déplacer" }).click();
		await expect(dialog.getByText("Cette catégorie ne peut pas donner autant.")).toBeVisible();

		await dialog.getByLabel("Montant").fill("50");
		await dialog.getByRole("button", { name: "Déplacer" }).click();

		await expect(dialog).toBeHidden();
		await expect(page.getByText("Argent déplacé.")).toBeVisible();
		await expect(field(page, house.name)).toHaveValue("950,00");
		await expect(field(page, leisure.name)).toHaveValue("250,00");
		await expect(allocation(page)).toContainText("80 % alloués");
	});

	await test.step("a subcategory cannot send to its own parent", async () => {
		await moveButton(page, works.name).click();
		const dialog = page.getByRole("dialog", { name: `Déplacer de l'argent depuis ${works.name}` });
		await dialog.getByRole("combobox", { name: "Vers" }).click();
		const options = page.getByRole("listbox");

		await expect(options.getByRole("option", { name: house.name, exact: true })).toBeDisabled();
		await expect(options.getByRole("option", { name: garden.name, exact: true })).toBeEnabled();
		await page.keyboard.press("Escape");
		await dialog.getByRole("button", { name: "Annuler" }).click();
		await expect(dialog).toBeHidden();
	});

	await test.step("a copy into a month set up meanwhile is refused, and the month shows", async () => {
		await page.goto("/budgets/2024-04");
		const copy = page.getByRole("button", { name: "Copier mars 2024" });
		await expect(copy).toBeVisible();
		// Set up in another tab while this one still offers the copy.
		const setUpMeanwhile = await request.put("/api/budgets/2024-04", {
			data: { budgetedSpending: "900,00", expectedIncome: "0" },
		});
		expect(setUpMeanwhile.ok(), await setUpMeanwhile.text()).toBe(true);
		await copy.click();

		await expect(page.getByText("Ce mois a déjà un budget. Il n'a pas été modifié.")).toBeVisible();
		await expect(copy).toBeHidden();
		await expect(plan(page, "Dépenses prévues")).toContainText(euros(90_000));
	});
});

const rolloverSwitch = (page: Page, name: string) =>
	page.getByRole("switch", { name: `Report de ${name}`, exact: true });

/** Flips a category's « Report » switch, and waits for the server to save it. */
async function flipRollover(page: Page, name: string) {
	const saved = page.waitForResponse(
		(response) => response.url().endsWith("/rollover") && response.request().method() === "PUT",
	);
	await rolloverSwitch(page, name).click();
	expect((await saved).ok()).toBe(true);
}

test("what a category leaves carries into the next month set up, while its switch is on", async ({
	page,
	api,
	request,
}) => {
	// Story 17.4: September 2024 is set up, October copied, November left
	// alone, December set up by its form. Those months come after every
	// earlier test's, so no month another test shows offers to copy them.
	const account = await api.openAccount({ openingBalance: "0", openingDate: "2024-09-01" });
	const gifts = await api.createCategory({ name: uniqueName("Cadeaux") });
	const setUp = await request.put("/api/budgets/2024-09", {
		data: { budgetedSpending: "1 000,00", expectedIncome: "0" },
	});
	expect(setUp.ok(), await setUp.text()).toBe(true);
	const amount = await request.put(`/api/budgets/2024-09/categories/${gifts.id}`, {
		data: { budgetedSpending: "100" },
	});
	expect(amount.ok(), await amount.text()).toBe(true);
	const spent = await api.addTransaction(account.id, {
		date: "2024-09-10",
		label: "Fleuriste",
		amount: "-30,00",
	});
	await api.categorise([spent], gifts.id);

	await test.step("« Report » saves on change", async () => {
		await page.goto("/budgets/2024-09/categories");
		const toggle = rolloverSwitch(page, gifts.name);
		await expect(toggle).not.toBeChecked();
		await expect(toggle).toHaveAttribute(
			"title",
			"Conserver d'un mois sur l'autre ce que cette catégorie n'a pas dépensé",
		);

		await flipRollover(page, gifts.name);
		await expect(toggle).toBeChecked();
		await page.reload();
		await expect(rolloverSwitch(page, gifts.name)).toBeChecked();
	});

	await test.step("a copy keeps the switch, and the card shows what came in", async () => {
		await page.goto("/budgets/2024-10");
		await page.getByRole("button", { name: "Copier septembre 2024" }).click();
		await expect(page).toHaveURL("/budgets/2024-10/categories");
		await expect(rolloverSwitch(page, gifts.name)).toBeChecked();
		// What came in is not allocated: only the 100 copied counts.
		await expect(allocation(page)).toContainText("10 % alloués");

		await page.getByRole("button", { name: "Valider" }).click();
		await expect(page).toHaveURL("/budgets/2024-10");
		await expect(card(page, gifts.name)).toContainText(`Budgété : ${euros(10_000)}`);
		await expect(card(page, gifts.name)).toContainText(`+${euros(7_000)} reporté`);
		await expect(card(page, gifts.name)).toContainText(`Reste : ${euros(17_000)}`);
	});

	await test.step("the sheet shows what came in", async () => {
		await card(page, gifts.name).click();
		const sheet = page.getByRole("dialog", { name: gifts.name });

		await expect(sheet).toContainText(`Budgété${euros(10_000)}`);
		await expect(sheet).toContainText(`Reporté${euros(7_000)}`);
		await expect(sheet).toContainText(`Statut${euros(17_000)} restants`);
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();
	});

	await test.step("a month set up by its form inherits the switch, across a month left alone", async () => {
		await page.goto("/budgets/2024-12");
		await page.getByRole("link", { name: "Partir de zéro" }).click();
		await page.getByLabel("Dépenses prévues").fill("1 000");
		await page.getByLabel("Revenus attendus").fill("0");
		await page.getByRole("button", { name: "Enregistrer" }).click();

		await expect(page).toHaveURL("/budgets/2024-12/categories");
		await expect(rolloverSwitch(page, gifts.name)).toBeChecked();
		await expect(page.getByRole("textbox", { name: gifts.name, exact: true })).toHaveValue("");

		await page.getByRole("button", { name: "Valider" }).click();
		// October's 100 and the 70 it received, November skipped.
		await expect(card(page, gifts.name)).toContainText(`+${euros(17_000)} reporté`);
		await expect(card(page, gifts.name)).toContainText(`Reste : ${euros(17_000)}`);
	});

	await test.step("switching it off stops the carry, in that month and the later ones", async () => {
		await page.goto("/budgets/2024-10/categories");
		await flipRollover(page, gifts.name);
		await expect(rolloverSwitch(page, gifts.name)).not.toBeChecked();

		await page.getByRole("button", { name: "Valider" }).click();
		await expect(page).toHaveURL("/budgets/2024-10");
		await expect(card(page, gifts.name)).not.toContainText("reporté");
		await expect(card(page, gifts.name)).toContainText(`Reste : ${euros(10_000)}`);

		// December, read again since the write staled it, has nothing left to show.
		await page.getByRole("link", { name: "Mois suivant" }).click();
		await page.getByRole("link", { name: "Mois suivant" }).click();
		await expect(heading(page, "2024-12")).toBeVisible();
		await expect(card(page, gifts.name)).toBeHidden();
		await page.goto("/budgets/2024-12/categories");
		await expect(rolloverSwitch(page, gifts.name)).not.toBeChecked();
	});
});
