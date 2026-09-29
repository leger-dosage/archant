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

/** The vertical middle of a box, to tell which line it sits on. */
const middle = (box: { y: number; height: number } | null) =>
	(box?.y ?? 0) + (box?.height ?? 0) / 2;

async function visitOperations(page: Page, q: string) {
	await page.goto(`/transactions?q=${encodeURIComponent(q)}`);
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await expect(rowItem(page, q).first()).toBeVisible();
}

test("each row shows its icon, pill, account, badges and amount on one 56 px line, in its day's tray under the column header", async ({
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

	// The column header: uppercase names on the grey tray, over the rows' cells.
	const columns = page.getByRole("main").locator('[data-slot="column-header"]');
	await expect(columns).toHaveCSS("background-color", rgb("#f2f2f3"));
	await expect(columns).toHaveCSS("border-radius", "12px");
	await expect(columns).toHaveCSS("text-transform", "uppercase");
	await expect(columns).toHaveCSS("font-size", "12px");
	await expect(columns.locator("span").filter({ hasText: /./u })).toHaveText([
		"Opération",
		"Catégorie",
		"Compte",
		"Montant",
	]);

	// The day's tray: its day, « · 8 » read « 8 opérations », and the signed sum
	// of its rows, transfers included, over a white block of the rows.
	const day = page.getByRole("main").locator('[data-slot="inset-group"]');
	await expect(day).toHaveCount(1);
	await expect(day).toHaveCSS("background-color", rgb("#f2f2f3"));
	await expect(day).toHaveCSS("border-radius", "12px");
	const dayHeading = day.getByRole("heading", { level: 3 });
	await expect(dayHeading).toHaveCSS("text-transform", "uppercase");
	const dayHeader = dayHeading.locator("../..");
	await expect(dayHeader).toContainText("8 opérations");
	await expect(dayHeader).toContainText(euros(-(1234 + 500 + 100 + 999)));
	const block = day.locator("ul").locator("..");
	await expect(block).toHaveCSS("background-color", rgb("#ffffff"));
	await expect(block).toHaveCSS("overflow", "hidden");
	await expect(block.getByRole("listitem")).toHaveCount(8);
	await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(8);

	const box = await rowItem(page, label.food).boundingBox();
	expect(box?.height).toBe(56);
	await expect(rowIcon(page, label.food)).toHaveCSS("width", "36px");
	await expect(rowIcon(page, label.food)).toHaveCSS("height", "36px");
	await expect(pill(page, label.food)).toHaveCSS("height", "24px");
	await expect(pill(page, label.food).locator("svg")).toHaveCSS("width", "12px");

	// Each name sits over its cells: the category's start, the amount's end.
	const [categoryName, amountNameEnd, pillBox, amountBox] = await Promise.all([
		columns.getByText("Catégorie").boundingBox(),
		columns
			.getByText("Montant")
			.evaluate(
				(element) =>
					element.getBoundingClientRect().right -
					Number.parseFloat(getComputedStyle(element).paddingRight),
			),
		pill(page, label.food).boundingBox(),
		rowButton(page, label.food).getByText(euros(-1234)).boundingBox(),
	]);
	expect(pillBox?.x).toBeCloseTo(categoryName?.x ?? 0, 0);
	expect((amountBox?.x ?? 0) + (amountBox?.width ?? 0)).toBeCloseTo(amountNameEnd, 0);

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

	// Below 1024 px the account column goes, its header name with it.
	await page.setViewportSize({ width: 900, height: 900 });

	await expect(rowButton(page, label.food).locator('[data-slot="row-account"]')).toBeHidden();
	await expect(columns.getByText("Compte", { exact: true })).toBeHidden();
	await expect(columns.getByText("Catégorie")).toBeVisible();
	expect((await rowItem(page, label.food).boundingBox())?.height).toBe(56);
});

test("below 768 px a row takes two lines: the label and the amount, then the date and the category", async ({
	page,
	api,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const prefix = uniqueName("Mobile");
	const date = daysAgo(3);
	const account = await api.openAccount();
	const food = await api.createCategory({ name: uniqueName("Marché"), icon: "utensils" });
	const id = await api.addTransaction(account.id, {
		date,
		label: `${prefix} courses`,
		amount: "-23,45",
	});
	await api.categorise([id], food.id);

	await visitOperations(page, prefix);

	const label = `${prefix} courses`;
	const shortDate = new Intl.DateTimeFormat("fr-FR", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${date}T00:00:00Z`));
	await expect(page.getByRole("main").locator('[data-slot="column-header"]')).toBeHidden();
	const [labelBox, amountBox, dateBox, pillBox] = await Promise.all([
		rowButton(page, label).getByText(label).boundingBox(),
		rowButton(page, label).getByText(euros(-2345)).boundingBox(),
		rowButton(page, label).getByText(shortDate).boundingBox(),
		pill(page, label).boundingBox(),
	]);

	expect(middle(amountBox)).toBeCloseTo(middle(labelBox), 0);
	expect(middle(pillBox)).toBeCloseTo(middle(dateBox), 0);
	expect(dateBox?.y).toBeGreaterThanOrEqual((labelBox?.y ?? 0) + (labelBox?.height ?? 0));
	expect(pillBox?.x).toBeGreaterThan((dateBox?.x ?? 0) + (dateBox?.width ?? 0));
	// Room for the name under the amount's column too.
	await expect
		.poll(() =>
			pill(page, label)
				.getByText(food.name)
				.evaluate((element) => element.scrollWidth <= element.clientWidth),
		)
		.toBe(true);
	expect(amountBox?.x).toBeGreaterThan((labelBox?.x ?? 0) + (labelBox?.width ?? 0));
	await expect(pill(page, label)).toHaveText(food.name);
	await expect(rowButton(page, label).locator('[data-slot="row-account"]')).toBeHidden();
});

test("the sheet is a 550 px drawer 12 px off the viewport's edges, and the whole screen below 768 px", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Tiroir");
	const account = await api.openAccount();
	await api.addTransaction(account.id, { date: daysAgo(1), label: prefix, amount: "-4,00" });
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });

	await visitOperations(page, prefix);
	await rowButton(page, prefix).click();

	await expect(sheet).toBeVisible();
	await expect(sheet).toHaveCSS("border-radius", "12px");
	await expect(sheet).toHaveCSS("border-top-width", "1px");
	// Waits for the slide in to end.
	await expect.poll(async () => (await sheet.boundingBox())?.x).toBe(1440 - 12 - 550);
	expect(await sheet.boundingBox()).toEqual({ x: 878, y: 12, width: 550, height: 900 - 24 });

	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(rowButton(page, prefix)).toBeFocused();

	await page.setViewportSize({ width: 390, height: 844 });
	await page.keyboard.press("Enter");

	await expect(sheet).toBeVisible();
	await expect(sheet).toHaveCSS("border-radius", "0px");
	await expect.poll(async () => (await sheet.boundingBox())?.x).toBe(0);
	expect(await sheet.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
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
		both: `${prefix} attente et doublon`,
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
				pending: item.label === label.pending || item.label === label.both,
				possibleDuplicate: item.label === label.duplicate || item.label === label.both,
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
	await expect(badges(page, label.both)).toHaveText(["En attente", "Doublon possible"]);

	// Below 768 px a badge is its icon alone, its name kept for screen readers,
	// so two badges leave the label room on one line.
	await page.setViewportSize({ width: 390, height: 844 });

	const both = rowButton(page, label.both);
	const text = both.getByText(label.both, { exact: true });
	await expect(text).toBeVisible();
	expect((await text.boundingBox())?.width).toBeGreaterThan(80);
	await expect(badges(page, label.both).locator("svg.lucide-clock")).toBeVisible();
	await expect(badges(page, label.both).locator("svg.lucide-triangle-alert")).toBeVisible();
	await expect(badges(page, label.both)).toHaveText(["En attente", "Doublon possible"]);
	await Promise.all(
		(await badges(page, label.both).all()).map(async (badge) =>
			expect((await badge.boundingBox())?.width).toBeLessThanOrEqual(24),
		),
	);
	expect(middle(await text.boundingBox())).toBeCloseTo(
		middle(await both.getByText(euros(-300)).boundingBox()),
		0,
	);
});
