import type { Page } from "@playwright/test";

import { randomUUID } from "node:crypto";

import { createDb } from "@archant/data/client";

import { FAILING_BANK, FAKE_ACCOUNTS, FAKE_BANKS, FAKE_LINES } from "./fake-enable-banking.ts";
import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";
import { DATABASE_FILE, TIME_ZONE } from "./settings.ts";

// Stories 10.1 to 10.3: connecting a bank from « Réglages > Banques »,
// deciding what each of its accounts becomes, then syncing them, against the
// fake Enable Banking that e2e/start-api.ts starts on loopback.

const PAGE = "/settings/banks";

const banks = (page: Page) => page.getByRole("list", { name: "Banques disponibles" });

const toast = (page: Page, text: string | RegExp) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

const longDate = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: TIME_ZONE,
});

async function visit(page: Page) {
	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 2, name: "Banques" })).toBeVisible();
}

test("France is selected and its banks are listed, filtered by the search", async ({ page }) => {
	await visit(page);

	await expect(page.getByRole("combobox", { name: "Pays" })).toHaveText("France");
	await Promise.all(
		FAKE_BANKS.map((name) =>
			expect(banks(page).getByRole("button", { name: `Connecter ${name}` })).toBeVisible(),
		),
	);
	await expect(banks(page).getByRole("button")).toHaveCount(FAKE_BANKS.length);

	// Accents and case ignored, as the user types.
	await page.getByLabel("Rechercher une banque").fill("neobanque");
	await expect(banks(page).getByRole("button")).toHaveCount(1);
	await expect(banks(page).getByRole("button", { name: "Connecter Néobanque Test" })).toBeVisible();

	// The BIC matches too.
	await page.getByLabel("Rechercher une banque").fill("demofrpp");
	await expect(banks(page).getByRole("button")).toHaveCount(1);
	await expect(banks(page).getByRole("button", { name: "Connecter Banque Démo" })).toBeVisible();

	await page.getByLabel("Rechercher une banque").fill("introuvable");
	await expect(page.getByText("Aucune banque ne correspond à cette recherche.")).toBeVisible();
});

test("another country lists its own banks", async ({ page }) => {
	await visit(page);

	await page.getByRole("combobox", { name: "Pays" }).click();
	await page.getByRole("option", { name: "Belgique" }).click();

	await expect(banks(page).getByRole("button", { name: "Connecter Banque BE" })).toBeVisible();
	await expect(banks(page).getByRole("button")).toHaveCount(1);
});

const CONNECTION_URL = /\/settings\/banks\/([0-9a-f-]{36})$/u;

/** Connects `bank`, Banque Démo by default, and returns once its page is open, with its id. */
async function connect(page: Page, bank = "Banque Démo"): Promise<string> {
	await visit(page);
	await banks(page)
		.getByRole("button", { name: `Connecter ${bank}` })
		.click();

	// The fake bank approves at once and sends the browser back through the
	// return page, which posts the code and lands on the connection's page.
	await expect(toast(page, `${bank} est connectée.`)).toBeVisible();
	await expect(page).toHaveURL(CONNECTION_URL);
	await expect(page.getByRole("heading", { level: 2, name: bank })).toBeVisible();

	return CONNECTION_URL.exec(page.url())?.[1] ?? "";
}

const bankAccountRows = (page: Page) => page.getByRole("list", { name: "Comptes de la banque" });

const choice = (page: Page, name: string) =>
	page.getByRole("combobox", { name: `Que faire de ${name}` });

async function choose(page: Page, name: string, option: string) {
	await choice(page, name).click();
	await page.getByRole("option", { name: option, exact: true }).click();
}

const validate = (page: Page) => page.getByRole("button", { name: "Valider" });

/** The sidebar's link to an account, which carries its balance. */
const sidebarAccount = (page: Page, accountId: string) =>
	page.locator(`[data-sidebar="menu-button"][href="/accounts/${accountId}"]`);

/** The id of the account a bank account's row links to. */
async function linkedAccountId(page: Page, name: string): Promise<string> {
	const link = bankAccountRows(page)
		.getByRole("listitem")
		.filter({ hasText: name })
		.getByRole("link", { name });
	await expect(link).toBeVisible();

	return (await link.getAttribute("href"))?.split("/").at(-1) ?? "";
}

test("choosing a bank and approving lands on its accounts, and Banques lists it with its consent end", async ({
	page,
}) => {
	const connectionId = await connect(page);

	await visit(page);

	// The bank allows 180 days; Archant asks for 90 at most.
	const consentEnd = longDate.format(new Date(Date.now() + 90 * 86_400_000));
	const connections = page.getByRole("list", { name: "Banques connectées" });
	const row = connections.getByRole("listitem").filter({ hasText: "Banque Démo" }).last();
	await expect(row).toContainText("France");
	await expect(row).toContainText(`Consentement valable jusqu'au ${consentEnd}`);
	await connections
		.getByRole("link", { name: "Gérer les comptes de Banque Démo" })
		.and(page.locator(`[href="/settings/banks/${connectionId}"]`))
		.click();
	await expect(page).toHaveURL(new RegExp(`/settings/banks/${connectionId}$`, "u"));

	const db = await createDb(`file:${DATABASE_FILE}`);

	try {
		const stored = await db.$client.execute(
			"select session_id, status from bank_connections where institution_name = 'Banque Démo' and status = 'active'",
		);

		expect(stored.rows.length).toBeGreaterThan(0);
		for (const connection of stored.rows) {
			expect(connection["session_id"]).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/u);
		}
	} finally {
		db.$client.close();
	}
});

test("a redirect URL the provider refuses is named in the toast", async ({ page }) => {
	const url = "http://localhost:8788/settings/banks/callback";
	await page.route("**/api/bank-connections", (route) =>
		route.request().method() === "POST"
			? route.fulfill({
					status: 502,
					json: { error: { code: "BANK_REDIRECT_NOT_ALLOWED", message: "x", params: { url } } },
				})
			: route.fallback(),
	);

	await visit(page);
	await banks(page).getByRole("button", { name: "Connecter Banque Démo" }).click();

	await expect(toast(page, url)).toBeVisible();
	await expect(page).toHaveURL(/\/settings\/banks$/u);
});

test("a server without ENCRYPTION_KEY names it and links to the guide", async ({ page }) => {
	await page.route("**/api/bank-connections/setup", (route) =>
		route.fulfill({ json: { data: { available: false, missing: ["ENCRYPTION_KEY"] } } }),
	);

	await visit(page);

	const alert = page.getByRole("alert");
	await expect(alert).toContainText("La connexion bancaire n'est pas configurée");
	await expect(alert.getByText("ENCRYPTION_KEY", { exact: true })).toBeVisible();
	await expect(alert.getByRole("link", { name: "Lire le guide de déploiement" })).toHaveAttribute(
		"href",
		/docs\/deployment\.md/u,
	);
	await expect(page.getByRole("combobox", { name: "Pays" })).toBeHidden();
});

test("a bank refusal shows its message without calling the API", async ({ page }) => {
	const callbacks: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/bank-connections/callback")) {
			callbacks.push(request.url());
		}
	});

	await page.goto("/settings/banks/callback?error=access_denied&state=whatever");

	await expect(page.getByRole("alert")).toContainText("La banque n'a pas donné son accord.");
	await page.getByRole("link", { name: "Retour aux banques" }).click();
	await expect(page).toHaveURL(/\/settings\/banks$/u);
	expect(callbacks).toEqual([]);
});

test("a spent or unknown state shows the translated error", async ({ page }) => {
	await page.goto(
		"/settings/banks/callback?code=a-code&state=00000000-0000-4000-8000-000000000000",
	);

	await expect(page.getByRole("alert")).toContainText(
		"Cette autorisation bancaire est inconnue, déjà utilisée ou expirée.",
	);
});

test("a new connection shows each bank account with its masked IBAN, its currency and a suggestion", async ({
	page,
}) => {
	await connect(page);

	const rows = bankAccountRows(page).getByRole("listitem");
	await expect(rows).toHaveCount(2);
	const checking = rows.filter({ hasText: FAKE_ACCOUNTS.checking.name });
	await expect(checking).toContainText(`•••• ${FAKE_ACCOUNTS.checking.ibanLast4}`);
	await expect(checking).toContainText("EUR");
	await expect(choice(page, FAKE_ACCOUNTS.checking.name)).toHaveText("Nouveau : Compte courant");
	await expect(choice(page, FAKE_ACCOUNTS.card.name)).toHaveText("Nouveau : Carte de crédit");

	await choice(page, FAKE_ACCOUNTS.card.name).click();
	await expect(page.getByRole("option", { name: "Ignorer" })).toBeVisible();
	await expect(page.getByRole("option", { name: "Nouveau : Prêt immobilier" })).toBeVisible();
	await page.keyboard.press("Escape");
});

test("creating an account shows the bank balance in the sidebar, and a skipped row stays selectable", async ({
	page,
}) => {
	await connect(page);

	await choose(page, FAKE_ACCOUNTS.card.name, "Ignorer");
	await validate(page).click();

	await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
	const accountId = await linkedAccountId(page, FAKE_ACCOUNTS.checking.name);
	await expect(sidebarAccount(page, accountId)).toContainText("1 231,36 €");

	// Skipped: nothing written, still offered, after a reload too.
	await page.reload();
	await expect(choice(page, FAKE_ACCOUNTS.card.name)).toBeVisible();
	await expect(choice(page, FAKE_ACCOUNTS.checking.name)).toBeHidden();
	await choose(page, FAKE_ACCOUNTS.card.name, "Nouveau : Carte de crédit");
	await validate(page).click();

	const cardId = await linkedAccountId(page, FAKE_ACCOUNTS.card.name);
	// The bank prints -300,00; the card owes 300,00.
	await expect(sidebarAccount(page, cardId)).toContainText("300,00 €");
	await expect(validate(page)).toBeHidden();
});

test("linking an account fed by hand keeps its transactions and ends on the bank balance", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Joint"), openingDate: daysAgo(30) });
	const label = uniqueName("Boulangerie");
	await api.addTransaction(account.id, { date: daysAgo(5), label, amount: "-42,90" });

	await connect(page);
	await choose(page, FAKE_ACCOUNTS.checking.name, account.name);
	await choose(page, FAKE_ACCOUNTS.card.name, "Ignorer");
	await validate(page).click();

	await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
	await expect(bankAccountRows(page).getByRole("link", { name: account.name })).toHaveAttribute(
		"href",
		`/accounts/${account.id}`,
	);
	await expect(sidebarAccount(page, account.id)).toContainText("1 231,36 €");

	await page.goto(`/accounts/${account.id}`);
	await expect(page.getByText(label)).toBeVisible();
	await expect(page.getByRole("main")).toContainText("1 231,36 €");

	// Each account links once: it is no longer offered to the next connection.
	await connect(page);
	await choice(page, FAKE_ACCOUNTS.checking.name).click();
	await expect(page.getByRole("option", { name: "Nouveau : Compte courant" })).toBeVisible();
	await expect(page.getByRole("option", { name: account.name })).toBeHidden();
	await page.keyboard.press("Escape");
});

test("an unknown connection says so and links back to Banques", async ({ page }) => {
	await page.goto(`/settings/banks/${randomUUID()}`);

	await expect(page.getByRole("alert")).toContainText("Cette connexion n'existe pas.");
	await page.getByRole("link", { name: "Retour aux banques" }).click();
	await expect(page).toHaveURL(/\/settings\/banks$/u);
});

/** A transaction row of the account page, by its label. */
const transactionRow = (page: Page, label: string) =>
	page.getByRole("main").getByRole("button", { name: new RegExp(label, "u") });

test("linking an account syncs the bank's lines, once, and the pages show the last sync", async ({
	page,
}) => {
	const connectionId = await connect(page);
	await expect(page.getByText("Jamais synchronisée")).toBeVisible();

	await choose(page, FAKE_ACCOUNTS.card.name, "Ignorer");
	await validate(page).click();

	await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
	await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();
	const accountId = await linkedAccountId(page, FAKE_ACCOUNTS.checking.name);
	// The bank's booked 1 234,56 €, less the pending 3,20 € it leaves out.
	await expect(sidebarAccount(page, accountId)).toContainText("1 231,36 €");

	await page.goto(`/accounts/${accountId}`);
	await expect(transactionRow(page, FAKE_LINES.groceries.label)).toContainText(euros(-4290));
	await expect(transactionRow(page, FAKE_LINES.salary.label)).toContainText(euros(250_000));
	// From the second page of the statement.
	await expect(transactionRow(page, FAKE_LINES.subscription.label)).toBeVisible();
	// The pending line sits at the top of today, named in words beside its amount.
	const pendingRow = transactionRow(page, FAKE_LINES.pending.label);
	await expect(pendingRow).toContainText("En attente");
	await expect(pendingRow).toContainText(euros(-320));
	await expect(page.getByRole("main").locator("[data-transaction-id]").first()).toContainText(
		FAKE_LINES.pending.label,
	);
	await expect(transactionRow(page, FAKE_LINES.groceries.label)).not.toContainText("En attente");
	await expect(transactionRow(page, FAKE_LINES.groceries.label)).toHaveCount(1);
	await expect(page.getByRole("main")).toContainText("1 231,36 €");

	await transactionRow(page, FAKE_LINES.groceries.label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(
		sheet.getByText("Synchronisée depuis Enable Banking", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");

	// A second run within the hour is refused, and nothing is fetched twice.
	await page.goto(`/settings/banks/${connectionId}`);
	await page.getByRole("button", { name: "Synchroniser" }).click();
	await expect(
		toast(page, "Cette banque a été synchronisée il y a moins d'une heure."),
	).toBeVisible();

	await visit(page);
	const row = page
		.getByRole("list", { name: "Banques connectées" })
		.getByRole("listitem")
		.filter({ has: page.locator(`[href="/settings/banks/${connectionId}"]`) });
	await expect(row).toContainText("Dernière synchronisation :");
	await expect(row).not.toContainText("Jamais synchronisée");
});

test("an account the bank fails to list shows the error, and the other one still syncs", async ({
	page,
}) => {
	await connect(page, FAILING_BANK);

	// Both accounts, as suggested: the card's transactions answer 500.
	await validate(page).click();

	await expect(toast(page, "2 comptes reliés à la banque.")).toBeVisible();
	await expect(
		page.getByText(
			"La dernière synchronisation a échoué : Enable Banking n'a pas répondu correctement.",
		),
	).toBeVisible();
	await expect(page.getByText("Jamais synchronisée")).toBeVisible();

	const checkingId = await linkedAccountId(page, FAKE_ACCOUNTS.checking.name);
	const cardId = await linkedAccountId(page, FAKE_ACCOUNTS.card.name);
	await page.goto(`/accounts/${checkingId}`);
	await expect(transactionRow(page, FAKE_LINES.salary.label)).toBeVisible();
	await page.goto(`/accounts/${cardId}`);
	await expect(page.getByRole("main")).toContainText("300,00 €");
	await expect(transactionRow(page, FAKE_LINES.salary.label)).toHaveCount(0);
});
