import type { LoanDetailsInput } from "../schemas/accounts.ts";
import type { Auth } from "../services/auth.ts";

import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import { MAX_IMPORT_BYTES } from "../schemas/imports.ts";
import {
	balanceOf,
	balanceOnDay,
	buildApp,
	car,
	confirmedImport,
	creditAgricole,
	errorBody,
	expense,
	home,
	importBody,
	listBody,
	mortgage,
	openAccount,
	openPinned,
	own,
	ownClient,
	paddedOfx,
	pea,
	pinned,
	postSnapshot,
	postTransaction,
	recorded,
	request,
	snapshotsOf,
	temp,
	transactionsOf,
	upload,
	uploaded,
	valid,
	useSignedInApp,
} from "../testing/app.ts";
import { addViewer, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// Raw requests, for bodies the typed client would refuse to compile.
async function postRaw(body: unknown) {
	const response = await buildApp().request("/api/accounts", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

	return { status: response.status, body: errorBody.parse(await response.json()) };
}

// A loan whose terms are all unknown, as created without details.
const noTerms = {
	originalAmount: null,
	downPayment: null,
	startDate: null,
	termMonths: null,
	rateType: null,
	interestRate: null,
	insuranceRate: null,
	insuranceRateType: null,
	rateChanges: [],
	endDate: null,
};

// Every field of a PATCH's details, blank: it replaces them whole.
const blankTerms = {
	originalAmount: "",
	downPayment: "",
	startDate: "",
	termMonths: "",
	rateType: "",
	interestRate: "",
	insuranceRate: "",
	insuranceRateType: "",
	rateChanges: [],
} satisfies LoanDetailsInput;

// The owner's ING mortgage, as typed in the form (Epic 24's reference case).
const ingTerms = {
	originalAmount: "130 000,00",
	downPayment: "0",
	startDate: "2020-12-05",
	termMonths: "300",
	rateType: "fixed",
	interestRate: "1,82",
	insuranceRate: "0,2917",
	insuranceRateType: "level_term",
	rateChanges: [],
} satisfies LoanDetailsInput;

async function accountCount() {
	const list = z
		.object({ data: z.object({ groups: z.array(z.object({ accounts: z.array(z.unknown()) })) }) })
		.parse((await request("GET", "/api/accounts")).body);

	return list.data.groups.flatMap((group) => group.accounts).length;
}

/** The status of a creation the typed client would refuse to compile. */
async function postStatus(body: unknown) {
	const response = await buildApp().request("/api/accounts", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	return response.status;
}

describe("POST /api/accounts", () => {
	it("creates a checking account with its opening balance", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({ json: valid });

		expect(response.status).toBe(201);
		const { data } = await response.json();
		expect(data).toMatchObject({
			name: "Compte joint",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			balance: 123456,
		});
		expect(data.id).toMatch(/^[0-9a-f-]{36}$/u);
	});

	it("rejects a blank name with its field code", async () => {
		await expect(postRaw({ ...valid, name: "  " })).resolves.toEqual({
			status: 400,
			body: {
				error: {
					code: "VALIDATION_ERROR",
					message: "The request is invalid.",
					fields: [{ path: "name", code: "too_small" }],
				},
			},
		});
	});

	it.each([
		["12,3,4", "EUR"],
		["1,234", "JPY"],
	])("rejects the amount %j in %s", async (openingBalance, currency) => {
		const { status, body } = await postRaw({ ...valid, openingBalance, currency });

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "openingBalance", code: "invalid_amount" }]);
	});

	it("rejects an unknown currency", async () => {
		const { status, body } = await postRaw({ ...valid, currency: "XYZ" });

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "currency", code: "invalid_currency" }]);
	});

	it("rejects a subtype that does not match the type", async () => {
		const { body } = await postRaw({ ...valid, type: "credit_card" });

		expect(body.error.fields).toEqual([{ path: "subtype", code: "invalid_subtype" }]);
	});

	it("reports every invalid field at once", async () => {
		const { body } = await postRaw({ ...valid, name: "", openingBalance: "abc" });

		expect(body.error.fields).toEqual([
			{ path: "name", code: "too_small" },
			{ path: "openingBalance", code: "invalid_amount" },
		]);
	});

	it("rejects an opening date before 1900", async () => {
		const { status, body } = await postRaw({ ...valid, openingDate: "1899-12-31" });

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "openingDate", code: "date_too_early" }]);
	});

	it("creates a loan as a liability owing its outstanding balance, with empty details", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...mortgage },
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		expect(data).toMatchObject({ type: "loan", subtype: "mortgage", balance: 18000000 });
		const detail = await request("GET", `/api/accounts/${data.id}`);
		expect(detail.body).toMatchObject({
			data: { classification: "liability", balance: 18000000, details: noTerms },
		});
	});

	it("stores the ING mortgage's terms, rates in millionths", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...mortgage, details: ingTerms },
		});
		const { data } = await response.json();

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(
			z.object({ data: z.object({ details: z.unknown() }) }).parse(detail.body).data.details,
		).toEqual({
			originalAmount: 13000000,
			downPayment: 0,
			startDate: "2020-12-05",
			termMonths: 300,
			rateType: "fixed",
			interestRate: 18200,
			insuranceRate: 2917,
			insuranceRateType: "level_term",
			rateChanges: [],
			endDate: null,
		});
	});

	it.each([
		["3,45 %", 34500],
		["3,45%", 34500],
		["3.45 %", 34500],
		["4.1", 41000],
		["1,820", 18200],
		["0", 0],
		["100", 1000000],
	])("reads the interest rate %j as %i millionths", async (interestRate, millionths) => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...mortgage, details: { interestRate } },
		});
		const { data } = await response.json();

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({ data: { details: { interestRate: millionths } } });
	});

	it("reads the amounts in the loan's own currency", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: {
				...valid,
				...mortgage,
				currency: "JPY",
				openingBalance: "150 000",
				details: { originalAmount: "200 000", downPayment: "50 000" },
			},
		});
		const { data } = await response.json();
		const refused = await postRaw({
			...valid,
			...mortgage,
			currency: "JPY",
			openingBalance: "150 000",
			details: { originalAmount: "1,5", downPayment: "0,5" },
		});

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({
			data: { details: { originalAmount: 200000, downPayment: 50000 } },
		});
		expect(refused.body.error.fields).toEqual([
			{ path: "details.originalAmount", code: "invalid_amount" },
			{ path: "details.downPayment", code: "invalid_amount" },
		]);
	});

	it("leaves blank details unknown", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: {
				...valid,
				...mortgage,
				details: {
					originalAmount: " ",
					downPayment: "",
					startDate: "",
					termMonths: " ",
					rateType: "",
					interestRate: "",
					insuranceRate: "",
					insuranceRateType: "",
					rateChanges: [{ effectiveDate: "", rate: " " }],
				},
			},
		});
		const { data } = await response.json();

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({ data: { details: noTerms } });
	});

	it("ignores an end date, which the term replaces", async () => {
		const status = await postStatus({ ...valid, ...mortgage, details: { endDate: "2045-12-05" } });

		expect(status).toBe(201);
	});

	it.each(["1,8205", "3,4567", "-1", "101", "100,001", "abc", "1,2,3"])(
		"refuses the interest rate %j",
		async (interestRate) => {
			const { status, body } = await postRaw({ ...valid, ...mortgage, details: { interestRate } });

			expect(status).toBe(400);
			expect(body.error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "details.interestRate", code: "invalid_rate" }],
			});
		},
	);

	it("reads an insurance rate to four decimals, and refuses a fifth", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...mortgage, details: { insuranceRate: "0,2917 %" } },
		});
		const { data } = await response.json();
		const refused = await postRaw({
			...valid,
			...mortgage,
			details: { insuranceRate: "0,29175" },
		});

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({ data: { details: { insuranceRate: 2917 } } });
		expect(refused.body.error.fields).toEqual([
			{ path: "details.insuranceRate", code: "invalid_rate" },
		]);
	});

	it.each(["0", "-5", "abc", "1,234"])("refuses the amount borrowed %j", async (originalAmount) => {
		const { status, body } = await postRaw({ ...valid, ...mortgage, details: { originalAmount } });

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "details.originalAmount", code: "invalid_amount" }]);
	});

	it("accepts no down payment, and refuses a negative one", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...mortgage, details: { downPayment: "0" } },
		});
		const refused = await postRaw({ ...valid, ...mortgage, details: { downPayment: "-1" } });

		expect(response.status).toBe(201);
		expect(refused.body.error.fields).toEqual([
			{ path: "details.downPayment", code: "invalid_amount" },
		]);
	});

	it.each(["1", "1200", " 300 "])("accepts the term %j", async (termMonths) => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...mortgage, details: { termMonths } },
		});
		const { data } = await response.json();

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({ data: { details: { termMonths: Number(termMonths) } } });
	});

	it.each(["0", "1201", "12,5", "12.5", "-3", "abc", "00000"])(
		"refuses the term %j",
		async (termMonths) => {
			const { status, body } = await postRaw({ ...valid, ...mortgage, details: { termMonths } });

			expect(status).toBe(400);
			expect(body.error.fields).toEqual([{ path: "details.termMonths", code: "invalid_term" }]);
		},
	);

	it("refuses a start date that is not a date", async () => {
		const { body } = await postRaw({ ...valid, ...mortgage, details: { startDate: "2045-02-30" } });

		expect(body.error.fields).toEqual([{ path: "details.startDate", code: "invalid_date" }]);
	});

	it("refuses a start date after today in the household's time zone, nothing created", async () => {
		const before = await accountCount();
		const refused = await postRaw({ ...valid, ...mortgage, details: { startDate: "2026-09-22" } });
		const today = await postStatus({ ...valid, ...mortgage, details: { startDate: "2026-09-21" } });
		// 23:30 UTC is already the 22nd in Paris.
		vi.setSystemTime(new Date("2026-09-21T23:30:00Z"));
		const parisTomorrow = await postStatus({
			...valid,
			...mortgage,
			details: { startDate: "2026-09-22" },
		});

		expect(refused).toEqual({
			status: 400,
			body: {
				error: {
					code: "VALIDATION_ERROR",
					message: "The request is invalid.",
					fields: [{ path: "details.startDate", code: "invalid_date" }],
				},
			},
		});
		expect(today).toBe(201);
		expect(parisTomorrow).toBe(201);
		await expect(accountCount()).resolves.toBe(before + 2);
	});

	it("stores the rate changes sorted, skipping an empty row and keeping a date's last rate", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: {
				...valid,
				...mortgage,
				details: {
					startDate: "2020-12-05",
					rateType: "variable",
					interestRate: "1,5",
					rateChanges: [
						{ effectiveDate: "2025-01-01", rate: "2" },
						{ effectiveDate: "", rate: "" },
						{ effectiveDate: "2023-06-01", rate: "1,75 %" },
						{ effectiveDate: "2025-01-01", rate: "3" },
					],
				},
			},
		});
		const { data } = await response.json();

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({
			data: {
				details: {
					rateType: "variable",
					rateChanges: [
						{ effectiveDate: "2023-06-01", rate: 17500 },
						{ effectiveDate: "2025-01-01", rate: 30000 },
					],
				},
			},
		});
	});

	it.each([
		{ effectiveDate: "2025-01-01", rate: "" },
		{ effectiveDate: "", rate: "2" },
		{ effectiveDate: "2025-02-30", rate: "2" },
		{ effectiveDate: "2025-01-01", rate: "101" },
		{ effectiveDate: "2025-01-01", rate: "2,0001" },
	])("refuses the rate change %j", async (row) => {
		const { status, body } = await postRaw({
			...valid,
			...mortgage,
			details: {
				startDate: "2020-12-05",
				rateType: "variable",
				rateChanges: [{ effectiveDate: "2024-01-01", rate: "2" }, row],
			},
		});

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([
			{ path: "details.rateChanges", code: "invalid_rate_change" },
		]);
	});

	it("refuses a rate change before the start date, or before the opening date without one", async () => {
		const beforeStart = await postRaw({
			...valid,
			...mortgage,
			details: {
				startDate: "2020-12-05",
				rateType: "variable",
				rateChanges: [{ effectiveDate: "2020-01-01", rate: "2" }],
			},
		});
		const beforeOpening = await postRaw({
			...valid,
			...mortgage,
			details: {
				rateType: "adjustable",
				rateChanges: [{ effectiveDate: "2026-08-31", rate: "2" }],
			},
		});
		const onOrigination = await postStatus({
			...valid,
			...mortgage,
			details: {
				startDate: "2020-12-05",
				rateType: "variable",
				rateChanges: [{ effectiveDate: "2020-12-05", rate: "2" }],
			},
		});

		for (const refused of [beforeStart, beforeOpening]) {
			expect(refused.body.error.fields).toEqual([
				{ path: "details.rateChanges", code: "rate_change_before_origination" },
			]);
		}
		expect(onOrigination).toBe(201);
	});

	it("keeps a fixed loan's rate changes without checking them against origination", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: {
				...valid,
				...mortgage,
				details: {
					startDate: "2020-12-05",
					rateType: "fixed",
					rateChanges: [{ effectiveDate: "2020-01-01", rate: "2" }],
				},
			},
		});
		const { data } = await response.json();

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({
			data: { details: { rateChanges: [{ effectiveDate: "2020-01-01", rate: 20000 }] } },
		});
	});

	it.each(["fixed", ""] as const)(
		"drops an invalid rate change of a %j rate, whose rows are hidden, and keeps the valid one",
		async (rateType) => {
			const response = await testClient(buildApp()).api.accounts.$post({
				json: {
					...valid,
					...mortgage,
					details: {
						rateType,
						rateChanges: [
							{ effectiveDate: "2025-01-01", rate: "" },
							{ effectiveDate: "2024-01-01", rate: "2" },
						],
					},
				},
			});

			expect(response.status).toBe(201);
			const { data } = await response.json();
			const detail = await request("GET", `/api/accounts/${data.id}`);
			expect(detail.body).toMatchObject({
				data: { details: { rateChanges: [{ effectiveDate: "2024-01-01", rate: 20000 }] } },
			});
		},
	);

	it("refuses more rate changes than a schedule has months", async () => {
		const { status, body } = await postRaw({
			...valid,
			...mortgage,
			details: {
				rateChanges: Array.from({ length: 1201 }, () => ({ effectiveDate: "", rate: "" })),
			},
		});

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "details.rateChanges", code: "too_big" }]);
	});

	it("refuses an unknown rate type or insurance type", async () => {
		const { status, body } = await postRaw({
			...valid,
			...mortgage,
			details: { rateType: "floating", insuranceRateType: "flat" },
		});

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([
			{ path: "details.rateType", code: "invalid_value" },
			{ path: "details.insuranceRateType", code: "invalid_value" },
		]);
	});

	it("refuses loan details on a card", async () => {
		const { status, body } = await postRaw({
			...valid,
			type: "credit_card",
			subtype: null,
			details: { interestRate: "3" },
		});

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "details", code: "invalid_details" }]);
	});

	it("creates a PEA as an asset worth its opening balance, without details", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...pea },
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		expect(data).toMatchObject({ type: "investment", subtype: "pea", balance: 2500000 });
		const detail = await request("GET", `/api/accounts/${data.id}`);
		expect(detail.body).toMatchObject({
			data: { classification: "asset", balance: 2500000, details: null },
		});
	});

	it("refuses an investment without a subtype or with another type's", async () => {
		const responses = await Promise.all(
			["savings", null].map(async (subtype) => postRaw({ ...valid, ...pea, subtype })),
		);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(body.error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "subtype", code: "invalid_subtype" }],
			});
		}
	});

	it("refuses details on an investment", async () => {
		const { status, body } = await postRaw({ ...valid, ...pea, details: { interestRate: "3" } });

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "details", code: "invalid_details" }]);
	});

	it("creates a home as an asset worth its estimated value, without details", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...home, openingDate: "2026-01-10" },
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		expect(data).toMatchObject({
			type: "property",
			subtype: "single_family_home",
			balance: 32000000,
		});
		const detail = await request("GET", `/api/accounts/${data.id}`);
		expect(detail.body).toMatchObject({
			data: { classification: "asset", balance: 32000000, details: null },
		});
	});

	it("creates a vehicle without a subtype as an asset worth its estimated value", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...car },
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		expect(data).toMatchObject({ type: "vehicle", subtype: null, balance: 1850000 });
		const detail = await request("GET", `/api/accounts/${data.id}`);
		expect(detail.body).toMatchObject({
			data: { classification: "asset", balance: 1850000, details: null },
		});
	});

	it("refuses a property without a subtype or with another type's, and a vehicle with one", async () => {
		const responses = await Promise.all([
			postRaw({ ...valid, ...home, subtype: null }),
			postRaw({ ...valid, ...home, subtype: "pea" }),
			postRaw({ ...valid, ...car, subtype: "car" }),
		]);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(body.error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "subtype", code: "invalid_subtype" }],
			});
		}
	});

	it("refuses details on a property and on a vehicle", async () => {
		const responses = await Promise.all(
			[home, car].map(async (account) =>
				postRaw({ ...valid, ...account, details: { originalAmount: "300 000,00" } }),
			),
		);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(body.error.fields).toEqual([{ path: "details", code: "invalid_details" }]);
		}
	});

	it("answers a body that is not JSON with VALIDATION_ERROR", async () => {
		const { status, body } = await postRaw("{");

		expect(status).toBe(400);
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});
});

describe("GET /api/accounts", () => {
	it("groups assets and liabilities with totals in the reporting currency", async () => {
		const client = await ownClient();
		await client.$post({ json: valid });
		await client.$post({
			json: { ...valid, name: "Livret A", subtype: "savings", openingBalance: "100" },
		});
		await client.$post({
			json: {
				...valid,
				name: "Épargne US",
				subtype: "savings",
				currency: "USD",
				openingBalance: "10.00",
			},
		});
		await client.$post({
			json: {
				...valid,
				name: "Carte",
				type: "credit_card",
				subtype: null,
				openingBalance: "490,30",
			},
		});

		const response = await client.$get();
		const { data } = await response.json();

		expect(response.status).toBe(200);
		expect(data.reportingCurrency).toBe("EUR");
		const [assets, liabilities] = data.groups;
		expect(assets?.classification).toBe("asset");
		expect(assets?.accounts.map((account) => account.name)).toEqual([
			"Compte joint",
			"Épargne US",
			"Livret A",
		]);
		expect(assets?.total).toBe(123456 + 10000);
		expect(assets?.excludedCount).toBe(1);
		expect(liabilities).toMatchObject({
			classification: "liability",
			total: 49030,
			excludedCount: 0,
			accounts: [{ name: "Carte", balance: 49030, currency: "EUR" }],
		});
	});

	it("lists today's balance by the Paris date, already the next day at 23:30 UTC", async () => {
		vi.setSystemTime(new Date("2026-09-21T23:30:00Z"));
		const client = await ownClient();
		await client.$post({ json: { ...valid, openingDate: "2026-09-22" } });

		const { data } = await (await client.$get()).json();

		expect(data.groups[0]?.accounts[0]?.balance).toBe(123456);
	});

	it("lists an account opening after today at zero", async () => {
		const client = await ownClient();
		await client.$post({ json: { ...valid, openingDate: "2026-09-30" } });

		const { data } = await (await client.$get()).json();

		expect(data.groups[0]?.accounts[0]?.balance).toBe(0);
		expect(data.groups[0]?.total).toBe(0);
	});
});

describe("GET /api/accounts/:id", () => {
	it("returns the account with its classification and opening date", async () => {
		const account = await openAccount();

		const response = await testClient(buildApp()).api.accounts[":id"].$get({
			param: { id: account.id },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			id: account.id,
			name: "Compte joint",
			classification: "asset",
			openingDate: "2026-09-01",
			balance: 123456,
			details: null,
			bankConnection: null,
		});
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await request("GET", "/api/accounts/nope");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("POST /api/accounts/:id/transactions", () => {
	it("records an expense in the account's currency and moves the balance", async () => {
		const account = await openAccount();

		const response = await testClient(buildApp()).api.accounts[":id"].transactions.$post({
			param: { id: account.id },
			json: expense,
		});

		expect(response.status).toBe(201);
		expect((await response.json()).data).toMatchObject({
			accountId: account.id,
			date: "2026-09-10",
			label: "Boulangerie",
			amount: -4290,
			currency: "EUR",
			notes: null,
			source: { kind: "manual" },
		});
		await expect(balanceOf(account.id)).resolves.toBe(119166);
	});

	it("raises a card's amount owed on a purchase", async () => {
		const card = await openAccount({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: "490,30",
		});

		const { status } = await postTransaction(card.id, { ...expense, amount: "-30,00" });

		expect(status).toBe(201);
		await expect(balanceOf(card.id)).resolves.toBe(52030);
	});

	it("trims the label, stores blank notes as null and accepts a zero amount", async () => {
		const account = await openAccount();

		const { status, body } = await postTransaction(account.id, {
			...expense,
			label: "  Boulangerie  ",
			amount: "0",
			notes: "   ",
		});

		expect(status).toBe(201);
		expect(body).toMatchObject({ data: { label: "Boulangerie", amount: 0, notes: null } });
	});

	it.each(["2026-09-01", "2026-08-31"])(
		"refuses a transaction dated %s, on or before the opening date",
		async (date) => {
			const account = await openAccount();

			const { status, body } = await postTransaction(account.id, { ...expense, date });

			expect(status).toBe(400);
			expect(errorBody.parse(body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "date", code: "not_after_opening_date" }],
			});
		},
	);

	it("refuses a date more than 366 days after today", async () => {
		const account = await openAccount();

		const { status, body } = await postTransaction(account.id, {
			...expense,
			date: "2027-10-26",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "date", code: "date_too_late" }]);
	});

	it("reports a blank label and a bad amount together", async () => {
		const account = await openAccount();

		const { status, body } = await postTransaction(account.id, {
			...expense,
			label: "  ",
			amount: "12,3,4",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "label", code: "too_small" },
			{ path: "amount", code: "invalid_amount" },
		]);
	});

	it("refuses a label over 200 characters and notes over 2 000", async () => {
		const account = await openAccount();

		const { body } = await postTransaction(account.id, {
			...expense,
			label: "a".repeat(201),
			notes: "a".repeat(2001),
		});

		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "label", code: "too_big" },
			{ path: "notes", code: "too_big" },
		]);
	});

	it("refuses a body whose fields are not text", async () => {
		const account = await openAccount();

		const { status, body } = await request("POST", `/api/accounts/${account.id}/transactions`, {
			...expense,
			amount: -42.9,
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "amount", code: "invalid_type" }]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status } = await postTransaction("nope", expense);

		expect(status).toBe(404);
	});
});

describe("GET /api/accounts/:id/transactions", () => {
	it("lists most recent first, 50 per page by default", async () => {
		const account = await ownClient();
		const created = await (await account.$post({ json: valid })).json();
		const id = created.data.id;
		const client = testClient(buildApp(own?.db)).api.accounts[":id"].transactions;
		await client.$post({ param: { id }, json: { ...expense, label: "A" } });
		vi.setSystemTime(new Date("2026-09-21T10:00:01Z"));
		await client.$post({ param: { id }, json: { ...expense, label: "B" } });
		await client.$post({ param: { id }, json: { ...expense, date: "2026-09-02", label: "C" } });

		const response = await client.$get({ param: { id }, query: {} });
		const { data } = await response.json();

		expect(response.status).toBe(200);
		expect(data.items.map((item) => item.label)).toEqual(["B", "A", "C"]);
		expect(data.items[0]).toMatchObject({ accountType: "depository", recurring: false });
		expect(data).toMatchObject({ page: 1, pageSize: 50, total: 3 });

		const second = await (
			await client.$get({ param: { id }, query: { page: "2", pageSize: "2" } })
		).json();
		expect(second.data.items.map((item) => item.label)).toEqual(["C"]);
	});

	it("adds the parents of the page's split children", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, { ...expense, amount: "-100,00" });
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		await request("POST", `/api/transactions/${data.id}/split`, {
			lines: [
				{ label: "Fruits", amount: "-60,00", categoryId: null },
				{ label: "Savon", amount: "-40,00", categoryId: null },
			],
		});

		const page = await transactionsOf(account.id);

		expect(page.items.map((item) => [item.parentEntryId, item.splitParent])).toEqual([
			[data.id, false],
			[data.id, false],
		]);
		expect(page.splitParents).toMatchObject([{ id: data.id, splitParent: true, excluded: true }]);
		expect(page.total).toBe(2);
	});

	it.each([
		["page=0", "page"],
		["pageSize=201", "pageSize"],
	])("refuses %s", async (query, path) => {
		const account = await openAccount();

		const { status, body } = await request(
			"GET",
			`/api/accounts/${account.id}/transactions?${query}`,
		);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields?.[0]?.path).toBe(path);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await request("GET", "/api/accounts/nope/transactions");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

async function balancesOf(accountId: string, period?: "1M" | "3M" | "6M" | "1Y" | "all") {
	const response = await testClient(buildApp()).api.accounts[":id"].balances.$get({
		param: { id: accountId },
		query: period === undefined ? {} : { period },
	});

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("GET /api/accounts/:id/balances", () => {
	it("returns one point per day of the last month by default", async () => {
		const account = await openAccount({ openingDate: "2026-01-10" });

		const data = await balancesOf(account.id);

		expect(data).toMatchObject({
			period: "1M",
			from: "2026-08-21",
			to: "2026-09-21",
			currency: "EUR",
			change: { amount: 0, percent: 0 },
		});
		expect(data.points).toHaveLength(32);
		expect(data.points[0]).toEqual({ date: "2026-08-21", balance: 123456 });
		expect(data.points.at(-1)).toEqual({ date: "2026-09-21", balance: 123456 });
	});

	it("fills every day up to today when nothing was written for a month", async () => {
		const account = await openAccount({ openingDate: "2026-08-01" });
		vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));

		const data = await balancesOf(account.id);

		expect(data).toMatchObject({ from: "2026-09-21", to: "2026-10-21" });
		expect(data.points).toHaveLength(31);
		expect(data.points.at(-1)).toEqual({ date: "2026-10-21", balance: 123456 });
		expect(data.change).toEqual({ amount: 0, percent: 0 });
	});

	it("ends the period on today's Paris date, already the next day at 23:30 UTC", async () => {
		vi.setSystemTime(new Date("2026-09-21T23:30:00Z"));
		const account = await openAccount({ openingDate: "2026-09-01" });

		const data = await balancesOf(account.id);

		expect(data.to).toBe("2026-09-22");
		expect(data.points.at(-1)).toEqual({ date: "2026-09-22", balance: 123456 });
	});

	it("starts at the opening balance when the account is younger than the period", async () => {
		const account = await openAccount({ openingDate: "2026-09-01" });
		await postTransaction(account.id, { ...expense, amount: "12,40" });

		const data = await balancesOf(account.id, "6M");

		expect(data.from).toBe("2026-09-01");
		expect(data.points[0]).toEqual({ date: "2026-09-01", balance: 123456 });
		expect(data.change).toEqual({ amount: 1240, percent: 1 });
	});

	it("covers every day since the opening date for all", async () => {
		const account = await openAccount({ openingDate: "2024-02-29" });

		const data = await balancesOf(account.id, "all");

		expect(data.from).toBe("2024-02-29");
		// 2024-02-29 to 2026-09-21: 307 days left in 2024, 365 in 2025, 264 in 2026.
		expect(data.points).toHaveLength(936);
	});

	it("clamps the start of a month to the end of a shorter one", async () => {
		vi.setSystemTime(new Date("2026-03-31T10:00:00Z"));
		const account = await openAccount({ openingDate: "2026-01-01" });

		const data = await balancesOf(account.id, "1M");

		expect(data.from).toBe("2026-02-28");
		expect(data.points[0]?.date).toBe("2026-02-28");
	});

	it("stops at today, leaving out the rows of a future transaction", async () => {
		const account = await openAccount();
		await postTransaction(account.id, { ...expense, date: "2026-10-01" });

		const data = await balancesOf(account.id, "1M");

		expect(data.points.at(-1)).toEqual({ date: "2026-09-21", balance: 123456 });
	});

	it("plots a card's amount owed, positive, rising with a purchase", async () => {
		const card = await openAccount({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: "490,30",
		});
		await postTransaction(card.id, { ...expense, date: "2026-09-21", amount: "-30,00" });

		const data = await balancesOf(card.id);

		expect(data.points.at(-1)?.balance).toBe(52030);
		expect(data.change?.amount).toBe(3000);
	});

	it("gives no percentage when the period starts at zero", async () => {
		const account = await openAccount({ openingBalance: "0" });
		await postTransaction(account.id, { ...expense, amount: "100,00" });

		const data = await balancesOf(account.id);

		expect(data.change).toEqual({ amount: 10000, percent: null });
	});

	it("is empty for an account opening after today", async () => {
		const account = await openAccount({ openingDate: "2026-09-30" });

		const data = await balancesOf(account.id, "all");

		expect(data).toMatchObject({ from: null, to: "2026-09-21", points: [], change: null });
	});

	it("refuses an unknown period", async () => {
		const account = await openAccount();

		const { status, body } = await request("GET", `/api/accounts/${account.id}/balances?period=2W`);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "period", code: "invalid_value" }],
		});
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await request("GET", "/api/accounts/nope/balances");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("POST /api/accounts/:id/snapshots", () => {
	it("pins what a loan owes on its date; a later repayment lowers it from there", async () => {
		const loan = await openAccount({ ...mortgage, openingDate: "2026-01-10" });

		await recorded(loan.id, { date: "2026-03-05", balance: "175 000,00" });
		await postTransaction(loan.id, { date: "2026-03-06", label: "Échéance", amount: "1 200,00" });

		await expect(balanceOnDay(loan.id, "2026-03-04")).resolves.toBe(18000000);
		await expect(balanceOnDay(loan.id, "2026-03-05")).resolves.toBe(17500000);
		await expect(balanceOnDay(loan.id, "2026-03-06")).resolves.toBe(17380000);
		await expect(balanceOf(loan.id)).resolves.toBe(17380000);
	});

	it("pins a PEA's value on its date, which the following days keep", async () => {
		const account = await openAccount({ ...pea, openingDate: "2026-01-10" });

		await recorded(account.id, { date: "2026-03-05", balance: "26 300,00" });

		await expect(balanceOnDay(account.id, "2026-03-04")).resolves.toBe(2500000);
		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(2630000);
		await expect(balanceOnDay(account.id, "2026-03-06")).resolves.toBe(2630000);
		await expect(balanceOf(account.id)).resolves.toBe(2630000);
	});

	it("pins a home's new estimated value on its date, without recording a transaction", async () => {
		const account = await openAccount({ ...home, openingDate: "2026-01-10" });

		await recorded(account.id, { date: "2026-06-01", balance: "335 000,00" });

		await expect(balanceOnDay(account.id, "2026-05-31")).resolves.toBe(32000000);
		await expect(balanceOnDay(account.id, "2026-06-01")).resolves.toBe(33500000);
		await expect(balanceOnDay(account.id, "2026-06-02")).resolves.toBe(33500000);
		await expect(balanceOf(account.id)).resolves.toBe(33500000);
		const transactions = await request("GET", `/api/accounts/${account.id}/transactions`);
		expect(transactions.body).toMatchObject({ data: { items: [], total: 0 } });
	});

	it("pins the balance on its date; the next day continues from it", async () => {
		const account = await openPinned();

		const response = await testClient(buildApp()).api.accounts[":id"].snapshots.$post({
			param: { id: account.id },
			json: { date: "2026-03-05", balance: "2 000,00" },
		});
		await postTransaction(account.id, { date: "2026-03-06", label: "Pain", amount: "-50,00" });

		expect(response.status).toBe(201);
		expect((await response.json()).data).toMatchObject({
			accountId: account.id,
			date: "2026-03-05",
			balance: 200000,
			computed: 138000,
			gap: 62000,
			currency: "EUR",
		});
		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(200000);
		await expect(balanceOnDay(account.id, "2026-03-06")).resolves.toBe(195000);
		await expect(balanceOf(account.id)).resolves.toBe(195000);
	});

	it("keeps the day at the snapshot when a transaction lands on it, and widens the gap", async () => {
		const account = await openPinned();
		await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		await postTransaction(account.id, { date: "2026-03-05", label: "Pain", amount: "-30,00" });

		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(200000);
		const { items } = await snapshotsOf(account.id);
		expect(items[0]).toMatchObject({ balance: 200000, computed: 135000, gap: 65000 });
	});

	it("replaces the snapshot of the same date, keeping its id", async () => {
		const account = await openPinned();
		const first = await postSnapshot(account.id, { date: "2026-03-05", balance: "2 000,00" });
		const { id } = z.object({ data: z.object({ id: z.string() }) }).parse(first.body).data;

		const second = await postSnapshot(account.id, { date: "2026-03-05", balance: "1 990,00" });

		expect(first.body).toMatchObject({ data: { replacedExisting: false } });
		expect(second.body).toMatchObject({ data: { id, balance: 199000, replacedExisting: true } });
		const list = await snapshotsOf(account.id);
		expect(list.total).toBe(1);
		expect(list.items).toHaveLength(1);
	});

	it("stores a card's amount owed and an overdraft as typed", async () => {
		const card = await openAccount({
			...pinned,
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: "490,30",
		});
		const checking = await openPinned();

		const owed = await recorded(card.id, { date: "2026-03-05", balance: "520,00" });
		const overdraft = await recorded(checking.id, { date: "2026-03-05", balance: "-80,00" });

		expect(owed).toMatchObject({ balance: 52000, computed: 49030, gap: 52000 - 49030 });
		expect(overdraft).toMatchObject({ balance: -8000 });
	});

	it("refuses the opening date and tomorrow on the date field", async () => {
		const account = await openPinned();

		const opening = await postSnapshot(account.id, { date: "2026-01-10", balance: "1,00" });
		const tomorrow = await postSnapshot(account.id, { date: "2026-09-22", balance: "1,00" });

		expect(opening.status).toBe(400);
		expect(errorBody.parse(opening.body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "date", code: "not_after_opening_date" }],
		});
		expect(tomorrow.status).toBe(400);
		expect(errorBody.parse(tomorrow.body).error.fields).toEqual([
			{ path: "date", code: "date_in_future" },
		]);
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("refuses a balance with too many decimals for the currency", async () => {
		const account = await openPinned();

		const { status, body } = await postSnapshot(account.id, {
			date: "2026-03-05",
			balance: "12,345",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "balance", code: "invalid_amount" },
		]);
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("refuses a missing balance and a malformed date", async () => {
		const account = await openPinned();

		const missing = await request("POST", `/api/accounts/${account.id}/snapshots`, {
			date: "2026-03-05",
		});
		const malformed = await postSnapshot(account.id, { date: "05/03/2026", balance: "1,00" });

		expect(missing.status).toBe(400);
		expect(errorBody.parse(missing.body).error.fields).toEqual([
			{ path: "balance", code: "invalid_type" },
		]);
		expect(malformed.status).toBe(400);
		expect(errorBody.parse(malformed.body).error.fields).toEqual([
			{ path: "date", code: "invalid_format" },
		]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await postSnapshot("nope", { date: "2026-03-05", balance: "1,00" });

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("GET /api/accounts/:id/snapshots", () => {
	it("lists snapshots most recent first, paged", async () => {
		const account = await openPinned();
		const older = await recorded(account.id, { date: "2026-02-20", balance: "1 900,00" });
		const newer = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const response = await testClient(buildApp()).api.accounts[":id"].snapshots.$get({
			param: { id: account.id },
			query: { page: "2", pageSize: "1" },
		});
		const all = await snapshotsOf(account.id);

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({
			items: [older],
			page: 2,
			pageSize: 1,
			total: 2,
		});
		expect(all.items.map((item) => item.id)).toEqual([newer.id, older.id]);
		expect(all).toMatchObject({ page: 1, pageSize: 50 });
	});

	it("refuses a page size over the maximum", async () => {
		const account = await openPinned();

		const { status } = await request("GET", `/api/accounts/${account.id}/snapshots?pageSize=201`);

		expect(status).toBe(400);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status } = await request("GET", "/api/accounts/nope/snapshots");

		expect(status).toBe(404);
	});
});

// The I/O matrix of Story 1.6.
const accountBody = z.object({
	data: z.object({
		id: z.string(),
		name: z.string(),
		subtype: z.string().nullable(),
		balance: z.number(),
		active: z.boolean(),
		excludedFromReports: z.boolean(),
	}),
});

async function patchAccount(accountId: string, body: unknown) {
	return request("PATCH", `/api/accounts/${accountId}`, body);
}

async function listOwnAccounts(client: Awaited<ReturnType<typeof ownClient>>) {
	return (await (await client.$get()).json()).data;
}

describe("PATCH /api/accounts/:id", () => {
	it("trims and saves a new name, which the transaction list follows", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);

		const response = await testClient(buildApp()).api.accounts[":id"].$patch({
			param: { id: account.id },
			json: { name: " Livret A " },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			id: account.id,
			name: "Livret A",
			subtype: "checking",
			openingDate: "2026-09-01",
			active: true,
			excludedFromReports: false,
		});
		const { body } = await request("GET", `/api/transactions?account=${account.id}`);
		expect(listBody.parse(body).data.items[0]?.accountName).toBe("Livret A");
	});

	it("moves a checking account to savings and leaves its balance alone", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);

		const { status, body } = await patchAccount(account.id, { subtype: "savings" });

		expect(status).toBe(200);
		expect(accountBody.parse(body).data).toMatchObject({ subtype: "savings", balance: 119166 });
	});

	it("refuses a subtype the type does not allow and saves nothing", async () => {
		const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });

		const { status, body } = await patchAccount(card.id, { subtype: "savings", name: "Autre" });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "subtype", code: "invalid_subtype" }],
		});
		const detail = await request("GET", `/api/accounts/${card.id}`);
		expect(accountBody.parse(detail.body).data).toMatchObject({ name: "Carte", subtype: null });
	});

	it("refuses a subtype no type has as invalid_subtype", async () => {
		const vehicle = await openAccount(car);

		const { status, body } = await patchAccount(vehicle.id, { subtype: "car" });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "subtype", code: "invalid_subtype" }],
		});
	});

	it("refuses a depository account without a subtype", async () => {
		const account = await openAccount();

		const { status, body } = await patchAccount(account.id, { subtype: null });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "subtype", code: "invalid_subtype" },
		]);
	});

	it("refuses an empty patch", async () => {
		const account = await openAccount();

		const { status, body } = await patchAccount(account.id, {});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.code).toBe("VALIDATION_ERROR");
	});

	it("ignores fields that cannot be edited, which leaves an empty patch", async () => {
		const account = await openAccount();

		const { status } = await patchAccount(account.id, { currency: "USD", type: "credit_card" });

		expect(status).toBe(400);
		const detail = await request("GET", `/api/accounts/${account.id}`);
		expect(accountBody.parse(detail.body).data).toMatchObject({ subtype: "checking" });
	});

	it("refuses a blank or too long name, and flags that are not booleans", async () => {
		const account = await openAccount();

		const { body } = await patchAccount(account.id, {
			name: "  ",
			active: "no",
			excludedFromReports: 1,
		});
		const tooLong = await patchAccount(account.id, { name: "a".repeat(101) });

		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "name", code: "too_small" },
			{ path: "active", code: "invalid_type" },
			{ path: "excludedFromReports", code: "invalid_type" },
		]);
		expect(errorBody.parse(tooLong.body).error.fields).toEqual([{ path: "name", code: "too_big" }]);
	});

	it("replaces a loan's details, a blank field clearing its value", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });

		const { status, body } = await patchAccount(loan.id, {
			details: { ...blankTerms, originalAmount: "130 000,00", interestRate: "1,9" },
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({
			data: { details: { ...noTerms, originalAmount: 13000000, interestRate: 19000 } },
		});
	});

	it("drops a migrated loan's end date when its details are saved", async () => {
		const loan = await openAccount({ ...mortgage });
		await temp.db.run(
			sql`update accounts set details = json_set(details, '$.interestRate', 34500, '$.endDate', '2045-12-05') where id = ${loan.id}`,
		);

		const before = await request("GET", `/api/accounts/${loan.id}`);
		const { body } = await patchAccount(loan.id, {
			details: { ...blankTerms, termMonths: "300", interestRate: "3,45" },
		});

		expect(before.body).toMatchObject({ data: { details: { endDate: "2045-12-05" } } });
		expect(body).toMatchObject({
			data: { details: { termMonths: 300, interestRate: 34500, endDate: null } },
		});
	});

	it("keeps a variable loan's rate changes when it is saved as fixed", async () => {
		const loan = await openAccount({
			...mortgage,
			details: {
				...ingTerms,
				rateType: "variable",
				rateChanges: [{ effectiveDate: "2024-01-05", rate: "2,5" }],
			},
		});

		const { body } = await patchAccount(loan.id, {
			details: {
				...ingTerms,
				rateType: "fixed",
				rateChanges: [{ effectiveDate: "2024-01-05", rate: "2,5" }],
			},
		});

		expect(body).toMatchObject({
			data: {
				details: { rateType: "fixed", rateChanges: [{ effectiveDate: "2024-01-05", rate: 25000 }] },
			},
		});
	});

	it("checks a rate change against the account's opening date when no start date is given", async () => {
		const loan = await openAccount({ ...mortgage, openingDate: "2020-12-05" });

		const refused = await patchAccount(loan.id, {
			details: {
				...blankTerms,
				rateType: "variable",
				rateChanges: [{ effectiveDate: "2020-12-04", rate: "2" }],
			},
		});
		const saved = await patchAccount(loan.id, {
			details: {
				...blankTerms,
				rateType: "variable",
				rateChanges: [{ effectiveDate: "2020-12-05", rate: "2" }],
			},
		});

		expect(errorBody.parse(refused.body).error.fields).toEqual([
			{ path: "details.rateChanges", code: "rate_change_before_origination" },
		]);
		expect(saved.status).toBe(200);
	});

	it("refuses a start date after today, saving nothing", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });

		const { status, body } = await patchAccount(loan.id, {
			details: { ...ingTerms, startDate: "2026-09-22", termMonths: "0" },
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "details.termMonths", code: "invalid_term" },
			{ path: "details.startDate", code: "invalid_date" },
		]);
		const detail = await request("GET", `/api/accounts/${loan.id}`);
		expect(detail.body).toMatchObject({
			data: { details: { startDate: "2020-12-05", termMonths: 300 } },
		});
	});

	it("refuses details on a non-loan, and an invalid one on a loan, saving nothing", async () => {
		const account = await openAccount();
		const loan = await openAccount({ ...mortgage, details: { interestRate: "3,45" } });

		const onChecking = await patchAccount(account.id, {
			details: { ...blankTerms, interestRate: "3" },
		});
		const onLoan = await patchAccount(loan.id, {
			name: "Autre",
			details: { ...blankTerms, interestRate: "3,4567", originalAmount: "0" },
		});

		expect(onChecking.status).toBe(400);
		expect(errorBody.parse(onChecking.body).error.fields).toEqual([
			{ path: "details", code: "invalid_details" },
		]);
		expect(onLoan.status).toBe(400);
		expect(errorBody.parse(onLoan.body).error.fields).toEqual([
			{ path: "details.originalAmount", code: "invalid_amount" },
			{ path: "details.interestRate", code: "invalid_rate" },
		]);
		const detail = await request("GET", `/api/accounts/${loan.id}`);
		expect(detail.body).toMatchObject({
			data: { name: "Prêt immobilier", details: { interestRate: 34500 } },
		});
	});

	it("refuses partial details, which would clear the fields left out", async () => {
		const loan = await openAccount({ ...mortgage, details: { originalAmount: "200 000,00" } });

		const { status, body } = await patchAccount(loan.id, { details: { interestRate: "3" } });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.code).toBe("VALIDATION_ERROR");
		const detail = await request("GET", `/api/accounts/${loan.id}`);
		expect(detail.body).toMatchObject({ data: { details: { originalAmount: 20000000 } } });
	});

	it("reads a JPY loan's amount borrowed in yen", async () => {
		const loan = await openAccount({ ...mortgage, currency: "JPY", openingBalance: "150 000" });

		const saved = await patchAccount(loan.id, {
			details: { ...blankTerms, originalAmount: "200 000" },
		});
		const refused = await patchAccount(loan.id, {
			details: { ...blankTerms, originalAmount: "1,5" },
		});

		expect(saved.body).toMatchObject({ data: { details: { originalAmount: 200000 } } });
		expect(refused.status).toBe(400);
		expect(errorBody.parse(refused.body).error.fields).toEqual([
			{ path: "details.originalAmount", code: "invalid_amount" },
		]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await patchAccount("nope", { name: "Livret A" });

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("a viewer on a loan", () => {
	let viewerCookie: string;
	let auth: Auth;
	const silent = createLogger("silent");

	// One viewer sign-in for the block: Better Auth allows three per ten seconds.
	beforeAll(async () => {
		auth = createTestAuth(temp.db, silent);
		viewerCookie = await addViewer(buildTestApp(temp.db, silent, auth), auth);
	});

	it("reads its terms, and is refused FORBIDDEN on an edit, nothing written", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const read = await viewer.request(`/api/accounts/${loan.id}`);
		const edit = await viewer.request(`/api/accounts/${loan.id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ details: { ...ingTerms, interestRate: "2" } }),
		});

		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ data: { details: { interestRate: 18200 } } });
		expect(edit.status).toBe(403);
		expect(errorBody.parse(await edit.json()).error.code).toBe("FORBIDDEN");
		const detail = await request("GET", `/api/accounts/${loan.id}`);
		expect(detail.body).toMatchObject({ data: { details: { interestRate: 18200 } } });
	});

	it("reads its schedule", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const read = await viewer.request(`/api/accounts/${loan.id}/schedule`);

		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ data: { periodicPayment: 53_969 } });
	});
});

describe("GET /api/accounts with inactive and excluded accounts", () => {
	it("lists a deactivated account and drops its balance from the group total", async () => {
		const client = await ownClient();
		const joint = (await (await client.$post({ json: valid })).json()).data;
		const savings = (
			await (
				await client.$post({
					json: { ...valid, name: "Livret A", subtype: "savings", openingBalance: "100" },
				})
			).json()
		).data;
		const before = await listOwnAccounts(client);

		const response = await client[":id"].$patch({
			param: { id: savings.id },
			json: { active: false },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data.active).toBe(false);
		const after = await listOwnAccounts(client);
		expect(before.groups[0]?.total).toBe(123456 + 10000);
		expect(after.groups[0]?.total).toBe(123456);
		expect(after.groups[0]?.accounts).toEqual([
			expect.objectContaining({ id: joint.id, active: true, excludedFromReports: false }),
			expect.objectContaining({ id: savings.id, active: false, balance: 10000 }),
		]);
	});

	it("keeps an excluded account listed and drops its balance from the total", async () => {
		const client = await ownClient();
		await client.$post({ json: valid });
		const card = (
			await (
				await client.$post({
					json: {
						...valid,
						name: "Carte",
						type: "credit_card",
						subtype: null,
						openingBalance: "490,30",
					},
				})
			).json()
		).data;

		await client[":id"].$patch({ param: { id: card.id }, json: { excludedFromReports: true } });

		const { groups } = await listOwnAccounts(client);
		expect(groups[1]).toMatchObject({
			classification: "liability",
			total: 0,
			excludedCount: 0,
			accounts: [{ id: card.id, excludedFromReports: true, balance: 49030 }],
		});
		expect(groups[0]?.total).toBe(123456);
	});

	it("counts in excludedCount only active, included accounts in another currency", async () => {
		const client = await ownClient();
		const usd = { ...valid, subtype: "savings", currency: "USD", openingBalance: "10.00" } as const;
		await client.$post({ json: { ...usd, name: "Épargne US" } });
		const inactive = (await (await client.$post({ json: { ...usd, name: "Ancien US" } })).json())
			.data;
		const excluded = (await (await client.$post({ json: { ...usd, name: "Exclu US" } })).json())
			.data;

		await client[":id"].$patch({ param: { id: inactive.id }, json: { active: false } });
		await client[":id"].$patch({ param: { id: excluded.id }, json: { excludedFromReports: true } });

		const { groups } = await listOwnAccounts(client);
		expect(groups[0]).toMatchObject({ total: 0, excludedCount: 1 });
		expect(groups[0]?.accounts).toHaveLength(3);
	});

	it("reactivates an account, which counts again", async () => {
		const client = await ownClient();
		const account = (await (await client.$post({ json: valid })).json()).data;
		await client[":id"].$patch({ param: { id: account.id }, json: { active: false } });

		await client[":id"].$patch({ param: { id: account.id }, json: { active: true } });

		expect((await listOwnAccounts(client)).groups[0]?.total).toBe(123456);
	});

	// As Sure's `Entry.visible`: the cross-account list hides a deactivated
	// account's rows even when it names the account; its own page keeps them.
	it("hides a deactivated account's transactions from the cross-account list only", async () => {
		const account = await openAccount();
		await postTransaction(account.id, expense);

		await patchAccount(account.id, { active: false });

		const { body } = await request("GET", `/api/transactions?account=${account.id}`);
		expect(listBody.parse(body).data.items).toEqual([]);
		const page = await request("GET", `/api/accounts/${account.id}/transactions`);
		expect(page.body).toMatchObject({
			data: { items: [{ accountId: account.id, label: "Boulangerie" }], total: 1 },
		});
	});
});

async function countRows(accountId: string) {
	// Raw on purpose: only the ledger may import these tables (AD-2).
	const [row] = await temp.db.all<Record<string, number>>(
		sql`select
			(select count(*) from accounts where id = ${accountId}) as accounts,
			(select count(*) from entries where account_id = ${accountId}) as entries,
			(select count(*) from transactions where entry_id in (select id from entries where account_id = ${accountId})) as transactions,
			(select count(*) from balances where account_id = ${accountId}) as balances`,
	);

	return row;
}

describe("DELETE /api/accounts/:id", () => {
	it("deletes the account, its transactions, snapshot and balances, and nothing else", async () => {
		const account = await openAccount();
		const other = await openAccount({ name: "Livret A", subtype: "savings" });
		await postTransaction(other.id, { ...expense, label: "Autre compte" });
		// One after the other: each is an `immediate` ledger write.
		await postTransaction(account.id, expense);
		await postTransaction(account.id, { ...expense, date: "2026-09-11" });
		await postTransaction(account.id, { ...expense, date: "2026-09-12" });
		await postSnapshot(account.id, { date: "2026-09-15", balance: "1 000,00" });
		const otherBefore = await countRows(other.id);

		const response = await testClient(buildApp()).api.accounts[":id"].$delete({
			param: { id: account.id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { id: account.id } });
		await expect(countRows(account.id)).resolves.toEqual({
			accounts: 0,
			entries: 0,
			transactions: 0,
			balances: 0,
		});
		await expect(countRows(other.id)).resolves.toEqual(otherBefore);
		expect(otherBefore).toMatchObject({ accounts: 1, entries: 2, transactions: 1 });
		expect((await request("GET", `/api/accounts/${account.id}`)).status).toBe(404);
		const { body } = await request("GET", `/api/transactions?account=${other.id}`);
		expect(listBody.parse(body).data.items).toEqual([
			expect.objectContaining({ label: "Autre compte" }),
		]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await request("DELETE", "/api/accounts/nope");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

describe("POST /api/accounts/:id/imports", () => {
	it("stores a preview of an OFX file and writes nothing", async () => {
		const account = await openAccount();
		const client = testClient(buildApp()).api.accounts[":id"].imports;

		const response = await client.$post({
			param: { id: account.id },
			form: { file: new File([await creditAgricole()], "releve.ofx") },
		});

		expect(response.status).toBe(201);
		const { data } = importBody.parse(await response.json());
		expect(data).toMatchObject({
			fileName: "releve.ofx",
			source: "ofx",
			openingSuggestion: null,
			statementBalance: { status: "recorded", date: "2026-09-15", balance: 123456 },
		});
		expect(data.groups.created.map((line) => line.label)).toEqual([
			"CB CAFÉ DE LA GARE",
			"PRLV SEPA EDF Électricité échéance septembre",
			"VIR SALAIRE",
			"CB BOULANGERIE",
			"CB BOULANGERIE",
		]);
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it.each([
		["a text file", new TextEncoder().encode("Liste de courses : pain, lait"), "notes.txt"],
		[
			"a file with two statements",
			new TextEncoder().encode(
				"<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR</STMTRS><STMTRS><CURDEF>EUR</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
			),
			"releve.ofx",
		],
		// Below the body limit: the file's own size check refuses it.
		["a valid statement one byte over 5 MB", paddedOfx(MAX_IMPORT_BYTES + 1), "releve.ofx"],
		["a valid statement over the body limit", paddedOfx(6 * 1024 * 1024), "releve.ofx"],
	])("refuses %s with INVALID_IMPORT_FILE and writes nothing", async (_name, bytes, name) => {
		const account = await openAccount();

		const { status, body } = await upload(account.id, bytes, name);

		expect(status).toBe(400);
		expect(body).toMatchObject({ error: { code: "INVALID_IMPORT_FILE" } });
		const [row] = await temp.db.all<{ count: number }>(
			sql`select count(*) as count from imports where account_id = ${account.id}`,
		);
		expect(row?.count).toBe(0);
	});

	it("reads a valid statement of exactly 5 MB", async () => {
		const account = await openAccount();

		const preview = await uploaded(account.id, paddedOfx(MAX_IMPORT_BYTES));

		expect(preview.groups.created).toHaveLength(1);
	});

	it("purges the previews left for a day before storing a new one", async () => {
		const account = await openAccount();
		const old = await uploaded(account.id, paddedOfx(1024));
		vi.setSystemTime(new Date("2026-09-22T10:00:01Z"));

		const recent = await uploaded(account.id, paddedOfx(1024));

		const rows = await temp.db.all<{ id: string }>(
			sql`select id from imports where account_id = ${account.id}`,
		);
		expect(rows.map((row) => row.id)).toEqual([recent.id]);
		expect(rows.map((row) => row.id)).not.toContain(old.id);
	});

	it("refuses a body without a file", async () => {
		const account = await openAccount();

		const response = await buildApp().request(`/api/accounts/${account.id}/imports`, {
			method: "POST",
			body: new FormData(),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status, body } = await upload("nope", await creditAgricole());

		expect(status).toBe(404);
		expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
	});
});

const historyBody = z.object({
	data: z.object({
		items: z.array(
			z.object({
				id: z.string(),
				fileName: z.string(),
				source: z.string(),
				confirmedAt: z.number(),
				revertedAt: z.number().nullable(),
				counts: z.object({
					created: z.number(),
					present: z.number(),
					matched: z.number(),
					duplicates: z.number(),
					rejected: z.number(),
				}),
				removable: z.object({ transactions: z.number(), snapshot: z.number() }).nullable(),
			}),
		),
		page: z.number(),
		pageSize: z.number(),
		total: z.number(),
	}),
});

describe("GET /api/accounts/:id/imports", () => {
	it("lists confirmed and reverted imports, latest first, with what a revert would delete", async () => {
		const account = await openAccount();
		const first = await confirmedImport(account.id);
		vi.setSystemTime(new Date("2026-09-21T11:00:00Z"));
		const second = await confirmedImport(account.id);
		await request("POST", `/api/imports/${second}/revert`);
		// A preview wrote nothing: it has no place in the history.
		await uploaded(account.id, await creditAgricole());

		const response = await testClient(buildApp()).api.accounts[":id"].imports.$get({
			param: { id: account.id },
			query: {},
		});

		expect(response.status).toBe(200);
		expect(historyBody.parse(await response.json()).data).toEqual({
			items: [
				{
					id: second,
					fileName: "releve.ofx",
					source: "ofx",
					confirmedAt: Date.parse("2026-09-21T11:00:00Z"),
					revertedAt: Date.parse("2026-09-21T11:00:00Z"),
					counts: { created: 0, present: 5, matched: 0, duplicates: 0, rejected: 0 },
					removable: null,
				},
				{
					id: first,
					fileName: "releve.ofx",
					source: "ofx",
					confirmedAt: Date.parse("2026-09-21T10:00:00Z"),
					revertedAt: null,
					counts: { created: 5, present: 0, matched: 0, duplicates: 0, rejected: 0 },
					removable: { transactions: 5, snapshot: 1 },
				},
			],
			page: 1,
			pageSize: 50,
			total: 2,
		});
	});

	it("pages the history", async () => {
		const account = await openAccount();
		await confirmedImport(account.id);
		vi.setSystemTime(new Date("2026-09-21T11:00:00Z"));
		const latest = await confirmedImport(account.id);

		const { status, body } = await request(
			"GET",
			`/api/accounts/${account.id}/imports?page=1&pageSize=1`,
		);

		expect(status).toBe(200);
		const { data } = historyBody.parse(body);
		expect(data.items.map((item) => item.id)).toEqual([latest]);
		expect(data.total).toBe(2);
	});

	it("answers NOT_FOUND for an unknown account and refuses page 0", async () => {
		await expect(request("GET", "/api/accounts/nope/imports")).resolves.toMatchObject({
			status: 404,
			body: { error: { code: "NOT_FOUND" } },
		});
		const account = await openAccount();
		await expect(
			request("GET", `/api/accounts/${account.id}/imports?page=0`),
		).resolves.toMatchObject({ status: 400, body: { error: { code: "VALIDATION_ERROR" } } });
	});
});

/** A PEA holding 10 of a fund typed by hand, bought at 612.40 € with 2.50 € of fees. */
async function heldFund() {
	const account = await openAccount({ ...pea, openingDate: "2026-09-01" });
	const trade = await request("POST", `/api/accounts/${account.id}/trades`, {
		side: "buy",
		security: { source: "manual", name: `Fonds ${crypto.randomUUID()}` },
		date: "2026-09-10",
		quantity: "10",
		price: "612,40",
		fee: "2,50",
	});
	const securityId = z
		.object({ data: z.object({ security: z.object({ id: z.string() }) }) })
		.parse(trade.body).data.security.id;

	return { account, securityId };
}

const holdings = (accountId: string) =>
	testClient(buildApp()).api.accounts[":id"].holdings.$get({ param: { id: accountId } });

const costBasis = () =>
	testClient(buildApp()).api.accounts[":id"].holdings[":securityId"]["cost-basis"];

describe("GET /api/accounts/:id/holdings and the cost basis lock", () => {
	it("lists the positions and the cash, numbers as decimal strings", async () => {
		const { account, securityId } = await heldFund();

		const response = await holdings(account.id);

		expect(response.status).toBe(200);
		const { data } = await response.json();
		expect(data).toMatchObject({
			accountId: account.id,
			currency: "EUR",
			date: "2026-09-21",
			cash: 1_887_350,
			total: 2_499_750,
			positions: [
				{
					security: { id: securityId, ticker: null, provider: null, offline: false },
					quantity: "10",
					price: "612.4",
					priceDate: "2026-09-10",
					amount: 612_400,
					costBasis: "612.4",
					costBasisLocked: false,
					gain: 0,
					gainPercent: "0",
					weight: "24.49845",
				},
			],
		});
		expect(data.cashWeight).toBe("75.50155");
	});

	it("answers any account, NOT_FOUND for none", async () => {
		const account = await openAccount();

		const response = await holdings(account.id);
		const missing = await holdings("nope");

		await expect(response.json()).resolves.toEqual({
			data: {
				accountId: account.id,
				currency: "EUR",
				date: null,
				positions: [],
				cash: 123_456,
				cashWeight: "100",
				total: 123_456,
			},
		});
		expect(missing.status).toBe(404);
	});

	it("locks a cost basis and unlocks it, each answering the position", async () => {
		const { account, securityId } = await heldFund();
		const route = costBasis();
		const param = { id: account.id, securityId };

		const locked = await route.$put({ param, json: { costBasis: "600" } });

		expect(locked.status).toBe(200);
		await expect(locked.json()).resolves.toMatchObject({
			data: { costBasis: "600", costBasisLocked: true, gain: 12_400, gainPercent: "2.066667" },
		});

		const unlocked = await route.$delete({ param });

		expect(unlocked.status).toBe(200);
		await expect(unlocked.json()).resolves.toMatchObject({
			data: { costBasis: "612.4", costBasisLocked: false },
		});
	});

	it("refuses a cost basis below zero, a security not held and an account that is not an investment one", async () => {
		const { account, securityId } = await heldFund();
		const checking = await openAccount();

		const invalid = await costBasis().$put({
			param: { id: account.id, securityId },
			json: { costBasis: "-1" },
		});
		const notHeld = await costBasis().$put({
			param: { id: account.id, securityId: "nope" },
			json: { costBasis: "1" },
		});
		const notInvestment = await costBasis().$delete({
			param: { id: checking.id, securityId },
		});

		expect(invalid.status).toBe(400);
		expect(errorBody.parse(await invalid.json()).error.fields).toEqual([
			{ path: "costBasis", code: "invalid_price" },
		]);
		expect(notHeld.status).toBe(404);
		expect(notInvestment.status).toBe(409);
		expect(errorBody.parse(await notInvestment.json()).error.code).toBe(
			"NOT_AN_INVESTMENT_ACCOUNT",
		);
	});
});

const schedule = (accountId: string) =>
	testClient(buildApp()).api.accounts[":id"].schedule.$get({ param: { id: accountId } });

async function scheduleOf(accountId: string) {
	const response = await schedule(accountId);

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("GET /api/accounts/:id/schedule", () => {
	it("computes the owner's ING mortgage as his bank's table", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });

		const data = await scheduleOf(loan.id);

		expect(data).toMatchObject({
			asOf: "2026-09-21",
			currency: "EUR",
			originationDate: "2020-12-05",
			variable: false,
			reAmortising: false,
			periodicPayment: 53_969,
			totalInterest: 3_190_696,
			totalPaid: 16_190_696,
		});
		expect(data?.payments).toHaveLength(300);
		expect(data?.payments[68]).toMatchObject({ date: "2026-09-05", endingBalance: 10_510_482 });
		expect(data?.payments[69]).toEqual({
			number: 70,
			date: "2026-10-05",
			payment: 53_969,
			principal: 38_028,
			interest: 15_941,
			endingBalance: 10_472_454,
		});
		expect(data?.payments[299]).toMatchObject({
			number: 300,
			date: "2045-12-05",
			payment: 53_965,
			endingBalance: 0,
		});
		// The premium is Story 24.3's to show.
		expect(data).not.toHaveProperty("insurance");
	});

	it("starts at the opening date without a start date", async () => {
		const loan = await openAccount({ ...mortgage, details: { ...ingTerms, startDate: "" } });

		const data = await scheduleOf(loan.id);

		expect(data?.originationDate).toBe("2026-09-01");
		expect(data?.payments[0]?.date).toBe("2026-10-01");
	});

	it("re-amortises a variable loan at its rate changes", async () => {
		const loan = await openAccount({
			...mortgage,
			details: {
				...ingTerms,
				rateType: "variable",
				rateChanges: [{ effectiveDate: "2023-06-05", rate: "3" }],
			},
		});

		const data = await scheduleOf(loan.id);

		expect(data).toMatchObject({ variable: true, reAmortising: true, periodicPayment: 53_969 });
		expect(data?.payments[30]?.payment).toBeGreaterThan(53_969);
	});

	it("warns of an adjustable rate as of a variable one", async () => {
		const loan = await openAccount({
			...mortgage,
			details: { ...ingTerms, rateType: "adjustable" },
		});

		await expect(scheduleOf(loan.id)).resolves.toMatchObject({
			variable: true,
			reAmortising: false,
		});
	});

	it("follows the terms once they are saved", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });

		const { status } = await patchAccount(loan.id, { details: { ...ingTerms, termMonths: "240" } });

		expect(status).toBe(200);
		const data = await scheduleOf(loan.id);
		expect(data?.payments).toHaveLength(240);
		expect(data?.payments.at(-1)?.date).toBe("2040-12-05");
	});

	it("answers null for a loan without a schedule, and for another account", async () => {
		const withoutAmount = await openAccount({
			...mortgage,
			details: { ...ingTerms, originalAmount: "" },
		});
		const withoutRate = await openAccount({
			...mortgage,
			details: { ...ingTerms, rateType: "", interestRate: "" },
		});
		const withoutTerms = await openAccount(mortgage);
		const checking = await openAccount();

		const answers = await Promise.all(
			[withoutAmount, withoutRate, withoutTerms, checking].map((account) => scheduleOf(account.id)),
		);

		expect(answers).toEqual([null, null, null, null]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const response = await schedule("nope");

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json()).error.code).toBe("NOT_FOUND");
	});
});
