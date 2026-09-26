import type { Page } from "@playwright/test";

import { randomInt } from "node:crypto";
import { z } from "zod";

import { daysAgo, euros, expect, rgb, test, uniqueName } from "./fixtures.ts";

// Story 12.3: DESIGN.md's transaction row and day header. One database
// serves the whole run, so each test lists its rows by a prefix of its own.

const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

const rowButton = (page: Page, label: string) =>
	rowItem(page, label).locator("button[data-transaction-id]");

/** The row's own icon, the first in its button; the account's comes after. */
const rowIcon = (page: Page, label: string) =>
	rowButton(page, label).locator('[data-slot="tinted-icon"]').first();

const pill = (page: Page, label: string) =>
	rowItem(page, label).locator('[data-slot="category-pill"]');

const badges = (page: Page, label: string) =>
	rowButton(page, label).locator('[data-slot="status-badge"]');

const accountIcon = (page: Page, label: string) =>
	rowButton(page, label).locator('[data-slot="row-account"] [data-slot="tinted-icon"]');

// Loose: every other field passes through untouched.
const listBody = z.object({
	data: z.looseObject({ items: z.array(z.looseObject({ label: z.string() })) }),
});

/** An amount in euros no other test uses, as typed: `517,23`. */
function uniqueAmount(): string {
	return `${randomInt(100, 900)},${String(randomInt(100)).padStart(2, "0")}`;
}

async function visitOperations(page: Page, q: string) {
	await page.goto(`/transactions?q=${encodeURIComponent(q)}`);
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await expect(rowItem(page, q).first()).toBeVisible();
}

test("each row shows its icon, pill, account, badges and amount on one 36 px line, under its day's count and subtotal", async ({
	page,
	api,
}) => {
	await page.emulateMedia({ colorScheme: "light" });
	const prefix = uniqueName("Ligne");
	const date = daysAgo(2);
	const checking = await api.openAccount({ name: uniqueName("Compte courant") });
	const livret = await api.openAccount({ name: uniqueName("Livret A"), kind: "savings" });
	const loan = await api.openAccount({
		name: uniqueName("Prêt immobilier"),
		kind: "mortgage",
		openingBalance: "180 000,00",
	});
	const food = await api.createCategory({ name: uniqueName("Alimentation"), icon: "utensils" });
	const merchant = await api.createMerchant(uniqueName("Zèbre"));
	const saved = uniqueAmount();
	const repaid = uniqueAmount();
	const label = {
		food: `${prefix} courses`,
		merchant: `${prefix} marchand`,
		bare: `${prefix} nu`,
		out: `${prefix} épargne`,
		into: `${prefix} livret`,
		instalment: `${prefix} échéance`,
		repayment: `${prefix} prêt`,
		subscription: `${prefix} abonnement`,
	};
	const foodId = await api.addTransaction(checking.id, {
		date,
		label: label.food,
		amount: "-12,34",
	});
	const merchantId = await api.addTransaction(checking.id, {
		date,
		label: label.merchant,
		amount: "-5,00",
	});
	await api.addTransaction(checking.id, { date, label: label.bare, amount: "-1,00" });
	// Each pair is linked on creation: one candidate of the opposite amount.
	await api.addTransaction(checking.id, { date, label: label.out, amount: `-${saved}` });
	await api.addTransaction(livret.id, { date, label: label.into, amount: saved });
	const instalmentId = await api.addTransaction(checking.id, {
		date,
		label: label.instalment,
		amount: `-${repaid}`,
	});
	await api.addTransaction(loan.id, { date, label: label.repayment, amount: repaid });
	const subscriptionId = await api.addTransaction(checking.id, {
		date,
		label: label.subscription,
		amount: "-9,99",
	});
	await api.categorise([foodId, instalmentId], food.id);
	await api.setMerchant([merchantId], merchant.id);
	await api.addRecurring(subscriptionId);

	await visitOperations(page, prefix);

	// The day header: its day, « 8 » read « 8 opérations », and the signed sum
	// of its rows, transfers included.
	const dayHeader = page.getByRole("main").getByRole("heading", { level: 3 }).locator("..");
	await expect(dayHeader).toHaveCount(1);
	await expect(dayHeader).toContainText("8 opérations");
	await expect(dayHeader).toContainText(euros(-(1234 + 500 + 100 + 999)));
	await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(8);

	const box = await rowItem(page, label.food).boundingBox();
	expect(box?.height).toBe(36);

	await expect(rowIcon(page, label.food).locator("svg.lucide-utensils")).toBeVisible();
	await expect(pill(page, label.food)).toHaveText(food.name);
	await expect(rowIcon(page, label.merchant)).toHaveText("Z");
	await expect(rowButton(page, label.merchant)).toContainText(merchant.name);
	await expect(pill(page, label.merchant)).toHaveText("Sans catégorie");
	await expect(rowIcon(page, label.bare).locator("svg.lucide-circle-dashed")).toBeVisible();
	await expect(pill(page, label.bare)).toHaveText("Sans catégorie");
	await expect(badges(page, label.bare)).toHaveCount(0);

	// Both sides of a move between accounts.
	await Promise.all(
		[label.out, label.into].flatMap((side) => [
			expect(rowIcon(page, side).locator("svg.lucide-arrow-left-right")).toBeVisible(),
			expect(pill(page, side)).toHaveText("Virement"),
			expect(badges(page, side)).toHaveText(["Virement interne"]),
			expect(badges(page, side).locator("svg.lucide-arrow-left-right")).toBeVisible(),
		]),
	);
	await expect(rowButton(page, label.out)).toContainText(`Vers ${livret.name}`);

	// A spent loan payment keeps its category, and says it is a transfer.
	await expect(rowIcon(page, label.instalment).locator("svg.lucide-utensils")).toBeVisible();
	await expect(pill(page, label.instalment)).toHaveText(food.name);
	await expect(badges(page, label.instalment)).toHaveText(["Virement interne"]);
	await expect(rowButton(page, label.instalment)).toContainText(
		`Remboursement de prêt · Vers ${loan.name}`,
	);
	await expect(pill(page, label.repayment)).toHaveText("Remboursement de prêt");

	await expect(badges(page, label.subscription)).toHaveText(["Récurrent"]);
	await expect(badges(page, label.subscription).locator("svg.lucide-repeat")).toBeVisible();

	// The account column: the type's icon, then the name.
	await expect(rowButton(page, label.food).locator('[data-slot="row-account"]')).toHaveText(
		checking.name,
	);
	await expect(accountIcon(page, label.food).locator("svg.lucide-landmark")).toBeVisible();
	await expect(accountIcon(page, label.repayment).locator("svg.lucide-hand-coins")).toBeVisible();

	// A ticked row: the selection colour and the accent bar on its left edge.
	await rowItem(page, label.food)
		.getByRole("checkbox", { name: `Sélectionner « ${label.food} »` })
		.click();
	await expect(rowItem(page, label.food)).toHaveCSS("background-color", rgb("#f1f1ff"));
	const bar = await rowItem(page, label.food).evaluate((element) => {
		const style = getComputedStyle(element, "::before");

		return { color: style.backgroundColor, width: style.width };
	});
	expect(bar).toEqual({ color: rgb("#7170ff"), width: "2px" });
});

test("pending, possible duplicate and possible transfer rows each carry their badge", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("État");
	const account = await api.openAccount();
	const label = {
		pending: `${prefix} en attente`,
		duplicate: `${prefix} doublon`,
		suggested: `${prefix} virement`,
	};
	await Promise.all(
		Object.values(label).map((text) =>
			api.addTransaction(account.id, { date: daysAgo(1), label: text, amount: "-3,00" }),
		),
	);
	// States a bank sync or an import raises, set on the list's answer here so
	// the rows need no provider.
	await page.route(
		(url) => url.pathname === "/api/transactions",
		async (route) => {
			const response = await route.fetch();
			const body = listBody.parse(await response.json());
			const items = body.data.items.map((item) => ({
				...item,
				pending: item.label === label.pending,
				possibleDuplicate: item.label === label.duplicate,
				transferSuggested: item.label === label.suggested,
			}));

			await route.fulfill({ response, json: { data: { ...body.data, items } } });
		},
	);

	await visitOperations(page, prefix);

	await Promise.all(
		(
			[
				[label.pending, "En attente", "clock"],
				[label.duplicate, "Doublon possible", "triangle-alert"],
				[label.suggested, "Virement possible", "arrow-left-right"],
			] as const
		).flatMap(([row, text, icon]) => [
			expect(badges(page, row)).toHaveText([text]),
			expect(badges(page, row).locator(`svg.lucide-${icon}`)).toBeVisible(),
		]),
	);
	await expect(rowButton(page, label.pending).getByText(euros(-300))).toHaveClass(
		/text-muted-foreground/u,
	);
});
