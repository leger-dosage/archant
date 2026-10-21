import type { Api } from "./fixtures.ts";
import type { Locator, Page } from "@playwright/test";

import { randomInt } from "node:crypto";
import { z } from "zod";

import { formatShortDate } from "../src/lib/balance-change.ts";
import { daysAgo, euros, expect, sgml, test, uniqueName } from "./fixtures.ts";

// Story 19.2: a transaction is split from its sheet, and the list shows each
// split's lines under their parent, which nothing counts. Story 31.3: each
// line's amount is signed, as Sure's, a line's label and category are read
// only, and « Préférences » lists lines flat.

const rowButton = (page: Page, label: string) =>
	page.getByRole("main").locator("button[data-transaction-id]").filter({ hasText: label });

/** A split's lines, the list nested in its parent's item. */
const linesOf = (page: Page, parentLabel: string) =>
	page.getByRole("main").getByRole("list", { name: `Lignes de « ${parentLabel} »` });

const sheet = (page: Page) => page.getByRole("dialog", { name: "Modifier l'opération" });

const splitDialog = (page: Page, name = "Diviser l'opération") =>
	page.getByRole("dialog", { name });

const line = (dialog: Locator, index: number) =>
	dialog.getByRole("group", { name: `Ligne ${String(index)}`, exact: true });

const remaining = (dialog: Locator) => dialog.locator('[data-slot="split-remaining"]');

// Loose: every other field passes through untouched.
const pendingListBody = z.object({
	data: z.looseObject({ items: z.array(z.looseObject({ label: z.string() })) }),
});

const toast = (page: Page, text: string) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

/**
 * The URLs of every `method` request to `/api/transactions/` from now on. A
 * dialog's submit once bubbled into the sheet's form along React's tree, and
 * saved the sheet with a PATCH sent in the same dispatch as the dialog's own.
 */
function recorded(page: Page, method: "PATCH" | "POST") {
	const urls: string[] = [];

	page.on("request", (request) => {
		if (request.method() === method && request.url().includes("/api/transactions/")) {
			urls.push(request.url());
		}
	});

	return urls;
}

/** An account with a transaction of -100,00 € two days ago, labelled `<prefix>`. */
async function hundred(api: Api, prefix: string) {
	const account = await api.openAccount({ name: uniqueName("Compte joint") });
	const id = await api.addTransaction(account.id, {
		date: daysAgo(2),
		label: prefix,
		amount: "-100,00",
	});

	return { account, id };
}

/** `hundred`, split into « <prefix> courses » for 60 € and « <prefix> maison » for 40 €. */
async function splitHundred(api: Api, prefix: string, categoryId: string | null = null) {
	const { account, id } = await hundred(api, prefix);
	const [food = "", home = ""] = await api.splitTransaction(id, [
		{ label: `${prefix} courses`, amount: "-60,00", categoryId },
		{ label: `${prefix} maison`, amount: "-40,00" },
	]);

	return {
		account,
		id,
		food,
		home,
		labels: { food: `${prefix} courses`, home: `${prefix} maison` },
	};
}

test("« Diviser » lists lines, counts what is left to split, and turns on at zero", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Hyper");
	const { account } = await hundred(api, prefix);
	const home = await api.createCategory({ name: uniqueName("Maison") });
	const patches = recorded(page, "PATCH");

	await page.goto(`/accounts/${account.id}`);
	await rowButton(page, prefix).click();
	await sheet(page).getByRole("button", { name: "Diviser" }).click();

	const dialog = splitDialog(page);
	const first = line(dialog, 1);
	await expect(dialog).toContainText(euros(-10_000));
	await expect(first.getByRole("textbox", { name: "Libellé de la ligne 1" })).toHaveValue(prefix);
	await expect(first.getByRole("textbox", { name: "Montant de la ligne 1" })).toHaveValue("");
	await expect(
		first.getByRole("button", { name: "Catégorie de la ligne 1 : Sans catégorie" }),
	).toBeVisible();
	// The first line cannot go: a split holds one line at least.
	await expect(first.getByRole("button", { name: /^Retirer/u })).toHaveCount(0);
	await expect(remaining(dialog)).toContainText("Reste à répartir");
	await expect(remaining(dialog).getByText(euros(-10_000))).toHaveClass(/text-destructive/u);
	await expect(remaining(dialog)).toContainText(
		"Les lignes doivent totaliser le montant de l'opération.",
	);
	await expect(dialog.getByRole("button", { name: "Diviser" })).toBeDisabled();

	await first.getByRole("textbox", { name: "Libellé de la ligne 1" }).fill(`${prefix} courses`);
	// Signed as Sure's: an expense is typed with its minus, and no toggle stands beside it.
	await expect(first.getByRole("group", { name: /^Sens/u })).toHaveCount(0);
	await first.getByRole("textbox", { name: "Montant de la ligne 1" }).fill("60");
	await expect(remaining(dialog).getByText(euros(-16_000))).toHaveClass(/text-destructive/u);
	await first.getByRole("textbox", { name: "Montant de la ligne 1" }).fill("-60");
	await expect(remaining(dialog).getByText(euros(-4000))).toHaveClass(/text-destructive/u);

	await dialog.getByRole("button", { name: "Ajouter une ligne" }).click();
	const second = line(dialog, 2);
	await second.getByRole("textbox", { name: "Libellé de la ligne 2" }).fill(`${prefix} maison`);
	await second.getByRole("textbox", { name: "Montant de la ligne 2" }).fill("-40");
	await second.getByRole("button", { name: "Catégorie de la ligne 2 : Sans catégorie" }).click();
	await page.getByRole("option", { name: home.name }).click();
	await expect(
		second.getByRole("button", { name: `Catégorie de la ligne 2 : ${home.name}` }),
	).toBeVisible();

	await expect(remaining(dialog).getByText(euros(0))).not.toHaveClass(/text-destructive/u);
	await expect(remaining(dialog)).not.toContainText("Les lignes doivent totaliser");
	await dialog.getByRole("button", { name: "Diviser" }).click();

	await expect(toast(page, "Opération divisée")).toBeVisible();
	expect(patches).toEqual([]);
	await expect(dialog).toBeHidden();
	await expect(sheet(page)).toBeHidden();
	await expect(rowButton(page, prefix).first()).toContainText("Divisée");
	await expect(linesOf(page, prefix).getByRole("listitem")).toHaveCount(2);
	await expect(linesOf(page, prefix).getByRole("listitem").nth(0)).toContainText(
		`${prefix} courses`,
	);
	await expect(linesOf(page, prefix).getByRole("listitem").nth(1)).toContainText(home.name);
	// Focus lands on the parent's row, the one the sheet was opened from.
	await expect(page.locator(":focus")).toContainText("Divisée");
});

test("a removed line leaves the counter, and only a splittable transaction offers « Diviser »", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Péage");
	const account = await api.openAccount({ name: uniqueName("Compte joint") });
	const savings = await api.openAccount({ name: uniqueName("Livret"), kind: "savings" });
	const amount = `${String(randomInt(100, 900))},${String(randomInt(10, 100))}`;
	const excluded = await api.addTransaction(account.id, {
		date: daysAgo(3),
		label: `${prefix} exclue`,
		amount: "-12,00",
	});
	await api.excludeTransaction(excluded);
	// The same amount out of one account and into another the same day:
	// proposed as a transfer on creation.
	await api.addTransaction(account.id, {
		date: daysAgo(4),
		label: `${prefix} virement`,
		amount: `-${amount}`,
	});
	await api.addTransaction(savings.id, { date: daysAgo(4), label: `${prefix} reçu`, amount });
	await splitHundred(api, `${prefix} divisée`);
	await api.addTransaction(account.id, {
		date: daysAgo(5),
		label: `${prefix} simple`,
		amount: "-8",
	});

	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
	await expect(rowButton(page, `${prefix} virement`)).toContainText("Correspondance automatique");

	// One sheet after the other: only one is ever open.
	await [`${prefix} exclue`, `${prefix} virement`, `${prefix} divisée courses`].reduce(
		async (previous, label) => {
			await previous;
			await rowButton(page, label).click();
			// A transfer side opens the transfer's drawer, which offers no « Diviser » either.
			const opened = page.getByRole("dialog");
			await expect(opened).toBeVisible();
			await expect(opened.getByRole("button", { name: "Diviser", exact: true })).toHaveCount(0);
			await page.keyboard.press("Escape");
			await expect(opened).toBeHidden();
		},
		Promise.resolve(),
	);

	await rowButton(page, `${prefix} simple`).click();
	// While the sheet holds an unsaved edit, « Diviser » waits.
	await sheet(page).getByLabel("Notes").fill("Ticket");
	await expect(sheet(page).getByRole("button", { name: "Diviser", exact: true })).toBeDisabled();
	await sheet(page).getByLabel("Notes").fill("");
	await sheet(page).getByRole("button", { name: "Diviser", exact: true }).click();
	const dialog = splitDialog(page);
	await dialog.getByRole("button", { name: "Ajouter une ligne" }).click();
	await line(dialog, 2).getByRole("textbox", { name: "Montant de la ligne 2" }).fill("-3");
	await expect(remaining(dialog)).toContainText(euros(-500));
	await line(dialog, 2).getByRole("button", { name: "Retirer la ligne 2" }).click();
	await expect(line(dialog, 2)).toHaveCount(0);
	await expect(remaining(dialog)).toContainText(euros(-800));

	// A line left without a label stops the split before it is sent.
	const posts = recorded(page, "POST");
	await line(dialog, 1).getByRole("textbox", { name: "Montant de la ligne 1" }).fill("-5");
	await dialog.getByRole("button", { name: "Ajouter une ligne" }).click();
	await line(dialog, 2).getByRole("textbox", { name: "Montant de la ligne 2" }).fill("-3");
	await expect(remaining(dialog).getByText(euros(0))).toBeVisible();
	await dialog.getByRole("button", { name: "Diviser" }).click();

	await expect(
		line(dialog, 2).getByRole("textbox", { name: "Libellé de la ligne 2" }),
	).toHaveAttribute("aria-invalid", "true");
	await expect(line(dialog, 2)).toContainText("Ce champ est obligatoire.");
	await expect(dialog).toBeVisible();
	expect(posts).toEqual([]);
});

test("a possible duplicate offers no « Diviser »", async ({ page, api }) => {
	const prefix = uniqueName("Doublon");
	const account = await api.openAccount({ name: uniqueName("Compte courant") });
	const amount = `-${String(randomInt(100, 900))},${String(randomInt(10, 100))}`;
	await api.addTransaction(account.id, { date: daysAgo(6), label: `${prefix} A`, amount });
	await api.addTransaction(account.id, { date: daysAgo(4), label: `${prefix} B`, amount });
	await api.importFile(
		account.id,
		sgml([{ daysAgo: 5, amount, label: `${prefix} import`, fitid: uniqueName("FIT") }]),
	);

	await page.goto(`/accounts/${account.id}`);
	await expect(rowButton(page, `${prefix} import`)).toContainText("Doublon possible");
	await rowButton(page, `${prefix} import`).click();

	await expect(sheet(page).getByRole("button", { name: "Fusionner avec…" })).toBeVisible();
	await expect(sheet(page).getByRole("button", { name: "Diviser", exact: true })).toHaveCount(0);
});

test("a pending transaction offers no « Diviser »", async ({ page, api }) => {
	const prefix = uniqueName("Attente");
	const account = await api.openAccount({ name: uniqueName("Compte courant") });
	await api.addTransaction(account.id, { date: daysAgo(1), label: prefix, amount: "-9,00" });
	// Only a bank sync raises the state; set on the list's answer here, so the
	// row needs no provider, as transaction-rows.spec.ts does.
	await page.route(
		(url) => url.pathname === "/api/transactions",
		async (route) => {
			const response = await route.fetch();
			const body = pendingListBody.parse(await response.json());
			const items = body.data.items.map((item) => ({ ...item, pending: item.label === prefix }));

			await route.fulfill({ response, json: { data: { ...body.data, items } } });
		},
	);

	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
	await expect(rowButton(page, prefix)).toContainText("En attente");
	await rowButton(page, prefix).click();

	await expect(sheet(page)).toBeVisible();
	await expect(sheet(page).getByRole("button", { name: "Diviser", exact: true })).toHaveCount(0);
});

test("a refusal from the API keeps the dialog open behind a toast", async ({ page, api }) => {
	const prefix = uniqueName("Hyper");
	const { account, id } = await hundred(api, prefix);
	const patches = recorded(page, "PATCH");

	await page.goto(`/accounts/${account.id}`);
	await rowButton(page, prefix).click();
	await sheet(page).getByRole("button", { name: "Diviser" }).click();
	const dialog = splitDialog(page);
	await line(dialog, 1).getByRole("textbox", { name: "Montant de la ligne 1" }).fill("-100");
	// Excluded meanwhile, as from another tab: no longer splittable.
	await api.excludeTransaction(id);
	await dialog.getByRole("button", { name: "Diviser" }).click();

	await expect(toast(page, "Cette opération ne peut pas être divisée")).toBeVisible();
	expect(patches).toEqual([]);
	await expect(dialog).toBeVisible();
	await expect(line(dialog, 1).getByRole("textbox", { name: "Montant de la ligne 1" })).toHaveValue(
		"-100",
	);
	// The sheet behind it stayed open: nothing saved it and closed it.
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(sheet(page)).toBeVisible();
});

test("the list shows a split's parent muted above its lines, and the filters, count and totals follow the lines", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Hyper");
	const food = await api.createCategory({ name: uniqueName("Courses") });
	const { account, labels } = await splitHundred(api, prefix, food.id);
	const above = `${prefix} avant`;
	await api.addTransaction(account.id, { date: daysAgo(1), label: above, amount: "-5" });

	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
	const parent = rowButton(page, prefix).nth(1);
	await expect(parent).toContainText("Divisée");
	await expect(parent.getByText(prefix, { exact: true })).toHaveClass(/text-muted-foreground/u);
	await expect(parent.getByText(euros(-10_000))).toHaveClass(/text-muted-foreground/u);
	// The parent is neither ticked nor categorised: its lines are.
	await expect(page.getByRole("checkbox", { name: `Sélectionner « ${prefix} »` })).toHaveCount(0);
	await expect(
		page.getByRole("checkbox", { name: `Sélectionner « ${labels.food} »` }),
	).toBeVisible();
	const chip = /^(Catégorie|Changer la catégorie)/u;
	await expect(parent.locator("..").getByRole("button", { name: chip })).toHaveCount(0);
	await expect(linesOf(page, prefix).getByRole("button", { name: chip })).toHaveCount(2);
	await expect(linesOf(page, prefix).getByRole("listitem")).toHaveCount(2);
	const [parentBox, lineBox] = await Promise.all([
		parent.boundingBox(),
		rowButton(page, labels.food).boundingBox(),
	]);
	expect(lineBox?.x ?? 0).toBeGreaterThan(parentBox?.x ?? 0);
	await expect(
		page.getByRole("main").getByRole("group", { name: "Opérations", exact: true }),
	).toContainText("3");

	// A Shift+click range runs over the rows as shown: the first line under
	// the parent is the oldest, the last the page lists of the day.
	const tick = (label: string) => page.getByRole("checkbox", { name: `Sélectionner « ${label} »` });
	await tick(above).click();
	await tick(labels.food).click({ modifiers: ["Shift"] });
	await expect(tick(above)).toBeChecked();
	await expect(tick(labels.food)).toBeChecked();
	await expect(tick(labels.home)).not.toBeChecked();

	await page.goto(`/transactions?category=${food.id}`);
	await expect(rowButton(page, labels.food)).toBeVisible();
	await expect(rowButton(page, prefix).first()).toContainText("Divisée");
	await expect(rowButton(page, labels.home)).toHaveCount(0);
	await expect(
		page.getByRole("main").getByRole("group", { name: "Opérations", exact: true }),
	).toContainText("1");
	await expect(
		page.getByRole("main").getByRole("group", { name: "Dépenses", exact: true }),
	).toContainText(euros(-6000));
});

test("a split cut by a page shows its parent on both pages", async ({ page, api }) => {
	const prefix = uniqueName("Coupée");
	const account = await api.openAccount({ openingDate: daysAgo(70) });
	const parent = await api.addTransaction(account.id, {
		date: daysAgo(50),
		label: prefix,
		amount: "-100,00",
	});
	await api.splitTransaction(parent, [
		{ label: `${prefix} première`, amount: "-60,00" },
		{ label: `${prefix} seconde`, amount: "-40,00" },
	]);
	// 49 newer rows: the newest line ends page 1, the other starts page 2.
	await api.addDailyTransactions(account.id, 49, uniqueName("Jour"));

	await page.goto(`/accounts/${account.id}`);
	await expect(linesOf(page, prefix).getByRole("listitem")).toHaveCount(1);
	await expect(linesOf(page, prefix)).toContainText(`${prefix} seconde`);

	await page.goto(`/accounts/${account.id}?page=2`);
	await expect(linesOf(page, prefix).getByRole("listitem")).toHaveCount(1);
	await expect(linesOf(page, prefix)).toContainText(`${prefix} première`);
	await expect(rowButton(page, prefix).first()).toContainText("Divisée");
});

test("a parent's sheet lists its lines, and « Modifier la division » keeps each line's tags", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Hyper");
	const { account, food, labels } = await splitHundred(api, prefix);
	const tag = await api.createTag();
	await api.setTags([food], [tag.id]);

	await page.goto(`/accounts/${account.id}`);
	await rowButton(page, prefix).first().click();

	const division = sheet(page).getByRole("region", { name: "Division" });
	await expect(division.getByRole("listitem")).toHaveCount(2);
	await expect(division.getByRole("listitem").nth(0)).toContainText(labels.food);
	await expect(division.getByRole("listitem").nth(0)).toContainText("Sans catégorie");
	await expect(division.getByRole("listitem").nth(0)).toContainText(euros(-6000));
	await expect(division.getByRole("listitem").nth(1)).toContainText(labels.home);
	await expect(sheet(page).getByRole("button", { name: "Diviser", exact: true })).toHaveCount(0);
	await expect(sheet(page).getByLabel("Date", { exact: true })).toBeDisabled();
	await expect(sheet(page).getByRole("textbox", { name: "Montant" })).toBeDisabled();
	await expect(sheet(page).getByLabel("Exclure des rapports")).toHaveCount(0);
	await expect(sheet(page).getByRole("region", { name: "Récurrence" })).toHaveCount(0);
	await expect(sheet(page).getByRole("region", { name: "Virement" })).toHaveCount(0);

	// Deleting the parent says its lines go with it.
	await sheet(page).getByRole("button", { name: "Supprimer" }).click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm).toContainText("les lignes de sa division seront supprimées");
	await confirm.getByRole("button", { name: "Annuler" }).click();

	await division.getByRole("button", { name: "Modifier la division" }).click();
	const dialog = splitDialog(page, "Modifier la division");
	await expect(remaining(dialog).getByText(euros(0))).toBeVisible();
	await expect(line(dialog, 1).getByRole("textbox", { name: "Libellé de la ligne 1" })).toHaveValue(
		labels.food,
	);
	await expect(line(dialog, 1).getByRole("textbox", { name: "Montant de la ligne 1" })).toHaveValue(
		"-60,00",
	);
	await line(dialog, 1).getByRole("textbox", { name: "Montant de la ligne 1" }).fill("-70");
	await expect(dialog.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
	await line(dialog, 2).getByRole("textbox", { name: "Montant de la ligne 2" }).fill("-30");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(toast(page, "Division modifiée")).toBeVisible();
	await expect(sheet(page)).toBeHidden();
	await expect(rowButton(page, labels.food)).toContainText(euros(-7000));
	await expect(rowButton(page, labels.food)).toContainText(tag.name);
	await expect(rowButton(page, labels.home)).toContainText(euros(-3000));
	await expect(page.locator(":focus")).toContainText("Divisée");
});

test("a line's sheet names its parent, keeps its label and category, and « Annuler la division » brings one row back", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Hyper");
	const { account, labels } = await splitHundred(api, prefix);

	await page.goto(`/accounts/${account.id}`);
	await rowButton(page, labels.food).click();

	const division = sheet(page).getByRole("region", { name: "Division" });
	await expect(division).toContainText(
		`Cette opération est une ligne de « ${prefix} » du ${formatShortDate(daysAgo(2))}, ${euros(-10_000)}.`,
	);
	await expect(sheet(page).getByLabel("Date", { exact: true })).toBeDisabled();
	await expect(sheet(page).getByRole("textbox", { name: "Montant" })).toBeDisabled();
	await expect(sheet(page).getByLabel("Marchand")).toBeDisabled();
	await expect(sheet(page).getByLabel("Exclure des rapports")).toHaveCount(0);
	await expect(sheet(page).getByRole("button", { name: "Supprimer" })).toHaveCount(0);
	// Sure's drawer disables a line's name and category: the split sets them.
	await expect(sheet(page).getByLabel("Libellé")).toBeDisabled();
	await expect(sheet(page).getByLabel("Catégorie")).toBeDisabled();
	await expect(sheet(page).getByLabel("Étiquettes")).toBeEnabled();
	await expect(sheet(page).getByLabel("Notes")).toBeEnabled();
	// A line offers no « Rapprocher un virement », as Sure's.
	await expect(sheet(page).getByRole("region", { name: "Virement" })).toHaveCount(0);

	// While the form holds an edit, the split's actions wait.
	await sheet(page).getByLabel("Notes").fill("Fruits et légumes");
	await expect(division.getByRole("button", { name: "Annuler la division" })).toBeDisabled();
	await sheet(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(sheet(page)).toBeHidden();
	await expect(rowButton(page, labels.food)).toContainText(euros(-6000));

	await rowButton(page, labels.food).click();
	await expect(sheet(page).getByLabel("Notes")).toHaveValue("Fruits et légumes");
	await division.getByRole("button", { name: "Annuler la division" }).click();
	const confirm = page.getByRole("alertdialog", { name: "Annuler la division ?" });
	await expect(confirm.getByRole("button", { name: "Garder la division" })).toBeFocused();
	await confirm.getByRole("button", { name: "Annuler la division" }).click();

	await expect(toast(page, "Division annulée")).toBeVisible();
	await expect(sheet(page)).toBeHidden();
	await expect(rowButton(page, prefix)).toHaveCount(1);
	await expect(rowButton(page, prefix)).not.toContainText("Divisée");
	await expect(rowButton(page, prefix)).toContainText(euros(-10_000));
	await expect(rowButton(page, prefix)).toBeFocused();
});

test("a split's lines may mix signs, as Sure's, when they sum to the transaction", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Remise");
	const { account } = await hundred(api, prefix);
	// A refund of its own, so no other test's row is its transfer candidate.
	const refund = randomInt(11, 99);

	await page.goto(`/accounts/${account.id}`);
	await rowButton(page, prefix).click();
	await sheet(page).getByRole("button", { name: "Diviser" }).click();
	const dialog = splitDialog(page);
	await line(dialog, 1)
		.getByRole("textbox", { name: "Montant de la ligne 1" })
		.fill(`-${String(100 + refund)}`);
	await dialog.getByRole("button", { name: "Ajouter une ligne" }).click();
	await line(dialog, 2)
		.getByRole("textbox", { name: "Libellé de la ligne 2" })
		.fill(`${prefix} bon`);
	await line(dialog, 2)
		.getByRole("textbox", { name: "Montant de la ligne 2" })
		.fill(String(refund));
	await expect(remaining(dialog).getByText(euros(0))).toBeVisible();
	await dialog.getByRole("button", { name: "Diviser" }).click();

	await expect(toast(page, "Opération divisée")).toBeVisible();
	await expect(linesOf(page, prefix).getByRole("listitem")).toHaveCount(2);
	await expect(linesOf(page, prefix).getByRole("listitem").nth(0)).toContainText(
		euros(-(100 + refund) * 100),
	);
	await expect(rowButton(page, `${prefix} bon`)).toContainText(euros(refund * 100));
});

test("« Grouper les opérations divisées » turned off lists each line as its own row, and back on groups them", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Groupe");
	const { labels } = await splitHundred(api, prefix);
	// The administrator's preference is shared by the whole run: set back after.
	await api.setSplitGrouped(true);

	try {
		await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
		await expect(rowButton(page, prefix).first()).toContainText("Divisée");
		await expect(linesOf(page, prefix).getByRole("listitem")).toHaveCount(2);

		await page.goto("/settings/preferences");
		const section = page.getByRole("region", { name: "Opérations" });
		await expect(section.getByText("Personnalisez l'affichage des opérations")).toBeVisible();
		const toggle = section.getByRole("switch", { name: "Grouper les opérations divisées" });
		await expect(toggle).toBeChecked();
		await toggle.click();
		await expect(page.getByText("Votre profil a été mis à jour.")).toBeVisible();
		await expect(toggle).not.toBeChecked();

		// Back through the app's history, not a reload: the saved preference
		// must refresh the list held in the cache.
		await page.goBack();
		await expect(rowButton(page, labels.food)).toBeVisible();
		await expect(rowButton(page, labels.home)).toBeVisible();
		await expect(page.getByRole("main").getByText("Divisée")).toHaveCount(0);
		await expect(linesOf(page, prefix)).toHaveCount(0);

		await page.goto("/settings/preferences");
		await toggle.click();
		await expect(toggle).toBeChecked();

		await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
		await expect(rowButton(page, prefix).first()).toContainText("Divisée");
		await expect(linesOf(page, prefix).getByRole("listitem")).toHaveCount(2);
	} finally {
		await api.setSplitGrouped(true);
	}
});

/** Minor units as the forms read them, `1234` as `12,34`. */
const amountText = (minor: number) =>
	`${String(Math.floor(minor / 100))},${String(minor % 100).padStart(2, "0")}`;

test("a split's line is matched as a transfer side, opens the transfer's drawer, and is offered to the other side's picker", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Épargne");
	const account = await api.openAccount({ name: uniqueName("Compte joint") });
	const savings = await api.openAccount({ name: uniqueName("Livret"), kind: "savings" });
	// An amount of its own, so no other test's row is a candidate.
	const moved = randomInt(10_000, 90_000);
	const parent = await api.addTransaction(account.id, {
		date: daysAgo(2),
		label: prefix,
		amount: "-1000,00",
	});
	const into = `${prefix} reçu`;
	await api.addTransaction(savings.id, {
		date: daysAgo(0),
		label: into,
		amount: amountText(moved),
	});
	const moving = `${prefix} virement`;
	await api.splitTransaction(parent, [
		{ label: moving, amount: `-${amountText(moved)}` },
		{ label: `${prefix} reste`, amount: `-${amountText(100_000 - moved)}` },
	]);

	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
	await expect(rowButton(page, moving)).toContainText("Correspondance automatique");
	await rowButton(page, moving).click();
	const drawer = page.getByRole("dialog", { name: `Virement vers ${savings.name}` });
	await expect(drawer.getByRole("link", { name: account.name })).toBeVisible();
	await drawer.getByText("Paramètres", { exact: true }).click();
	await drawer.getByRole("button", { name: "Supprimer le virement" }).click();
	await page
		.getByRole("alertdialog", { name: "Voulez-vous vraiment supprimer ce virement ?" })
		.getByRole("button", { name: "Supprimer le virement" })
		.click();
	await expect(toast(page, "Virement supprimé")).toBeVisible();
	await expect(drawer).toBeHidden();

	await rowButton(page, into).click();
	await sheet(page).getByRole("button", { name: "Rapprocher un virement" }).click();
	const candidates = page
		.getByRole("dialog", { name: "Rapprocher un virement" })
		.getByRole("list", { name: "Opérations candidates" });
	await expect(candidates.getByRole("listitem")).toHaveCount(1);
	await expect(candidates.getByRole("listitem")).toContainText(moving);
});

test.describe("on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	// The fixed bottom navigation once covered the row Tab had just scrolled
	// to the window's foot: a tap there reached the navigation, not the row.
	test("Tab keeps each row above the bottom navigation, and the sheet's « Diviser » takes a click", async ({
		page,
		api,
	}) => {
		const prefix = uniqueName("Marché");
		const account = await api.openAccount({ name: uniqueName("Compte joint") });
		const labels = ["a", "b", "c", "d", "e", "f", "g", "h"].map((suffix) => `${prefix} ${suffix}`);

		await labels.reduce(async (previous, label, index) => {
			await previous;
			await api.addTransaction(account.id, { date: daysAgo(index + 2), label, amount: "-12,00" });
		}, Promise.resolve());

		await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
		await expect(rowButton(page, labels.at(-1) ?? "")).toHaveCount(1);
		await page.getByRole("searchbox", { name: "Rechercher" }).focus();

		// The focused row, and whether the bottom navigation covers any of it.
		const focusedRow = () =>
			page.evaluate(() => {
				const row = document.activeElement;
				const nav = [...document.querySelectorAll('nav[aria-label="Navigation principale"]')].find(
					(candidate) => candidate.getBoundingClientRect().height > 0,
				);

				if (
					!(row instanceof HTMLElement) ||
					!row.matches("button[data-transaction-id]") ||
					nav === undefined
				) {
					return null;
				}

				return {
					label: row.textContent,
					covered: row.getBoundingClientRect().bottom > nav.getBoundingClientRect().top,
				};
			});

		/** Tabs row by row up to the last one, naming each row the navigation covered. */
		async function tabToLast(steps: number, covered: string[]): Promise<string[] | null> {
			if (steps === 0) {
				return null;
			}

			await page.keyboard.press("Tab");
			const row = await focusedRow();
			const now = row?.covered === true ? [...covered, row.label ?? ""] : covered;

			return row?.label?.includes(labels.at(-1) ?? "") === true ? now : tabToLast(steps - 1, now);
		}

		const covered = await tabToLast(80, []);

		expect(covered).toEqual([]);

		await page.keyboard.press("Enter");
		await sheet(page).getByRole("button", { name: "Diviser", exact: true }).click();
		await expect(splitDialog(page)).toBeVisible();
	});
});
