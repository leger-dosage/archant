import { z } from "zod";

import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

const totals = z.object({
	data: z.object({
		saved: z.number(),
		target: z.number(),
		behind: z.number(),
		paceUnknown: z.number(),
	}),
});

test("Plan links to the current budget and to goals on desktop and phone", async ({
	page,
	api,
	request,
}) => {
	const day = daysAgo(0);
	const month = day.slice(0, 7);
	const savings = await api.openAccount({
		name: uniqueName("Livret Plan"),
		kind: "savings",
		openingBalance: "250",
	});
	const archived = await api.createGoal({
		targetAmount: "500",
		accounts: [{ accountId: savings.id }],
	});
	await api.goalEvent(archived.id, "archive");

	await page.goto("/");
	const navigation = page.getByRole("navigation", { name: "Navigation principale" });
	const planLink = navigation.getByRole("link", { name: "Plan", exact: true });
	await expect(navigation.getByRole("link", { name: /^(Budgets|Objectifs)$/u })).toHaveCount(0);
	await planLink.click();
	await expect(page).toHaveURL("/plan");
	await expect(planLink).toHaveAttribute("aria-current", "page");
	await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible();
	await expect(
		page.getByText("Décidez où va votre argent : ce que vous dépensez et ce que vous épargnez."),
	).toBeVisible();

	const goals = page.getByRole("region", { name: "Vos objectifs" });
	await goals.getByRole("link", { name: "Tous les objectifs" }).click();
	await expect(page).toHaveURL("/goals");
	await expect(planLink).toHaveAttribute("aria-current", "page");
	await page.getByRole("button", { name: /Afficher.*archivé/iu }).click();
	await expect(page.getByRole("link", { name: new RegExp(archived.name, "u") })).toBeVisible();
	await planLink.click();

	const budget = page.getByRole("region", { name: "Ce mois-ci" });
	await budget.getByRole("link", { name: "Configurer le budget de ce mois-ci" }).click();
	await expect(page).toHaveURL(`/budgets/${month}/edit`);
	await expect(planLink).toHaveAttribute("aria-current", "page");
	await expect(
		page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: "Plan" }),
	).toHaveAttribute("href", "/plan");

	const account = await api.openAccount({ name: uniqueName("Compte Plan") });
	const category = await api.createCategory({ name: uniqueName("Charges Plan") });
	const spend = await api.addTransaction(account.id, {
		date: day,
		label: "Charges fictives",
		amount: "-8000",
	});
	await api.categorise([spend], category.id);
	const setUp = await request.put(`/api/budgets/${month}`, {
		data: { budgetedSpending: "16000", expectedIncome: "20000" },
	});
	expect(setUp.ok(), await setUp.text()).toBe(true);
	const allocated = await request.put(`/api/budgets/${month}/categories/${category.id}`, {
		data: { budgetedSpending: "10000" },
	});
	expect(allocated.ok(), await allocated.text()).toBe(true);

	const baseline = totals.parse(await (await request.get("/api/goals/summary")).json()).data;
	const goal = await api.createGoal({
		name: uniqueName("A Plan"),
		targetAmount: "500",
		targetDate: daysAgo(1),
		accounts: [{ accountId: savings.id }],
	});
	await page.goto("/plan");
	await expect(budget).toContainText(`sur ${euros(1_600_000)}`);
	await expect(budget).toContainText(/\d+ % utilisés/u);
	await expect(budget).toContainText(/\d+ jours? restants?/u);
	const topCategory = budget
		.getByRole("list", { name: "Principales catégories" })
		.getByRole("listitem")
		.first();
	await expect(topCategory).toContainText(category.name);
	await expect(topCategory).toContainText(`${euros(800_000)} / ${euros(1_000_000)}`);
	await expect(goals).toContainText(euros(baseline.saved + 25_000));
	expect((await goals.boundingBox())?.x).toBeGreaterThan((await budget.boundingBox())?.x ?? 0);
	await expect(goals).toContainText(
		`sur ${euros(baseline.target + 50_000)} tous objectifs confondus`,
	);
	await expect(goals).toContainText(`${baseline.paceUnknown + 1} au rythme inconnu`);
	await api.addTransaction(savings.id, { date: day, label: "Versement fictif", amount: "1" });
	await page.reload();
	await expect(goals).toContainText(`${baseline.behind + 1} en retard`);
	await goals.getByRole("button", { name: "Nouvel objectif" }).click();
	await expect(page.getByRole("dialog", { name: "Nouvel objectif" })).toBeVisible();
	await page.keyboard.press("Escape");
	await goals.getByRole("link", { name: goal.name }).click();
	await expect(page).toHaveURL(`/goals/${goal.id}`);
	await expect(planLink).toHaveAttribute("aria-current", "page");
	await expect(
		page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: "Plan" }),
	).toHaveAttribute("href", "/plan");

	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: "dark" });
	await planLink.click();
	await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
	await expect(goals).toBeVisible();
	expect((await goals.boundingBox())?.y).toBeGreaterThan((await budget.boundingBox())?.y ?? 0);
	await budget.getByRole("link", { name: "Voir le budget complet" }).click();
	await expect(page).toHaveURL(`/budgets/${month}`);
	await expect(planLink).toHaveAttribute("aria-current", "page");
	await navigation.getByRole("link", { name: "Accueil" }).click();
	await expect(page.getByRole("region", { name: "Bilan", exact: true })).toBeVisible();
	await expect(page.getByRole("region", { name: "Objectifs", exact: true })).toHaveCount(0);
});

test("Plan explains when the combined goal target exceeds the money range", async ({
	page,
	api,
	request,
}) => {
	const account = await api.openAccount({ kind: "savings", openingBalance: "100" });
	const goal = await api.createGoal({ targetAmount: "500", accounts: [{ accountId: account.id }] });
	try {
		await page.route("**/api/goals/summary", async (route) => {
			const response = await route.fetch();
			const { data } = z.object({ data: z.looseObject({}) }).parse(await response.json());
			await route.fulfill({ response, json: { data: { ...data, target: null } } });
		});

		await page.goto("/plan");
		const goals = page.getByRole("region", { name: "Vos objectifs" });
		await expect(goals).toContainText("Montant visé total trop élevé pour être affiché");
		await expect(goals.getByRole("link", { name: "Tous les objectifs" })).toBeVisible();
	} finally {
		await request.delete(`/api/goals/${goal.id}`);
	}
});
