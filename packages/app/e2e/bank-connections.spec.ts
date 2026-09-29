import type { Page } from "@playwright/test";

import { generateKeyPairSync, randomUUID } from "node:crypto";

import { createDb } from "@archant/data/client";

import { formatTableDate } from "../src/lib/balance-change.ts";
import {
	BALANCELESS_BANK,
	DATED_BANK,
	FAILING_BANK,
	FAKE_ACCOUNTS,
	FAKE_BANKS,
	FAKE_LINES,
	NO_CURRENCY_BANK,
	SLOW_BANK,
	SLOW_LINE,
	UNREADABLE_BANK,
} from "./fake-enable-banking.ts";
import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";
import {
	BANK_APPLICATION_ID,
	BANK_KEY_FILE,
	DATABASE_FILE,
	TIME_ZONE,
	WEB_URL,
} from "./settings.ts";

// Stories 10.1 to 10.5: connecting a bank from « Réglages > Banques »,
// deciding what each of its accounts becomes, syncing them, then renewing or
// disconnecting it, against the fake Enable Banking that e2e/start-api.ts
// starts on loopback. Story 11.14: setting Enable Banking up from the same
// page; the `setup` project saved the run's credentials already, and the
// tests that save them again run first, before any bank locks them.

const PAGE = "/settings/banks";

const CONNECTION_URL = /\/settings\/banks\/([0-9a-f-]{36})$/u;

/** Story 13.11: the banks of a country live in Sure's picker dialog. */
const picker = (page: Page) => page.getByRole("dialog", { name: "Choisir une banque" });

const banks = (page: Page) => picker(page).getByRole("list", { name: "Banques disponibles" });

const chooseBank = (page: Page) =>
	page
		.getByRole("region", { name: "Connecter une banque" })
		.getByRole("button", { name: "Choisir une banque" });

async function openPicker(page: Page) {
	await chooseBank(page).click();
	await expect(picker(page)).toBeVisible();
}

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

const REDIRECT_URL = `${WEB_URL}/settings/banks/callback`;

const SETUP = "**/api/bank-connections/setup";

type Setup = {
	available: boolean;
	source: "environment" | "interface" | null;
	applicationId: string | null;
	redirectUrl: string;
	locked: boolean;
	missing: string[];
};

const setupData = (fields: Partial<Setup>): { data: Setup } => ({
	data: {
		available: true,
		source: "interface",
		applicationId: BANK_APPLICATION_ID,
		redirectUrl: REDIRECT_URL,
		locked: false,
		missing: [],
		...fields,
	},
});

/**
 * The page as a fresh install shows it: the first read of the setup says
 * nothing is configured, every later one is the server's own answer.
 */
async function visitUnconfigured(page: Page) {
	await page.route(
		SETUP,
		(route) =>
			route.fulfill({
				json: setupData({ available: false, source: null, applicationId: null }),
			}),
		{ times: 1 },
	);
	await visit(page);
}

const applicationIdField = (page: Page) =>
	page.getByRole("textbox", { name: "Identifiant de l'application" });

const keyFile = (page: Page) => page.getByLabel("Clé privée (fichier .pem)");

const saveCredentials = (page: Page) => page.getByRole("button", { name: "Enregistrer" });

test("a fresh install lists Sure's steps, with the redirect address to copy, and no country", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await visitUnconfigured(page);

	const steps = page.getByRole("list", { name: "Étapes" }).getByRole("listitem");
	await expect(steps).toHaveCount(3);
	await expect(steps.nth(0).getByRole("link", { name: "portail Enable Banking" })).toHaveAttribute(
		"href",
		/enablebanking\.com/u,
	);
	await expect(steps.nth(1)).toContainText(REDIRECT_URL);
	await expect(applicationIdField(page)).toBeVisible();
	await expect(keyFile(page)).toHaveAttribute("type", "file");
	await expect(page.getByRole("combobox", { name: "Pays" })).toBeHidden();

	await page.getByRole("button", { name: "Copier l'adresse de retour" }).click();
	await expect(toast(page, "Adresse copiée.")).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REDIRECT_URL);
});

test("a key the provider refuses, or a file that holds none, saves nothing", async ({ page }) => {
	const saves: number[] = [];
	page.on("response", (response) => {
		if (response.url().endsWith("/api/bank-connections/credentials")) {
			saves.push(response.status());
		}
	});
	await visitUnconfigured(page);

	await applicationIdField(page).fill(BANK_APPLICATION_ID);
	await keyFile(page).setInputFiles({
		name: "autre.pem",
		mimeType: "application/x-pem-file",
		buffer: Buffer.from(
			generateKeyPairSync("rsa", { modulusLength: 2048 })
				.privateKey.export({ type: "pkcs8", format: "pem" })
				.toString(),
		),
	});
	await saveCredentials(page).click();

	await expect(page.getByRole("alert")).toContainText(
		"Enable Banking refuse cet identifiant et cette clé.",
	);

	await keyFile(page).setInputFiles({
		name: "notes.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("pas une clé"),
	});
	await saveCredentials(page).click();

	await expect(
		page.getByText("Ce fichier ne contient pas de clé privée RSA lisible."),
	).toBeVisible();
	await expect(keyFile(page)).toHaveAttribute("aria-invalid", "true");
	expect(saves).toEqual([400, 400]);
	await expect(page.getByRole("combobox", { name: "Pays" })).toBeHidden();
});

test("the right key is saved encrypted, and the page moves on to the country", async ({ page }) => {
	await visitUnconfigured(page);

	await applicationIdField(page).fill(BANK_APPLICATION_ID);
	await keyFile(page).setInputFiles(BANK_KEY_FILE);
	await saveCredentials(page).click();

	await expect(toast(page, "Identifiants Enable Banking enregistrés.")).toBeVisible();
	await expect(page.getByRole("combobox", { name: "Pays" })).toHaveText("France");
	await openPicker(page);
	await expect(banks(page).getByRole("button", { name: "Connecter Banque Démo" })).toBeVisible();
	await page.keyboard.press("Escape");
	// Saved from the interface, it stays editable below the banks.
	await expect(applicationIdField(page)).toHaveValue(BANK_APPLICATION_ID);

	const db = await createDb(`file:${DATABASE_FILE}`);

	try {
		const stored = await db.$client.execute(
			"select key, value from settings where key like 'enable_banking_%' order by key",
		);

		expect(stored.rows.map((row) => row["key"])).toEqual([
			"enable_banking_application_id",
			"enable_banking_private_key",
		]);
		expect(stored.rows[1]?.["value"]).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/u);
	} finally {
		db.$client.close();
	}
});

test("an application without the redirect address names it in the form, saving nothing", async ({
	page,
}) => {
	await page.route("**/api/bank-connections/credentials", (route) =>
		route.fulfill({
			status: 502,
			json: {
				error: { code: "BANK_REDIRECT_NOT_ALLOWED", message: "x", params: { url: REDIRECT_URL } },
			},
		}),
	);
	await visitUnconfigured(page);

	await applicationIdField(page).fill(BANK_APPLICATION_ID);
	await keyFile(page).setInputFiles(BANK_KEY_FILE);
	await saveCredentials(page).click();

	await expect(page.getByRole("alert")).toContainText(REDIRECT_URL);
	await expect(page.getByRole("combobox", { name: "Pays" })).toBeHidden();
});

test("credentials the server sets are shown, never offered for editing", async ({ page }) => {
	await page.route(SETUP, (route) =>
		route.fulfill({ json: setupData({ source: "environment", applicationId: "app-du-serveur" }) }),
	);

	await visit(page);

	await expect(page.getByText("Enable Banking est configuré par le serveur.")).toBeVisible();
	await expect(page.getByText("Application : app-du-serveur")).toBeVisible();
	await expect(page.getByText(REDIRECT_URL, { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Copier l'adresse de retour" })).toBeVisible();
	await expect(applicationIdField(page)).toBeHidden();
	await expect(keyFile(page)).toBeHidden();
	await expect(page.getByRole("combobox", { name: "Pays" })).toBeVisible();
});

test("Banques connectées comes first, and no bank is listed or asked for before the picker opens", async ({
	page,
}) => {
	const lists: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/bank-connections/institutions")) {
			lists.push(request.url());
		}
	});

	await visit(page);
	await expect(chooseBank(page)).toBeVisible();

	await expect(page.getByRole("heading", { level: 3 })).toHaveText([
		"Banques connectées",
		"Connecter une banque",
		"Application Enable Banking",
	]);
	await expect(page.getByRole("list", { name: "Banques disponibles" })).toHaveCount(0);
	expect(lists).toEqual([]);

	await openPicker(page);
	await expect(banks(page)).toBeVisible();
	expect(lists).toHaveLength(1);
});

test("the picker lists France's banks with name and BIC, focuses the search, scrolls inside, and filters", async ({
	page,
}) => {
	await visit(page);
	await expect(page.getByRole("combobox", { name: "Pays" })).toHaveText("France");
	await openPicker(page);

	const dialog = picker(page);
	await expect(dialog).toContainText("Pays : France.");
	await expect(dialog.getByLabel("Rechercher une banque")).toBeFocused();
	await Promise.all(
		FAKE_BANKS.map((name) =>
			expect(banks(page).getByRole("button", { name: `Connecter ${name}` })).toBeAttached(),
		),
	);
	await expect(banks(page).getByRole("button")).toHaveCount(FAKE_BANKS.length);
	// The fake gives the first bank a BIC, as a real one does.
	await expect(banks(page).getByRole("button", { name: "Connecter Banque Démo" })).toContainText(
		"BIC : DEMOFRPP",
	);

	// Eight banks overflow the bounded list, which scrolls inside a dialog
	// that stays on screen.
	const overflows = await banks(page).evaluate(
		(list) => list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === "auto",
	);
	expect(overflows).toBe(true);
	const box = await dialog.boundingBox();
	const bottom = await page.evaluate(() => window.innerHeight);
	expect(box?.y).toBeGreaterThanOrEqual(0);
	expect((box?.y ?? 0) + (box?.height ?? Infinity)).toBeLessThanOrEqual(bottom);

	// Accents and case ignored, as the user types.
	await dialog.getByLabel("Rechercher une banque").fill("neobanque");
	await expect(banks(page).getByRole("button")).toHaveCount(1);
	await expect(banks(page).getByRole("button", { name: "Connecter Néobanque Test" })).toBeVisible();

	// The BIC matches too.
	await dialog.getByLabel("Rechercher une banque").fill("demofrpp");
	await expect(banks(page).getByRole("button")).toHaveCount(1);
	await expect(banks(page).getByRole("button", { name: "Connecter Banque Démo" })).toBeVisible();

	await dialog.getByLabel("Rechercher une banque").fill("introuvable");
	await expect(dialog.getByText("Aucune banque ne correspond à cette recherche.")).toBeVisible();
});

test("Escape, « Annuler » and the close button close the picker with nothing started, and it reopens empty", async ({
	page,
}) => {
	const starts: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().includes("/api/bank-connections")) {
			starts.push(request.url());
		}
	});

	await visit(page);
	await openPicker(page);
	await picker(page).getByLabel("Rechercher une banque").fill("demo");
	await page.keyboard.press("Escape");
	await expect(picker(page)).toBeHidden();
	// The focus goes back to the button that opened it.
	await expect(chooseBank(page)).toBeFocused();

	await openPicker(page);
	await expect(picker(page).getByLabel("Rechercher une banque")).toHaveValue("");
	await expect(banks(page).getByRole("button")).toHaveCount(FAKE_BANKS.length);
	await picker(page).getByRole("button", { name: "Annuler" }).click();
	await expect(picker(page)).toBeHidden();

	await openPicker(page);
	await picker(page).getByRole("button", { name: "Fermer" }).click();
	await expect(picker(page)).toBeHidden();

	expect(starts).toEqual([]);
});

test("another country lists its own banks", async ({ page }) => {
	await visit(page);

	await page.getByRole("combobox", { name: "Pays" }).click();
	await page.getByRole("option", { name: "Belgique" }).click();
	await openPicker(page);

	await expect(picker(page)).toContainText("Pays : Belgique.");
	await expect(banks(page).getByRole("button", { name: "Connecter Banque BE" })).toBeVisible();
	await expect(banks(page).getByRole("button")).toHaveCount(1);
});

test("a provider that cannot list banks says so inside the picker, with « Réessayer »", async ({
	page,
}) => {
	await page.route(
		(url) => url.pathname.endsWith("/api/bank-connections/institutions"),
		(route) =>
			route.fulfill({
				status: 502,
				json: { error: { code: "BANK_PROVIDER_ERROR", message: "x" } },
			}),
	);

	await visit(page);
	await openPicker(page);

	const alert = picker(page).getByRole("alert");
	// Three retries with backoff come first.
	await expect(alert).toContainText("Enable Banking n'a pas répondu correctement.", {
		timeout: 15_000,
	});
	await expect(alert.getByRole("button", { name: "Réessayer" })).toBeVisible();
});

test("the keyboard alone opens the picker, searches and starts the consent", async ({ page }) => {
	await visit(page);

	await page.getByRole("combobox", { name: "Pays" }).focus();
	await page.keyboard.press("Tab");
	await expect(chooseBank(page)).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(picker(page)).toBeVisible();
	await expect(picker(page).getByLabel("Rechercher une banque")).toBeFocused();

	await page.keyboard.type("demo");
	await expect(banks(page).getByRole("button")).toHaveCount(1);
	await page.keyboard.press("Tab");
	await expect(banks(page).getByRole("button", { name: "Connecter Banque Démo" })).toBeFocused();
	await page.keyboard.press("Enter");

	await expect(toast(page, "Banque Démo est connectée.")).toBeVisible();
	await expect(page).toHaveURL(CONNECTION_URL);
});

/** Connects `bank`, Banque Démo by default, and returns once its page is open, with its id. */
async function connect(page: Page, bank = "Banque Démo"): Promise<string> {
	await visit(page);
	await openPicker(page);
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

/** The accounts column's link to an account, which carries its balance. */
const columnAccount = (page: Page, accountId: string) =>
	page
		.getByRole("complementary", { name: "Liste des comptes" })
		.locator(`a[href="/accounts/${accountId}"]`);

/**
 * Leaves a settings page for Opérations through the rail, without a reload:
 * settings put their navigation where the accounts column sits, and the
 * column must show what the page's cache already holds.
 */
async function toTransactions(page: Page) {
	await page
		.getByRole("navigation", { name: "Navigation principale" })
		.getByRole("link", { name: "Opérations", exact: true })
		.click();
	await expect(page).toHaveURL(/\/transactions$/u);
}

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
	// No alert, no badge.
	await expect(row.locator('[data-slot="status-badge"]')).toHaveCount(0);
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

test("a connected bank locks the credentials, with Sure's warning", async ({ page }) => {
	await connect(page);
	await visit(page);

	await expect(page.getByText("Configuration verrouillée")).toBeVisible();
	await expect(
		page.getByText("Déconnectez toutes les banques avant de modifier ces identifiants."),
	).toBeVisible();
	await expect(applicationIdField(page)).toBeDisabled();
	await expect(keyFile(page)).toBeDisabled();
	await expect(saveCredentials(page)).toBeDisabled();
});

test("a pending start ignores Escape, and a refusal names the redirect URL and leaves the picker open", async ({
	page,
}) => {
	const url = "http://localhost:8788/settings/banks/callback";
	let answer: (() => void) | undefined;
	const answered = new Promise<void>((resolve) => {
		answer = resolve;
	});
	await page.route("**/api/bank-connections", async (route) => {
		if (route.request().method() !== "POST") {
			await route.fallback();
			return;
		}

		await answered;
		await route.fulfill({
			status: 502,
			json: { error: { code: "BANK_REDIRECT_NOT_ALLOWED", message: "x", params: { url } } },
		});
	});

	await visit(page);
	await openPicker(page);
	await banks(page).getByRole("button", { name: "Connecter Banque Démo" }).click();

	// The browser is about to leave for the bank: closing would hide that.
	await expect(banks(page).getByRole("button", { name: "Connecter Banque Démo" })).toBeDisabled();
	await page.keyboard.press("Escape");
	// Not `toBeVisible()`, which a closing dialog still passes while it fades out.
	await expect(picker(page)).toHaveAttribute("data-state", "open");
	answer?.();

	await expect(toast(page, url)).toBeVisible();
	await expect(page).toHaveURL(/\/settings\/banks$/u);
	// Another bank can be chosen at once.
	await expect(picker(page)).toBeVisible();
	await expect(banks(page).getByRole("button", { name: "Connecter Banque Démo" })).toBeEnabled();
	await expect(
		banks(page).getByRole("button", { name: "Connecter Caisse Régionale Exemple" }),
	).toBeEnabled();
});

test("a server without ENCRYPTION_KEY names it and links to the guide", async ({ page }) => {
	await page.route(SETUP, (route) =>
		route.fulfill({
			json: setupData({
				available: false,
				source: null,
				applicationId: null,
				missing: ["ENCRYPTION_KEY"],
			}),
		}),
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
	await expect(applicationIdField(page)).toBeHidden();
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

test("a bank that gives its accounts no currency has them listed in EUR", async ({ page }) => {
	await connect(page, NO_CURRENCY_BANK);

	const rows = bankAccountRows(page).getByRole("listitem");
	await expect(rows).toHaveCount(2);
	const checking = rows.filter({ hasText: FAKE_ACCOUNTS.checking.name });
	const card = rows.filter({ hasText: FAKE_ACCOUNTS.card.name });
	await expect(checking).toContainText("EUR");
	await expect(checking).not.toContainText("XXX");
	await expect(card).toContainText("EUR");
	await expect(card).not.toContainText("XXX");
});

test("a bank whose accounts cannot be read says so and tells what to do", async ({ page }) => {
	await connect(page, UNREADABLE_BANK);

	await expect(bankAccountRows(page)).toBeHidden();
	await expect(
		page.getByText(
			"Aucun compte lisible n'est arrivé de la banque. Renouvelez le consentement en choisissant les comptes à partager. Si la liste reste vide, consultez les journaux du serveur.",
		),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Renouveler le consentement" })).toBeVisible();
});

test("creating an account shows the bank balance in the accounts column, and a skipped row stays selectable", async ({
	page,
}) => {
	await connect(page);

	await choose(page, FAKE_ACCOUNTS.card.name, "Ignorer");
	await validate(page).click();

	await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
	const accountId = await linkedAccountId(page, FAKE_ACCOUNTS.checking.name);
	await toTransactions(page);
	await expect(columnAccount(page, accountId)).toContainText("1 234,56 €");

	// Skipped: nothing written, still offered, after a reload too.
	await page.goBack();
	await page.reload();
	await expect(choice(page, FAKE_ACCOUNTS.card.name)).toBeVisible();
	await expect(choice(page, FAKE_ACCOUNTS.checking.name)).toBeHidden();
	await choose(page, FAKE_ACCOUNTS.card.name, "Nouveau : Carte de crédit");
	await validate(page).click();

	const cardId = await linkedAccountId(page, FAKE_ACCOUNTS.card.name);
	await expect(validate(page)).toBeHidden();
	// The bank prints -300,00; the card owes 300,00.
	await toTransactions(page);
	await expect(columnAccount(page, cardId)).toContainText("300,00 €");
});

test("a linked account's menu offers no deletion, only its connection's page", async ({ page }) => {
	const connectionId = await connect(page);
	await choose(page, FAKE_ACCOUNTS.card.name, "Ignorer");
	await validate(page).click();
	const accountId = await linkedAccountId(page, FAKE_ACCOUNTS.checking.name);

	await page.goto(`/accounts/${accountId}`);
	await page
		.getByRole("button", { name: `Actions du compte ${FAKE_ACCOUNTS.checking.name}` })
		.click();
	const menu = page.getByRole("menu");
	await expect(menu.getByRole("menuitem")).toHaveText([
		"Modifier",
		"Exclure des rapports",
		"Désactiver",
		"Déconnecter Banque Démo pour supprimer ce compte",
	]);
	await menu
		.getByRole("menuitem", { name: "Déconnecter Banque Démo pour supprimer ce compte" })
		.click();

	await expect(page).toHaveURL(new RegExp(`/settings/banks/${connectionId}$`, "u"));

	// Once disconnected, the same page's cache must offer deletion again.
	await page.getByRole("button", { name: "Déconnecter" }).click();
	await page
		.getByRole("alertdialog", { name: "Déconnecter Banque Démo ?" })
		.getByRole("button", { name: "Déconnecter" })
		.click();
	await expect(toast(page, "La connexion à Banque Démo est supprimée.")).toBeVisible();
	await toTransactions(page);
	await columnAccount(page, accountId).click();
	await expect(page).toHaveURL(new RegExp(`/accounts/${accountId}$`, "u"));
	await page
		.getByRole("button", { name: `Actions du compte ${FAKE_ACCOUNTS.checking.name}` })
		.click();
	const unlinked = page.getByRole("menu");
	await expect(unlinked.getByRole("menuitem", { name: "Supprimer le compte" })).toBeVisible();
	await expect(unlinked.getByRole("menuitem", { name: /^Déconnecter Banque Démo/u })).toHaveCount(
		0,
	);
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
	await toTransactions(page);
	await expect(columnAccount(page, account.id)).toContainText("1 234,56 €");

	await page.goto(`/accounts/${account.id}`);
	await expect(page.getByText(label)).toBeVisible();
	await expect(page.getByRole("main")).toContainText("1 234,56 €");

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
	// The bank's booked 1 234,56 €: the pending 3,20 € counts in no balance.
	await toTransactions(page);
	await expect(columnAccount(page, accountId)).toContainText("1 234,56 €");

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
	// Listed booked and pending under one reference, it counts once.
	await expect(transactionRow(page, FAKE_LINES.groceries.label)).not.toContainText("En attente");
	await expect(transactionRow(page, FAKE_LINES.groceries.label)).toHaveCount(1);
	await expect(page.getByRole("main")).toContainText("1 234,56 €");

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

test("a bank that gives no balance on sync still brings its lines, and says the balance is the previous one", async ({
	page,
}) => {
	const connectionId = await connect(page, BALANCELESS_BANK);

	// The balance answers when the account is linked, then 500 on the sync.
	await choose(page, FAKE_ACCOUNTS.card.name, "Ignorer");
	await validate(page).click();

	await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
	const notice = page.getByRole("status").filter({
		hasText:
			"Opérations à jour, mais la banque n'a pas donné le solde : le solde affiché reste celui de la synchronisation précédente.",
	});
	await expect(notice).toBeVisible();
	await expect(notice).not.toHaveClass(/text-destructive/u);
	await expect(page.getByText("La dernière synchronisation a échoué")).toBeHidden();
	await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();

	const accountId = await linkedAccountId(page, FAKE_ACCOUNTS.checking.name);
	await page.goto(`/accounts/${accountId}`);
	await expect(transactionRow(page, FAKE_LINES.groceries.label)).toBeVisible();
	await expect(transactionRow(page, FAKE_LINES.subscription.label)).toBeVisible();
	// The 1 234,56 € given when linked, the pending 3,20 € left out.
	await expect(page.getByRole("main")).toContainText("1 234,56 €");

	// Two hours later, the button's own sync warns rather than fails.
	await age(connectionId, { lastSyncedAt: Date.now() - 2 * 60 * 60_000 });
	await page.goto(`/settings/banks/${connectionId}`);
	await page.getByRole("button", { name: "Synchroniser" }).click();
	await expect(
		toast(
			page,
			"Opérations à jour, mais la banque n'a pas donné le solde : le solde affiché reste celui de la synchronisation précédente.",
		),
	).toBeVisible();
	await expect(toast(page, "Synchronisation terminée avec une erreur.")).toHaveCount(0);
});

// Story 11.7: each bank figure a sync received stays, as a snapshot.
test("a bank balance a later sync supersedes stays in Soldes on its own day", async ({ page }) => {
	const connectionId = await connect(page, DATED_BANK);
	await choose(page, FAKE_ACCOUNTS.card.name, "Ignorer");
	await validate(page).click();
	await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
	const accountId = await linkedAccountId(page, FAKE_ACCOUNTS.checking.name);
	// The sync the link starts, done: aged while it runs, the connection
	// would end it synced « à l'instant » and refuse the one below.
	await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();
	// Yesterday's 1 200,00 €: no booked line since.
	await toTransactions(page);
	await expect(columnAccount(page, accountId)).toContainText(euros(120_000));

	await age(connectionId, { lastSyncedAt: Date.now() - 2 * 60 * 60_000 });
	await page.goto(`/settings/banks/${connectionId}`);
	await page.getByRole("button", { name: "Synchroniser" }).click();
	await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();

	await toTransactions(page);
	await expect(columnAccount(page, accountId)).toContainText(euros(123_456));
	await page.goto(`/accounts/${accountId}?tab=snapshots`);
	const yesterday = daysAgo(1);
	const rows = page.getByRole("row", { name: new RegExp(`^${formatTableDate(yesterday)} `, "u") });
	await expect(rows).toHaveCount(1);
	await expect(rows.getByRole("cell").nth(1)).toHaveText(euros(120_000));
});

// Story 11.6: the next sync rereads the last week, and must not bring back
// what the user deleted.
test("a synced transaction deleted from its sheet stays deleted after the next sync", async ({
	page,
}) => {
	const connectionId = await connect(page);
	await choose(page, FAKE_ACCOUNTS.card.name, "Ignorer");
	await validate(page).click();
	await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
	const accountId = await linkedAccountId(page, FAKE_ACCOUNTS.checking.name);

	await page.goto(`/accounts/${accountId}`);
	const label = FAKE_LINES.groceries.label;
	await transactionRow(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await sheet.getByRole("button", { name: "Supprimer" }).click();
	const confirm = page.getByRole("alertdialog", { name: `Supprimer l'opération « ${label} » ?` });
	await confirm.getByRole("button", { name: "Supprimer" }).click();
	await expect(sheet).toBeHidden();
	await expect(transactionRow(page, label)).toHaveCount(0);

	await age(connectionId, { lastSyncedAt: Date.now() - 2 * 60 * 60_000 });
	await page.goto(`/settings/banks/${connectionId}`);
	await page.getByRole("button", { name: "Synchroniser" }).click();
	await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();

	await page.goto(`/accounts/${accountId}`);
	await expect(transactionRow(page, FAKE_LINES.salary.label)).toBeVisible();
	await expect(transactionRow(page, label)).toHaveCount(0);
});

// Story 10.5. A banner shows on every page, so each test below puts its
// connection back out of sight when it ends, pass or fail.

const DAY_MS = 86_400_000;

const bannerDate = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	timeZone: TIME_ZONE,
});

const banners = (page: Page) => page.getByRole("region", { name: "Avertissements bancaires" });

/** Story 12.4: the warning badge a connection's row shows for its alert, on « Banques ». */
async function expectRowBadge(page: Page, connectionId: string, status: string, text: string) {
	await visit(page);
	const badge = page
		.getByRole("list", { name: "Banques connectées" })
		.getByRole("listitem")
		.filter({ has: page.locator(`[href="/settings/banks/${connectionId}"]`) })
		.locator('[data-slot="status-badge"]');
	await expect(badge).toHaveCount(1);
	await expect(badge).toHaveAttribute("data-status", status);
	await expect(badge).toHaveText(text);
	await expect(badge).toHaveClass(/\btext-warning\b/u);
}

/**
 * Moves a connection's consent end, last sync or last sync attempt, as time
 * passing would: the e2e server's clock cannot be faked.
 */
async function age(
	connectionId: string,
	fields: { consentExpiresAt?: number; lastSyncedAt?: number | null; syncAttemptedAt?: number },
) {
	const db = await createDb(`file:${DATABASE_FILE}`);

	try {
		await Promise.all(
			Object.entries({
				consent_expires_at: fields.consentExpiresAt,
				last_synced_at: fields.lastSyncedAt,
				sync_attempted_at: fields.syncAttemptedAt,
			}).flatMap(([column, value]) =>
				value === undefined
					? []
					: [
							db.$client.execute({
								sql: `update bank_connections set ${column} = ? where id = ?`,
								args: [value, connectionId],
							}),
						],
			),
		);
	} finally {
		db.$client.close();
	}
}

/** A connection whose accounts are both linked and synced, with the ids of those accounts. */
async function connectAndLink(page: Page) {
	const connectionId = await connect(page);
	await validate(page).click();
	await expect(toast(page, "2 comptes reliés à la banque.")).toBeVisible();
	await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();

	return {
		connectionId,
		checkingId: await linkedAccountId(page, FAKE_ACCOUNTS.checking.name),
		cardId: await linkedAccountId(page, FAKE_ACCOUNTS.card.name),
	};
}

test("an expiring consent shows a banner on every page, and renewing it keeps the connection", async ({
	page,
	request,
}) => {
	const { connectionId, checkingId, cardId } = await connectAndLink(page);

	try {
		const expiresAt = Date.now() + 10 * DAY_MS;
		// Synced minutes ago, within the hour: « à l'instant » after the
		// renewal can then only come from the sync the return page starts,
		// which the renewal alone lets through.
		await age(connectionId, {
			consentExpiresAt: expiresAt,
			lastSyncedAt: Date.now() - 5 * 60 * 1000,
		});
		await expectRowBadge(page, connectionId, "consentExpiring", "Consentement bientôt expiré");

		await page.goto("/transactions");
		const banner = banners(page);
		await expect(banner).toContainText(
			`Le consentement de Banque Démo expire le ${bannerDate.format(new Date(expiresAt))}.`,
		);

		// Closed, it stays hidden for the browser session, a reload included,
		// and comes back in a new one.
		await banner.getByRole("button", { name: "Masquer l'avertissement sur Banque Démo" }).click();
		await expect(banner).toBeHidden();
		await page.reload();
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await expect(banners(page)).toBeHidden();
		const other = await page.context().newPage();
		await other.goto("/accounts");
		await expect(banners(other)).toContainText("Le consentement de Banque Démo expire le");

		await banners(other).getByRole("button", { name: "Renouveler", exact: true }).click();

		// Back from the bank on the same connection, which syncs once at once.
		await expect(toast(other, "Banque Démo est connectée.")).toBeVisible();
		await expect(other).toHaveURL(new RegExp(`/settings/banks/${connectionId}$`, "u"));
		await expect(other.getByText("Dernière synchronisation : à l'instant")).toBeVisible();
		await expect(
			bankAccountRows(other).getByRole("link", { name: FAKE_ACCOUNTS.checking.name }),
		).toHaveAttribute("href", `/accounts/${checkingId}`);
		await expect(
			bankAccountRows(other).getByRole("link", { name: FAKE_ACCOUNTS.card.name }),
		).toHaveAttribute("href", `/accounts/${cardId}`);
		await expect(banners(other)).toBeHidden();

		// Every line recognised: none twice.
		await other.goto(`/accounts/${checkingId}`);
		await expect(transactionRow(other, FAKE_LINES.salary.label)).toHaveCount(1);
		await expect(transactionRow(other, FAKE_LINES.pending.label)).toHaveCount(1);
	} finally {
		await request.delete(`/api/bank-connections/${connectionId}`, {
			headers: { origin: WEB_URL },
		});
	}
});

test("an expired consent says sync has stopped, and the button answers with a toast", async ({
	page,
	request,
}) => {
	const connectionId = await connect(page);

	try {
		await age(connectionId, { consentExpiresAt: Date.now() - DAY_MS });
		await page.reload();

		await expect(banners(page)).toContainText(
			"Le consentement de Banque Démo a expiré. La synchronisation est arrêtée.",
		);
		await expect(
			banners(page).getByRole("button", { name: "Reconnecter", exact: true }),
		).toBeVisible();

		await page.getByRole("button", { name: "Synchroniser" }).click();
		await expect(toast(page, "Le consentement de cette banque a expiré.")).toBeVisible();

		await visit(page);
		const row = page
			.getByRole("list", { name: "Banques connectées" })
			.getByRole("listitem")
			.filter({ has: page.locator(`[href="/settings/banks/${connectionId}"]`) });
		await expect(row).toContainText("Consentement expiré");
		await expect(row).not.toContainText("Consentement valable");
		await expectRowBadge(page, connectionId, "consentExpired", "Consentement expiré");
	} finally {
		await request.delete(`/api/bank-connections/${connectionId}`, {
			headers: { origin: WEB_URL },
		});
	}
});

test("a sync stopped for more than 48 hours leads to its connection", async ({ page, request }) => {
	const connectionId = await connect(page);

	try {
		const lastSyncedAt = Date.now() - 49 * 60 * 60 * 1000;
		await age(connectionId, { lastSyncedAt });

		await page.goto("/");
		await expect(banners(page)).toContainText(
			`La synchronisation de Banque Démo est arrêtée depuis le ${bannerDate.format(new Date(lastSyncedAt))}.`,
		);
		await banners(page).getByRole("link", { name: "Voir la connexion" }).click();

		await expect(page).toHaveURL(new RegExp(`/settings/banks/${connectionId}$`, "u"));
		await expect(page.getByRole("heading", { level: 2, name: "Banque Démo" })).toBeVisible();
		await expectRowBadge(page, connectionId, "syncStale", "Synchronisation en retard");
	} finally {
		await request.delete(`/api/bank-connections/${connectionId}`, {
			headers: { origin: WEB_URL },
		});
	}
});

test("disconnecting keeps each account in the accounts column, with the same balance and transactions", async ({
	page,
}) => {
	const { connectionId, checkingId, cardId } = await connectAndLink(page);
	await toTransactions(page);
	await expect(columnAccount(page, checkingId)).toContainText("1 234,56 €");
	// The bank's 300,00 € owed, the pending 3,20 € left out.
	await expect(columnAccount(page, cardId)).toContainText("300,00 €");
	await page.goBack();

	await page.getByRole("button", { name: "Déconnecter" }).click();
	const dialog = page.getByRole("alertdialog", { name: "Déconnecter Banque Démo ?" });
	await expect(dialog).toContainText(
		"Les 2 comptes liés deviennent des comptes manuels. Leurs transactions et leur historique sont conservés.",
	);
	await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
	await dialog.getByRole("button", { name: "Déconnecter" }).click();

	await expect(toast(page, "La connexion à Banque Démo est supprimée.")).toBeVisible();
	await expect(page).toHaveURL(/\/settings\/banks$/u);
	await expect(page.locator(`[href="/settings/banks/${connectionId}"]`)).toHaveCount(0);
	await toTransactions(page);
	await expect(columnAccount(page, checkingId)).toContainText("1 234,56 €");
	await expect(columnAccount(page, cardId)).toContainText("300,00 €");

	await page.goto(`/accounts/${checkingId}`);
	await expect(page.getByRole("main")).toContainText("1 234,56 €");
	await expect(transactionRow(page, FAKE_LINES.salary.label)).toBeVisible();
	await expect(transactionRow(page, FAKE_LINES.pending.label)).toContainText("En attente");

	await page.goto(`/settings/banks/${connectionId}`);
	await expect(page.getByRole("alert")).toContainText("Cette connexion n'existe pas.");
});

// Story 13.8: the first request of the day syncs every bank after answering.

/**
 * A `SLOW_BANK` connection whose current account is linked and synced once,
 * with the id of that account.
 */
async function connectSlowBank(page: Page) {
	const connectionId = await connect(page, SLOW_BANK);
	await choose(page, FAKE_ACCOUNTS.card.name, "Ignorer");
	await validate(page).click();
	await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
	await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();

	return { connectionId, accountId: await linkedAccountId(page, FAKE_ACCOUNTS.checking.name) };
}

/** The next morning: the last attempt yesterday, the last sync hours ago. */
const nextMorning = (connectionId: string) =>
	age(connectionId, {
		syncAttemptedAt: Date.now() - DAY_MS,
		lastSyncedAt: Date.now() - 12 * 60 * 60_000,
	});

const syncRunning = (page: Page) =>
	page.getByRole("status").filter({ hasText: "Synchronisation en cours" });

test("the first page of the day shows the sync running, then the lines it brought", async ({
	page,
	request,
}) => {
	const { connectionId, accountId } = await connectSlowBank(page);

	try {
		await nextMorning(connectionId);
		await page.goto(`/accounts/${accountId}`);

		await expect(syncRunning(page)).toBeVisible();
		await expect(transactionRow(page, SLOW_LINE.label)).toHaveCount(0);

		await expect(syncRunning(page)).toBeHidden();
		await expect(transactionRow(page, SLOW_LINE.label)).toContainText(euros(15_000));

		// The day's attempt is spent: another page starts nothing.
		await page.reload();
		await expect(transactionRow(page, SLOW_LINE.label)).toBeVisible();
		await expect(syncRunning(page)).toHaveCount(0);
	} finally {
		await request.delete(`/api/bank-connections/${connectionId}`, {
			headers: { origin: WEB_URL },
		});
	}
});

test("a page left open since yesterday starts the sync when it comes back into view", async ({
	page,
	request,
}) => {
	const { connectionId, accountId } = await connectSlowBank(page);

	try {
		await nextMorning(connectionId);
		// TanStack Query reads every query again when the tab becomes visible.
		await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

		const running = page.getByRole("button", { name: "Synchronisation en cours" });
		await expect(running).toBeDisabled();
		await expect(syncRunning(page)).toBeVisible();

		await expect(page.getByRole("button", { name: "Synchroniser" })).toBeEnabled();
		await expect(running).toHaveCount(0);
		await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();
		await page.goto(`/accounts/${accountId}`);
		await expect(transactionRow(page, SLOW_LINE.label)).toBeVisible();
	} finally {
		await request.delete(`/api/bank-connections/${connectionId}`, {
			headers: { origin: WEB_URL },
		});
	}
});
