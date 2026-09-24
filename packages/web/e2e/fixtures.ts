import type { APIRequestContext, APIResponse } from "@playwright/test";

import { test as base, expect } from "@playwright/test";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";

import type { BalancePeriod } from "@archant/api/schemas/balances";
import { DEFAULT_BALANCE_PERIOD } from "@archant/api/schemas/balances";
import type { CategoryIcon } from "@archant/data/category-presets";
import { formatMoney, toMinorUnits } from "@archant/data/money";
import type { CategoryKind } from "@archant/data/schema/categories";

import { ACCOUNT_KINDS } from "../src/lib/account-kinds.ts";
import { TIME_ZONE, WEB_URL } from "./settings.ts";

export { expect };

type AccountKind = (typeof ACCOUNT_KINDS)[number]["id"];

export type OpenAccountOptions = {
	name?: string;
	kind?: AccountKind;
	/** As typed in the form: `1 234,56`. */
	openingBalance?: string;
	openingDate?: string;
	/** ISO 4217; EUR by default. */
	currency?: string;
	/** A loan's details, as typed in the form. */
	details?: { originalAmount?: string; interestRate?: string; endDate?: string };
};

export type Created = { id: string; name: string };

export type CreateCategoryOptions = {
	name?: string;
	kind?: CategoryKind;
	color?: string;
	icon?: CategoryIcon;
	parentId?: string | null;
};

// `request` carries the session cookie from the storage state, but no
// `Origin`: a browser adds one itself, and the API's `csrf()` refuses a form
// post, or a bodiless one, without it.
const sameOrigin = { origin: WEB_URL };

const createdBody = z.object({ data: z.object({ id: z.string() }) });

const linkedBody = z.object({
	data: z.object({ transfer: z.object({ id: z.string() }).nullable() }),
});

const ruleListBody = z.object({ data: z.array(z.object({ id: z.string() })) });

const accountListBody = z.object({
	data: z.object({
		groups: z.array(z.object({ classification: z.string(), total: z.number() })),
	}),
});

const netWorthBody = z.object({
	data: z.object({
		netWorth: z.number(),
		assets: z.number(),
		liabilities: z.number(),
		points: z.array(z.object({ date: z.string(), balance: z.number() })),
		change: z.object({ amount: z.number(), percent: z.number().nullable() }).nullable(),
		leftOut: z.array(z.object({ id: z.string(), name: z.string(), currency: z.string() })),
	}),
});

/** A name no other test uses, so each test finds its own rows. */
export function uniqueName(prefix: string): string {
	return `${prefix} ${randomUUID().slice(0, 8)}`;
}

/** The calendar day `days` before today in the suite's time zone, as `YYYY-MM-DD`. */
export function daysAgo(days: number): string {
	// `en-CA` formats a date as `YYYY-MM-DD`.
	const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
	const date = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000);

	return date.toISOString().slice(0, 10);
}

/** `2026-09-15` as `15/09/2026`, as a user types it in a date field. */
export function typed(iso: string): string {
	const [year, month, day] = iso.split("-");

	return `${day}/${month}/${year}`;
}

/** An amount in euros as the interface shows it, from minor units. */
export function euros(amount: number): string {
	return formatMoney({ amount: toMinorUnits(amount), currency: "EUR" });
}

/** A line of an OFX statement built by `sgml`, dated `daysAgo` days before today. */
export type Line = { daysAgo: number; amount: string; label: string; fitid: string };

export const ofxDate = (days: number) => daysAgo(days).replaceAll("-", "");

export type SgmlOptions = {
	/** `LEDGERBAL`, signed as the bank prints it; none when absent. */
	ledger?: { amount: string; daysAgo: number };
	/** A credit card statement, `CCSTMTRS`, rather than a bank one. */
	card?: boolean;
};

/** An OFX 1.x SGML statement: unclosed leaves, an empty MEMO, decimal commas. */
export function sgml(lines: Line[], options: SgmlOptions = {}): Buffer {
	const transactions = lines.map((line) =>
		[
			"<STMTTRN>",
			"<TRNTYPE>OTHER",
			`<DTPOSTED>${ofxDate(line.daysAgo)}`,
			`<TRNAMT>${line.amount}`,
			`<FITID>${line.fitid}`,
			`<NAME>${line.label}`,
			"<MEMO>",
			"</STMTTRN>",
		].join("\r\n"),
	);
	const text = [
		"OFXHEADER:100",
		"DATA:OFXSGML",
		"VERSION:102",
		"CHARSET:1252",
		"",
		"<OFX>",
		options.card === true
			? "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>"
			: "<BANKMSGSRSV1><STMTTRNRS><STMTRS>",
		"<CURDEF>EUR",
		"<BANKTRANLIST>",
		...transactions,
		"</BANKTRANLIST>",
		...(options.ledger === undefined
			? []
			: [
					"<LEDGERBAL>",
					`<BALAMT>${options.ledger.amount}`,
					`<DTASOF>${ofxDate(options.ledger.daysAgo)}`,
					"</LEDGERBAL>",
				]),
		options.card === true
			? "</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>"
			: "</STMTRS></STMTTRNRS></BANKMSGSRSV1>",
		"</OFX>",
	].join("\r\n");

	return Buffer.from(text, "latin1");
}

async function created(response: APIResponse): Promise<string> {
	expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);

	return createdBody.parse(await response.json()).data.id;
}

export function apiHelpers(request: APIRequestContext) {
	async function addTransaction(
		accountId: string,
		input: { date: string; label: string; amount: string; notes?: string },
	): Promise<string> {
		return created(await request.post(`/api/accounts/${accountId}/transactions`, { data: input }));
	}

	return {
		async openAccount(options: OpenAccountOptions = {}): Promise<Created> {
			const name = options.name ?? uniqueName("Compte");
			const kindId = options.kind ?? "checking";
			const kind = ACCOUNT_KINDS.find((candidate) => candidate.id === kindId);

			if (kind === undefined) {
				throw new Error(`Unknown account kind ${kindId}`);
			}

			const response = await request.post("/api/accounts", {
				data: {
					name,
					type: kind.type,
					subtype: kind.subtype,
					currency: options.currency ?? "EUR",
					openingBalance: options.openingBalance ?? "1 000,00",
					openingDate: options.openingDate ?? daysAgo(30),
					...(options.details === undefined ? {} : { details: options.details }),
				},
			});

			return { id: await created(response), name };
		},

		addTransaction,

		/**
		 * One transaction of `-1` on each of the `count` days before today,
		 * labelled `<prefix> 01` for yesterday onwards: one per day, so the list's
		 * order never depends on creation time.
		 */
		async addDailyTransactions(accountId: string, count: number, prefix: string) {
			// One after the other: each is an `immediate` ledger transaction, and
			// dozens queued at once on SQLite's busy timeout can fail on a slow runner.
			await Array.from({ length: count }, (_, index) => index + 1).reduce(async (previous, day) => {
				await previous;
				await addTransaction(accountId, {
					date: daysAgo(day),
					label: `${prefix} ${String(day).padStart(2, "0")}`,
					amount: "-1",
				});
			}, Promise.resolve());
		},

		/** Marks a transaction « Exclue des rapports », as the sheet's switch does. */
		async excludeTransaction(id: string) {
			const response = await request.patch(`/api/transactions/${id}`, {
				data: { excluded: true },
			});

			expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
		},

		/** Turns on « Exclure des rapports », as the account's settings do. */
		async excludeAccount(id: string) {
			const response = await request.patch(`/api/accounts/${id}`, {
				data: { excludedFromReports: true },
			});

			expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
		},

		async recordSnapshot(accountId: string, input: { date: string; balance: string }) {
			return created(await request.post(`/api/accounts/${accountId}/snapshots`, { data: input }));
		},

		/** Uploads a file and confirms its preview unchanged, as « Importer » does. Returns the import's id. */
		async importFile(accountId: string, buffer: Buffer, name = "releve.ofx"): Promise<string> {
			const id = await created(
				await request.post(`/api/accounts/${accountId}/imports`, {
					headers: sameOrigin,
					multipart: { file: { name, mimeType: "application/x-ofx", buffer } },
				}),
			);
			const response = await request.post(`/api/imports/${id}/confirm`, { headers: sameOrigin });

			expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);

			return id;
		},

		async createCategory(options: CreateCategoryOptions = {}): Promise<Created> {
			const name = options.name ?? uniqueName("Catégorie");
			const response = await request.post("/api/categories", {
				data: {
					name,
					kind: options.kind ?? "expense",
					color: options.color ?? "#e99537",
					icon: options.icon ?? "tag",
					parentId: options.parentId ?? null,
				},
			});

			return { id: await created(response), name };
		},

		/** Puts transactions in a category by hand, as the row's combobox does. */
		async categorise(transactionIds: string[], categoryId: string | null) {
			// One after the other: each is an `immediate` ledger write.
			await transactionIds.reduce(async (previous, id) => {
				await previous;
				const response = await request.patch(`/api/transactions/${id}`, {
					data: { categoryId },
				});

				expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
			}, Promise.resolve());
		},

		async createMerchant(name: string = uniqueName("Marchand")): Promise<Created> {
			return { id: await created(await request.post("/api/merchants", { data: { name } })), name };
		},

		async deleteMerchant(id: string) {
			// Bodiless, so it needs the `Origin` a browser would add.
			const response = await request.delete(`/api/merchants/${id}`, { headers: sameOrigin });

			expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
		},

		/** Links transactions to a merchant by hand, as the row's combobox does. */
		async setMerchant(transactionIds: string[], merchantId: string | null) {
			// One after the other: each is an `immediate` ledger write.
			await transactionIds.reduce(async (previous, id) => {
				await previous;
				const response = await request.patch(`/api/transactions/${id}`, {
					data: { merchantId },
				});

				expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
			}, Promise.resolve());
		},

		async createTag(name: string = uniqueName("Étiquette")): Promise<Created> {
			return { id: await created(await request.post("/api/tags", { data: { name } })), name };
		},

		async deleteTag(id: string) {
			// Bodiless, so it needs the `Origin` a browser would add.
			const response = await request.delete(`/api/tags/${id}`, { headers: sameOrigin });

			expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
		},

		/** Replaces transactions' tags by hand, as the row's combobox does. */
		async setTags(transactionIds: string[], tagIds: string[]) {
			// One after the other: each is an `immediate` ledger write.
			await transactionIds.reduce(async (previous, id) => {
				await previous;
				const response = await request.patch(`/api/transactions/${id}`, {
					data: { tagIds },
				});

				expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
			}, Promise.resolve());
		},

		/**
		 * Creates a rule with `actions`, as the form does. Every rule reaches
		 * every later transaction of the shared database, so the test that
		 * creates one deletes it with `deleteRules`.
		 */
		async createRule(input: {
			name?: string;
			conditions: { conditionType: string; operator: string; value: string | null }[];
			actions: { actionType: string; value: string | null }[];
		}): Promise<string> {
			return created(
				await request.post("/api/rules", {
					data: {
						name: input.name ?? null,
						conditions: input.conditions,
						actions: input.actions,
					},
				}),
			);
		},

		/**
		 * Applies the rule to existing transactions, as a confirmed « Appliquer »
		 * does, recording one run.
		 */
		async applyRule(ruleId: string) {
			// Bodiless, so it needs the `Origin` a browser would add.
			const response = await request.post(`/api/rules/${ruleId}/apply`, { headers: sameOrigin });

			expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
		},

		/**
		 * Deletes every rule, so none outlives the test that created it. Their
		 * runs stay, as they would for the user, with no rule to point at: a
		 * test reads runs by a rule name or a label of its own.
		 */
		async deleteRules() {
			const response = await request.get("/api/rules");

			expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
			const { data } = ruleListBody.parse(await response.json());

			// One after the other: each is an `immediate` write.
			await data.reduce(async (previous, rule) => {
				await previous;
				// Bodiless, so it needs the `Origin` a browser would add.
				const deleted = await request.delete(`/api/rules/${rule.id}`, { headers: sameOrigin });

				expect(deleted.ok(), `${deleted.url()} answered ${await deleted.text()}`).toBe(true);
			}, Promise.resolve());
		},

		/** Links two transactions as a transfer, as a pick in « Rapprocher un virement » does. */
		async matchTransfer(transactionId: string, counterpartId: string): Promise<string> {
			return created(
				await request.post("/api/transfers", { data: { transactionId, counterpartId } }),
			);
		},

		/**
		 * Undoes the transfer `transactionId` sits in, as « Dissocier » does: for
		 * the pairs step 6 links on creation that a test needs apart.
		 */
		async unlinkTransfer(transactionId: string) {
			// An empty patch answers the row as it is, its transfer included.
			const row = await request.patch(`/api/transactions/${transactionId}`, { data: {} });

			expect(row.ok(), `${row.url()} answered ${await row.text()}`).toBe(true);
			const { data } = linkedBody.parse(await row.json());

			expect(data.transfer, `${transactionId} is in no transfer`).not.toBeNull();
			const response = await request.delete(`/api/transfers/${data.transfer?.id ?? ""}`, {
				headers: sameOrigin,
			});

			expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);
		},

		/**
		 * The dashboard's net worth, as the API computes it now: tests share one
		 * database, so they assert a change from it rather than a fixed amount.
		 */
		async netWorth(period: BalancePeriod = DEFAULT_BALANCE_PERIOD) {
			const response = await request.get(`/api/reports/net-worth?period=${period}`);

			expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);

			return netWorthBody.parse(await response.json()).data;
		},

		/** A group's total in minor units, zero when it holds no account. */
		async groupTotal(classification: "asset" | "liability"): Promise<number> {
			const response = await request.get("/api/accounts");

			expect(response.ok()).toBe(true);
			const { groups } = accountListBody.parse(await response.json()).data;

			return groups.find((group) => group.classification === classification)?.total ?? 0;
		},
	};
}

export type Api = ReturnType<typeof apiHelpers>;

export const test = base.extend<{ api: Api; clientAddress: void; outsideRequestGuard: void }>({
	api: async ({ request }, use) => {
		await use(apiHelpers(request));
	},

	// Each test's browser plays a distinct client behind a reverse proxy: the
	// suite's API trusts loopback, so this `x-forwarded-for` names the client,
	// as a real proxy's would. Sharing one address, the suite would run
	// past Better Auth's 100 calls per sliding ten seconds on `/api/auth/*`
	// (every page load asks for the session), and one test's sign-ins would
	// count against another's limit of three.
	clientAddress: [
		async ({ context }, use) => {
			await context.setExtraHTTPHeaders({
				"x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`,
			});
			await use();
		},
		{ auto: true },
	],

	// No test reaches the network (AD-16). A request to any other host is
	// aborted, then fails the test naming the URL, even if the page swallowed
	// the error.
	outsideRequestGuard: [
		async ({ context }, use) => {
			const outside: string[] = [];

			await context.route(
				(url) => url.hostname !== "localhost",
				async (route) => {
					outside.push(route.request().url());
					await route.abort("blockedbyclient");
				},
			);
			await use();
			expect(outside, `Requests outside localhost: ${outside.join(", ")}`).toEqual([]);
		},
		{ auto: true },
	],
});
