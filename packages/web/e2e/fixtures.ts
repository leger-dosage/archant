import type { APIRequestContext, APIResponse } from "@playwright/test";

import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { formatMoney, toMinorUnits } from "@archant/data/money";

import { ACCOUNT_KINDS } from "../src/lib/account-kinds.ts";
import { TIME_ZONE } from "./settings.ts";

export { expect };

type AccountKind = (typeof ACCOUNT_KINDS)[number]["id"];

export type OpenAccountOptions = {
	name?: string;
	kind?: AccountKind;
	/** As typed in the form: `1 234,56`. */
	openingBalance?: string;
	openingDate?: string;
};

export type Created = { id: string; name: string };

const createdBody = z.object({ data: z.object({ id: z.string() }) });

const accountListBody = z.object({
	data: z.object({
		groups: z.array(z.object({ classification: z.string(), total: z.number() })),
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

async function created(response: APIResponse): Promise<string> {
	expect(response.ok(), `${response.url()} answered ${await response.text()}`).toBe(true);

	return createdBody.parse(await response.json()).data.id;
}

function apiHelpers(request: APIRequestContext) {
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
					currency: "EUR",
					openingBalance: options.openingBalance ?? "1 000,00",
					openingDate: options.openingDate ?? daysAgo(30),
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

		async recordSnapshot(accountId: string, input: { date: string; balance: string }) {
			return created(await request.post(`/api/accounts/${accountId}/snapshots`, { data: input }));
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

export const test = base.extend<{ api: Api; outsideRequestGuard: void }>({
	api: async ({ request }, use) => {
		await use(apiHelpers(request));
	},

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
