import type { Locator, Page } from "@playwright/test";

import { z } from "zod";

import { daysAgo, expect, rgb, test, uniqueName } from "./fixtures.ts";
import { WEB_URL } from "./settings.ts";

// Story 14.4: the remaining screens at Sure's proportions. Each list is a
// card holding inset groups, every empty state is a card, the banners are
// Sure's alerts, the badges 22 px, and nothing drops under the floor: 12 px
// text, 28 px controls.

test.use({ viewport: { width: 1440, height: 900 } });

const pageHeader = (page: Page) => page.locator('[data-slot="page-header"]');

/**
 * An inset group inside its list card: a grey tray with 12 px corners under
 * an uppercase `h2`, in a white card with 16 px of padding.
 */
async function expectListGroup(page: Page, name: string): Promise<Locator> {
	const group = page.getByRole("region", { name, exact: true });

	await expect(group).toHaveAttribute("data-slot", "inset-group");
	await expect(group).toHaveCSS("background-color", rgb("#f2f2f3"));
	await expect(group).toHaveCSS("border-radius", "12px");
	await expect(group.getByRole("heading", { level: 2, name, exact: true })).toHaveCSS(
		"text-transform",
		"uppercase",
	);

	const card = page.locator('[data-slot="list-card"]').filter({ has: group });
	await expect(card).toHaveCount(1);
	await expect(card).toHaveCSS("background-color", rgb("#ffffff"));
	await expect(card).toHaveCSS("border-radius", "12px");
	await expect(card).toHaveCSS("border-top-width", "1px");
	await expect(card).toHaveCSS("padding-top", "16px");

	return group;
}

/** A group's header: its heading, then « · » and the count of its rows. */
const groupHeader = (group: Locator) => group.locator(":scope > div").first();

async function expectRowAtLeast56(row: Locator) {
	const box = await row.boundingBox();

	expect(box?.height).toBeGreaterThanOrEqual(56);
}

test("recurring: the introduction heads the page, and the series sit in a table on a tray", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(5) });
	const label = uniqueName("Abonnement");
	await api.addRecurring(
		await api.addTransaction(account.id, { date: daysAgo(1), label, amount: "-9,99" }),
	);

	await page.goto("/recurring");

	await expect(pageHeader(page)).toContainText("Les abonnements et factures qui reviennent");
	const group = await expectListGroup(page, "Toutes les récurrences");
	const table = group.getByRole("table", { name: "Récurrences" });
	await expect(table.getByRole("columnheader", { name: "Prochaine échéance" })).toHaveCSS(
		"text-transform",
		"uppercase",
	);
	await expect(table.getByRole("columnheader").first()).toHaveCSS("font-size", "12px");

	const row = table.getByRole("row").filter({ hasText: label });
	await expectRowAtLeast56(row);
	await expect(row.locator('[data-slot="tinted-icon"]').first()).toHaveCSS("width", "28px");
	await expect(row.locator('[data-slot="tinted-icon"]').nth(1)).toHaveCSS("width", "20px");
	await expect(row.locator('[data-slot="status-badge"]').first()).toHaveCSS("height", "22px");
});

test.describe("rules", () => {
	test.afterEach(async ({ api }) => {
		await api.deleteRules();
	});

	test("the rules and their runs each sit on a tray, the introduction in the page header", async ({
		page,
		api,
	}) => {
		const category = await api.createCategory();
		const name = uniqueName("Règle");
		await api.createRule({
			name,
			conditions: [{ conditionType: "transaction_name", operator: "like", value: name }],
			actions: [{ actionType: "set_transaction_category", value: category.id }],
		});

		await page.goto("/rules");

		await expect(pageHeader(page)).toContainText("Une règle complète les nouvelles opérations");
		const rules = await expectListGroup(page, "Ordre d'application");
		await expectRowAtLeast56(
			rules.getByRole("list", { name: "Règles" }).getByRole("listitem").filter({ hasText: name }),
		);
		await expectListGroup(page, "Exécutions récentes");

		// The rule form is 700 px wide.
		await pageHeader(page).getByRole("button", { name: "Ajouter une règle" }).click();
		const dialog = page.getByRole("dialog", { name: "Ajouter une règle" });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveCSS("width", "700px");
	});
});

test("categories: one card, a tray per kind, each row at least 56 px", async ({ page, api }) => {
	const category = await api.createCategory({ kind: "expense" });

	await page.goto("/settings/categories");

	const income = await expectListGroup(page, "Revenus");
	const expenses = await expectListGroup(page, "Dépenses");
	// Each header counts its own kind, children included.
	const listed = await page.request.get("/api/categories");
	const { data } = z
		.object({ data: z.array(z.object({ kind: z.string() })) })
		.parse(await listed.json());
	const count = (kind: string) => data.filter((item) => item.kind === kind).length;
	await expect(groupHeader(income)).toHaveText(`Revenus·${count("income")}`);
	await expect(groupHeader(expenses)).toHaveText(`Dépenses·${count("expense")}`);
	await expectRowAtLeast56(
		expenses
			.getByRole("button", { name: `Actions pour ${category.name}`, exact: true })
			.locator(".."),
	);

	await pageHeader(page).getByRole("button", { name: "Ajouter une catégorie" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter une catégorie" });
	await expect(dialog).toHaveCSS("width", "550px");
	expect(await floorViolations(page)).toEqual([]);
});

test("a simple list counts its rows in its header", async ({ page }) => {
	await page.route("**/api/tags", (route) =>
		route.request().method() === "GET"
			? route.fulfill({
					json: {
						data: ["Travaux", "Vacances", "Voiture"].map((name, index) => ({
							id: `00000000-0000-4000-8000-00000000000${index}`,
							name,
							transactionCount: index,
						})),
					},
				})
			: route.fallback(),
	);

	await page.goto("/settings/tags");

	const tags = await expectListGroup(page, "Toutes les étiquettes");
	await expect(groupHeader(tags)).toHaveText("Toutes les étiquettes·3");
	await expect(tags.getByRole("listitem")).toHaveCount(3);
});

test("merchants and tags: the add button heads the page at 36 px, the list sits on a tray", async ({
	page,
	api,
}) => {
	const merchant = await api.createMerchant();
	const tag = await api.createTag();

	await page.goto("/settings/merchants");
	await expect(pageHeader(page).getByRole("button", { name: "Ajouter un marchand" })).toHaveCSS(
		"height",
		"36px",
	);
	const merchants = await expectListGroup(page, "Tous les marchands");
	await expectRowAtLeast56(
		merchants
			.getByRole("button", { name: `Actions pour ${merchant.name}`, exact: true })
			.locator(".."),
	);
	await pageHeader(page).getByRole("button", { name: "Ajouter un marchand" }).click();
	const merchantDialog = page.getByRole("dialog", { name: "Ajouter un marchand" });
	await expect(merchantDialog).toHaveCSS("width", "550px");
	expect(await floorViolations(page)).toEqual([]);

	await page.goto("/settings/tags");
	const add = pageHeader(page).getByRole("button", { name: "Ajouter une étiquette" });
	await expect(add).toHaveCSS("height", "36px");
	const tags = await expectListGroup(page, "Toutes les étiquettes");
	await expectRowAtLeast56(
		tags.getByRole("button", { name: `Actions pour ${tag.name}`, exact: true }).locator(".."),
	);

	// Creation and edit forms are 550 px wide, a confirmation 300 px.
	await add.click();
	const create = page.getByRole("dialog", { name: "Ajouter une étiquette" });
	await expect(create).toBeVisible();
	await expect(create).toHaveCSS("width", "550px");
	await create.getByRole("button", { name: "Annuler" }).click();
	await expect(create).toBeHidden();

	await tags.getByRole("button", { name: `Actions pour ${tag.name}`, exact: true }).click();
	await page.getByRole("menuitem", { name: "Renommer" }).click();
	const rename = page.getByRole("dialog", { name: /^Renommer/u });
	await expect(rename).toBeVisible();
	await expect(rename).toHaveCSS("width", "550px");
	await rename.getByRole("button", { name: "Annuler" }).click();
	await expect(rename).toBeHidden();

	await tags.getByRole("button", { name: `Actions pour ${tag.name}`, exact: true }).click();
	await page.getByRole("menuitem", { name: "Supprimer" }).click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm).toBeVisible();
	await expect(confirm).toHaveCSS("width", "300px");
});

test("the import dialog is 700 px wide", async ({ page, api }) => {
	const account = await api.openAccount();

	await page.goto(`/accounts/${account.id}`);
	await page.getByRole("button", { name: "Importer", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Importer un fichier" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveCSS("width", "700px");
});

test("security: the forms fill the 896 px column, their buttons at their content's width", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/settings/security");

	const widths = await Promise.all(
		["Profil", "Mot de passe", "Double authentification"].map(
			async (name) => (await page.getByRole("region", { name, exact: true }).boundingBox())?.width,
		),
	);
	expect(widths).toEqual([896, 896, 896]);

	// Every submit button at its content's width, well short of the column.
	const submits = page.getByRole("main").locator('button[type="submit"]');
	await expect(submits).toHaveCount(3);
	const buttonWidths = await submits.evaluateAll((buttons) =>
		buttons.map((button) => button.getBoundingClientRect().width),
	);
	expect(buttonWidths.every((width) => width > 0 && width < 300)).toBe(true);
});

// Every list emptied as the API would answer it: the shared database holds
// other tests' rows.
const EMPTY_LISTS = [
	{ path: "/recurring", api: "/api/recurring", heading: "Aucune récurrence pour l'instant" },
	{ path: "/rules", api: "/api/rules", heading: "Aucune règle pour l'instant" },
	{
		path: "/settings/merchants",
		api: "/api/merchants",
		heading: "Aucun marchand pour l'instant",
	},
	{ path: "/settings/tags", api: "/api/tags", heading: "Aucune étiquette pour l'instant" },
] as const;

for (const list of EMPTY_LISTS) {
	test(`${list.path}: the empty state is a card of its own, with a 36 px icon and one primary button`, async ({
		page,
	}) => {
		await page.route(`**${list.api}`, (route) =>
			route.request().method() === "GET" ? route.fulfill({ json: { data: [] } }) : route.fallback(),
		);

		await page.goto(list.path);

		const empty = page.locator('[data-slot="empty-state"]');
		// The page's own `h2`: nothing sits between it and the `h1`.
		await expect(empty.getByRole("heading", { level: 2, name: list.heading })).toHaveCSS(
			"font-size",
			"16px",
		);
		await expect(empty).toHaveCSS("background-color", rgb("#ffffff"));
		await expect(empty).toHaveCSS("border-radius", "12px");
		await expect(empty).toHaveCSS("border-top-width", "1px");
		await expect(empty.locator('[data-slot="tinted-icon"]')).toHaveCSS("width", "36px");
		await expect(empty.getByRole("button")).toHaveCount(1);
		await expect(empty.getByRole("button")).toHaveCSS("background-color", rgb("#5e6ad2"));
		// No other card around it.
		await expect(
			empty.locator('xpath=ancestor::*[@data-slot="list-card" or @data-slot="section"]'),
		).toHaveCount(0);
	});
}

/** An empty state inside its group's white block: the block frames it, so it has no border or corner. */
async function expectFlush(group: Locator, heading: string) {
	const empty = group.locator('[data-slot="empty-state"]');
	await expect(empty.getByRole("heading", { level: 3, name: heading })).toBeVisible();
	await expect(empty).toHaveCSS("border-top-width", "0px");
	await expect(empty).toHaveCSS("border-radius", "0px");
	await expect(empty.locator('[data-slot="tinted-icon"]')).toHaveCSS("width", "36px");
	await expect(empty.getByRole("button")).toHaveCount(1);
}

test("inside a group's white block, the empty states of banks and categories drop their frame", async ({
	page,
}) => {
	await Promise.all(
		["/api/bank-connections", "/api/categories"].map((path) =>
			page.route(`**${path}`, (route) =>
				route.request().method() === "GET"
					? route.fulfill({ json: { data: [] } })
					: route.fallback(),
			),
		),
	);

	await page.goto("/settings/banks");
	await expectFlush(
		await expectListGroup(page, "Banques connectées"),
		"Aucune banque connectée pour l'instant",
	);

	await page.goto("/settings/categories");
	await expectFlush(await expectListGroup(page, "Revenus"), "Aucune catégorie de revenus");
	await expectFlush(await expectListGroup(page, "Dépenses"), "Aucune catégorie de dépenses");
});

test("the transactions page says it is empty inside its list card, with no frame of its own", async ({
	page,
}) => {
	const empty = {
		data: {
			items: [],
			page: 1,
			pageSize: 50,
			total: 0,
			sum: { amount: 0, income: 0, expense: 0, currency: "EUR", skippedCount: 0 },
		},
	};
	await page.route("**/api/transactions?*", (route) => route.fulfill({ json: empty }));
	const card = page.locator('[data-slot="list-card"]');

	await page.goto("/transactions");
	const note = card.locator('[data-slot="empty-note"]');
	await expect(note).toHaveText("Aucune opération.");
	await expect(note).toHaveCSS("border-top-width", "0px");

	await page.goto("/transactions?q=introuvable");
	const noMatch = card.locator('[data-slot="empty-note"]');
	await expect(noMatch).toContainText("Aucune opération ne correspond à ces filtres.");
	await expect(noMatch.getByRole("button", { name: "Effacer les filtres" })).toBeVisible();
	await expect(noMatch).toHaveCSS("border-top-width", "0px");
	await expect(page.locator(".border-dashed")).toHaveCount(0);
});

test("an account's empty tabs: a card with the way forward, or a card with its sentence", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	await page.goto(`/accounts/${account.id}`);

	const empty = page
		.getByRole("tabpanel", { name: "Opérations" })
		.locator('[data-slot="empty-state"]');
	await expect(
		empty.getByRole("heading", { name: "Aucune opération pour l'instant" }),
	).toBeVisible();
	await expect(empty).toHaveCSS("border-radius", "12px");
	await expect(empty.locator('[data-slot="tinted-icon"]')).toHaveCSS("width", "36px");
	await expect(empty.getByRole("button", { name: "Ajouter une opération" })).toBeVisible();

	await page.getByRole("tab", { name: "Imports" }).click();
	const note = page.getByRole("tabpanel", { name: "Imports" }).locator('[data-slot="empty-note"]');
	await expect(note).toHaveText("Aucun import.");
	await expect(note).toHaveCSS("background-color", rgb("#ffffff"));
	await expect(note).toHaveCSS("border-top-style", "solid");
	await expect(note).toHaveCSS("color", rgb("#6c6b73"));
	await expect(page.locator(".border-dashed")).toHaveCount(0);
});

const CONNECTION_ID = "0d9c5d0e-3f55-4d5c-9e0a-7a1b1a2b3c4d";

/** One connection whose consent ends soon, on a locked setup, with one bank account to set up. */
async function mockConnection(page: Page) {
	await page.route("**/api/bank-connections/setup", (route) =>
		route.fulfill({
			json: {
				data: {
					available: true,
					source: "interface",
					applicationId: "app-bloquee",
					redirectUrl: `${WEB_URL}/settings/banks/callback`,
					locked: true,
					missing: [],
				},
			},
		}),
	);
	await page.route("**/api/bank-connections", (route) =>
		route.request().method() === "GET"
			? route.fulfill({
					json: {
						data: [
							{
								id: CONNECTION_ID,
								connector: "enable_banking",
								institutionName: "Banque Maquette",
								country: "FR",
								status: "active",
								consentExpiresAt: Date.now() + 3 * 86_400_000,
								lastSyncedAt: Date.now() - 3_600_000,
								lastError: null,
								syncing: false,
								alert: "consent_expiring",
								createdAt: Date.now() - 86_400_000,
							},
						],
					},
				})
			: route.fallback(),
	);
	await page.route(`**/api/bank-connections/${CONNECTION_ID}/accounts`, (route) =>
		route.request().method() === "GET"
			? route.fulfill({
					json: {
						data: [
							{
								id: "5b0c3a1e-6c1f-4a8e-9b0d-1c2d3e4f5a6b",
								name: "Compte maquette",
								ibanLast4: "1234",
								currency: "EUR",
								suggestion: { type: "depository", subtype: "checking" },
								account: null,
								candidates: [],
							},
						],
					},
				})
			: route.fallback(),
	);
}

test("banks: the banner and the locked notice are Sure's alerts, the badge 22 px, the lists on trays", async ({
	page,
}) => {
	await mockConnection(page);
	await page.goto("/settings/banks");

	const banner = page
		.getByRole("region", { name: "Avertissements bancaires" })
		.locator("div")
		.filter({ hasText: "Banque Maquette" })
		.first();
	await expect(banner).toHaveCSS("border-radius", "8px");
	await expect(banner).toHaveCSS("border-top-width", "1px");
	await expect(banner).toHaveCSS("padding", "12px 16px");
	await expect(banner).toHaveCSS("font-size", "14px");
	await expect(banner.locator("svg").first()).toHaveCSS("width", "16px");

	const notice = page.getByRole("status").filter({ hasText: "Configuration verrouillée" });
	await expect(notice).toHaveCSS("border-radius", "8px");
	await expect(notice).toHaveCSS("padding", "12px 16px");
	await expect(notice).toHaveCSS("font-size", "14px");
	await expect(notice.locator("svg")).toHaveCSS("width", "16px");

	const connections = await expectListGroup(page, "Banques connectées");
	const row = connections.getByRole("link", { name: "Gérer les comptes de Banque Maquette" });
	await expectRowAtLeast56(row);
	const badge = row.locator('[data-slot="status-badge"]');
	await expect(badge).toHaveCSS("height", "22px");
	await expect(badge).toHaveCSS("border-radius", "6px");
	await expect(badge).toHaveCSS("font-size", "12px");
	await expect(badge.locator("svg")).toHaveCSS("width", "12px");

	await row.click();
	await expect(page.getByRole("heading", { level: 1, name: "Banque Maquette" })).toBeVisible();
	const accounts = await expectListGroup(page, "Comptes de la banque");
	const account = accounts.getByRole("listitem").filter({ hasText: "Compte maquette" });
	await expectRowAtLeast56(account);
	// DESIGN.md's `code`: the IBAN's mask in 12 px Geist Mono.
	const iban = account.locator("code");
	await expect(iban).toHaveText("•••• 1234");
	await expect(iban).toHaveCSS("font-size", "12px");
	await expect(iban).toHaveCSS("font-family", /Geist Mono/u);
});

/**
 * What the floor forbids on the current page: text under 12 px outside the
 * rail, a heading under 14 px other than an uppercase group header, a row's
 * label under 14 px, and a button, field, select trigger or tab under 28 px
 * high. Checkboxes, switches and radios keep their size behind a 24 px target.
 * Runs in the page, so it holds no helper of its own.
 */
function scanFloor(): string[] {
	const rail = document.querySelector('nav[aria-label="Navigation principale"]');
	const checks: {
		element: Element | undefined;
		kind: "text" | "rail" | "heading" | "row" | "control";
	}[] = [];

	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if ((node.textContent ?? "").trim() !== "" && node.parentElement !== null) {
			const inRail = rail?.contains(node.parentElement) ?? false;
			// The rail's labels are the one text at 11 px, under each destination.
			if (!inRail) {
				checks.push({ element: node.parentElement, kind: "text" });
			} else if (node.parentElement.closest("a") !== null) {
				checks.push({ element: node.parentElement, kind: "rail" });
			}
		}
	}

	for (const heading of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
		checks.push({ element: heading, kind: "heading" });
	}

	// A row's label is the first text it shows.
	for (const row of document.querySelectorAll(
		'[data-slot="inset-group"] li, [data-slot="inset-group"] tbody tr',
	)) {
		const texts: Element[] = [];
		const rowWalker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
		for (let node = rowWalker.nextNode(); node !== null; node = rowWalker.nextNode()) {
			if ((node.textContent ?? "").trim() !== "" && node.parentElement !== null) {
				texts.push(node.parentElement);
			}
		}
		checks.push({
			element: texts.find(
				(text) =>
					text.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
					text.closest('[aria-hidden="true"]') === null,
			),
			kind: "row",
		});
	}

	for (const control of document.querySelectorAll(
		'button, [data-slot="button"], input, select, textarea, [role="combobox"], [role="tab"]',
	)) {
		if (
			!["checkbox", "switch", "radio"].includes(control.getAttribute("role") ?? "") &&
			!["checkbox", "radio", "hidden"].includes(control.getAttribute("type") ?? "")
		) {
			checks.push({ element: control, kind: "control" });
		}
	}

	const found: string[] = [];

	for (const { element, kind } of checks) {
		const box = element?.getBoundingClientRect();

		if (
			element === undefined ||
			box === undefined ||
			!element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ||
			element.closest('[aria-hidden="true"]') !== null ||
			box.width <= 1 ||
			box.height <= 1
		) {
			continue;
		}

		const style = getComputedStyle(element);
		const size = Number.parseFloat(style.fontSize);
		const name = `${element.tagName.toLowerCase()} « ${(element.textContent ?? "").trim().slice(0, 40)} »`;

		// 12 px is for captions and uppercase headers, 14 px and up for the rest:
		// a size between them, such as shadcn's 12.8 px, is neither.
		if (kind === "text" && (size < 12 || (size > 12 && size < 14))) {
			found.push(`text at ${size} px: ${name}`);
		} else if (kind === "rail" && size !== 11) {
			found.push(`rail label at ${size} px: ${name}`);
		} else if (kind === "heading" && style.textTransform !== "uppercase" && size < 14) {
			found.push(`heading at ${size} px: ${name}`);
		} else if (kind === "row" && size < 14) {
			found.push(`row label at ${size} px: ${name}`);
		} else if (kind === "control" && box.height < 27.5) {
			found.push(`control ${Math.round(box.height)} px high: ${name}`);
		}
	}

	return found;
}

const floorViolations = (page: Page) => page.evaluate(scanFloor);

test("no signed-in screen drops text under 12 px or a control under 28 px", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(40) });
	const label = uniqueName("Plancher");
	await api.addRecurring(
		await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-12,00" }),
	);
	await api.createMerchant();
	await api.createTag();

	const screens = [
		"/",
		"/transactions",
		"/accounts",
		`/accounts/${account.id}`,
		"/recurring",
		"/rules",
		"/settings/categories",
		"/settings/merchants",
		"/settings/tags",
		"/settings/banks",
		"/settings/security",
	];

	// One screen after the other, every violation kept, so a failure names them all.
	const violations = await screens.reduce<Promise<string[]>>(async (previous, path) => {
		const found = await previous;
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		// Every query answered: no skeleton left standing in for a row.
		await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);

		return [...found, ...(await floorViolations(page)).map((violation) => `${path}: ${violation}`)];
	}, Promise.resolve([]));

	expect(violations).toEqual([]);
});

test("an account's tabs, the creation and import dialogs, the bank picker and a bank's page keep the floor", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(40) });
	const found: string[] = [];
	const scan = async (where: string) => {
		// A dialog's opening zoom scales its controls until it ends.
		await page.waitForFunction(() =>
			document.getAnimations().every((animation) => animation.playState !== "running"),
		);
		found.push(...(await floorViolations(page)).map((violation) => `${where}: ${violation}`));
	};

	await page.goto(`/accounts/${account.id}`);
	await page.getByRole("tab", { name: "Soldes" }).click();
	await expect(page.getByRole("tabpanel", { name: "Soldes" })).toBeVisible();
	await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
	await scan("Soldes");
	await page.getByRole("tab", { name: "Imports" }).click();
	await expect(page.getByRole("tabpanel", { name: "Imports" })).toBeVisible();
	await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
	await scan("Imports");

	await page.getByRole("button", { name: "Importer", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Importer un fichier" })).toBeVisible();
	await scan("import dialog");

	await page.goto("/accounts");
	await pageHeader(page).getByRole("button", { name: "Ajouter un compte" }).click();
	const create = page.getByRole("dialog", { name: "Ajouter un compte" });
	await expect(create).toHaveCSS("width", "550px");
	await scan("account creation dialog");

	await page.goto("/settings/banks");
	await page
		.getByRole("region", { name: "Connecter une banque" })
		.getByRole("button", { name: "Choisir une banque" })
		.click();
	const picker = page.getByRole("dialog", { name: "Choisir une banque" });
	await expect(picker.getByRole("list", { name: "Banques disponibles" })).toBeVisible();
	await expect(picker.locator('[data-slot="input-group"]')).toHaveCSS("height", "36px");
	await scan("bank picker");

	await mockConnection(page);
	await page.goto(`/settings/banks/${CONNECTION_ID}`);
	await expect(page.getByRole("list", { name: "Comptes de la banque" })).toBeVisible();
	await scan("a bank's page");

	expect(found).toEqual([]);
});

test("a small button and a small toggle set their label at 14 px", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });
	// 51 rows: one more than a page, so the pagination shows.
	await api.addDailyTransactions(account.id, 51, uniqueName("Page"));

	await page.goto(`/accounts/${account.id}`);

	const next = page
		.getByRole("navigation", { name: "Pages des opérations" })
		.getByRole("link", { name: "Suivant" });
	await expect(next).toHaveAttribute("data-size", "sm");
	await expect(next).toHaveCSS("font-size", "14px");
	await expect(next).toHaveCSS("height", "28px");

	const period = page.getByRole("radiogroup", { name: "Période" }).getByRole("radio").first();
	await expect(period).toHaveCSS("font-size", "14px");
	await expect(period).toHaveCSS("height", "28px");
});

test.describe("outside the shell", () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test("sign-in, setup and the root error title their card at 24 px and keep the floor", async ({
		page,
	}) => {
		await page.goto("/sign-in");
		await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toHaveCSS(
			"font-size",
			"24px",
		);
		expect(await floorViolations(page), "/sign-in").toEqual([]);

		await page.route("**/api/setup", (route) =>
			route.request().method() === "GET"
				? route.fulfill({ json: { data: { open: true } } })
				: route.continue(),
		);
		await page.goto("/setup");
		await expect(
			page.getByRole("heading", { level: 1, name: "Créer le compte administrateur" }),
		).toHaveCSS("font-size", "24px");
		expect(await floorViolations(page), "/setup").toEqual([]);

		await page.unrouteAll();
		await page.route("**/api/setup", (route) =>
			route.fulfill({
				status: 500,
				json: { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			}),
		);
		await page.goto("/");
		await expect(
			page.getByRole("heading", { level: 1, name: "Une erreur est survenue" }),
		).toHaveCSS("font-size", "24px");
		expect(await floorViolations(page), "root error").toEqual([]);
	});
});
