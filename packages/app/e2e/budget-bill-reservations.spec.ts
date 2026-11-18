import { shiftMonth } from "@archant/data/months";

import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

test("an envelope shows the unpaid part of its bills beside its budget totals", async ({
	page,
	api,
	request,
}) => {
	const month = shiftMonth(daysAgo(0).slice(0, 7), 1);
	const category = await api.createCategory({ name: uniqueName("Énergie") });
	const budget = await request.put(`/api/budgets/${month}`, {
		data: { budgetedSpending: "500,00", expectedIncome: "0" },
	});
	expect(budget.ok(), await budget.text()).toBe(true);
	const allocation = await request.put(`/api/budgets/${month}/categories/${category.id}`, {
		data: { budgetedSpending: "300,00" },
	});
	expect(allocation.ok(), await allocation.text()).toBe(true);

	const bill = await api.declareBill({
		name: uniqueName("Électricité"),
		amount: "100,00",
		firstDueOn: `${month}-10`,
	});
	await api.editBill(bill, { categoryId: category.id });
	const occurrence = await api.currentOccurrence(bill);
	await api.addPayment(occurrence, { amount: "25,00", paidOn: daysAgo(0) });

	const dollars = await api.openAccount({
		name: uniqueName("Compte en dollars"),
		currency: "USD",
		openingBalance: "0",
	});
	const foreignBill = await api.declareBill({
		name: uniqueName("Abonnement"),
		accountId: dollars.id,
		amount: "20",
		firstDueOn: `${month}-12`,
	});
	await api.editBill(foreignBill, { categoryId: category.id });

	await page.goto(`/budgets/${month}`);
	const envelope = page.getByRole("button", { name: new RegExp(category.name, "u") });
	await expect(envelope).toContainText(`Dépensé : ${euros(0)}`);
	await expect(envelope).toContainText(`Budgété : ${euros(30_000)}`);
	await expect(envelope).toContainText(`Reste : ${euros(30_000)}`);
	await expect(envelope.getByText(`${euros(7_500)} réservés par des factures`)).toBeVisible();
	await expect(
		envelope.getByText("1 facture n'est pas réservée, aucun taux de change disponible"),
	).toBeVisible();

	await api.addPayment(occurrence, { amount: "75,00", paidOn: daysAgo(0) });
	await page.reload();
	await expect(envelope.getByText(/réservés par des factures/u)).toHaveCount(0);
	await expect(envelope).toContainText("1 facture n'est pas réservée");
	await expect(envelope).toContainText(`Reste : ${euros(30_000)}`);
});
