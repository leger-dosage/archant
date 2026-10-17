import type { LoanDetailsInput } from "../schemas/accounts.ts";
import type { Auth } from "../services/auth.ts";

import { eq, sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { rateLimits } from "@archant/data/schema/auth";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";
import { securities } from "@archant/data/schema/securities";

import { createLogger } from "../lib/logger.ts";
import { MAX_IMPORT_BYTES } from "../schemas/imports.ts";
import { linkBankAccount } from "../services/ledger/bank-link.ts";
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
import {
	addViewer,
	buildTestApp,
	cookieOf,
	createTestAuth,
	signIn,
	withSession,
} from "../testing/auth.ts";

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

// Story 28.10's matrix: jewellery worth 5 000 € and 2 000 € owed to a relative.
const jewellery = {
	name: "Bijoux",
	type: "other_asset",
	subtype: null,
	openingBalance: "5 000,00",
} as const;

const relativeLoan = {
	name: "Prêt de Marie",
	type: "other_liability",
	subtype: null,
	openingBalance: "2 000,00",
} as const;

// Story 28.11's matrix: an exchange holding 1 000 €.
const exchange = {
	name: "Kraken",
	type: "crypto",
	subtype: "exchange",
	openingBalance: "1 000,00",
} as const;

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

// A property's and a vehicle's details, as created without any.
const noPropertyDetails = {
	yearBuilt: null,
	areaValue: null,
	areaUnit: "sqm",
	addressLine1: null,
	locality: null,
	region: null,
	postalCode: null,
	country: null,
};

const noVehicleDetails = {
	make: null,
	model: null,
	year: null,
	mileageValue: null,
	mileageUnit: "km",
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

	it("creates a cash account and one without a subtype, both listed as depository assets", async () => {
		const client = await ownClient();
		const cash = await client.$post({ json: { ...valid, name: "Tirelire", subtype: "cash" } });
		const blank = await client.$post({ json: { ...valid, name: "Enveloppe", subtype: null } });

		expect([cash.status, blank.status]).toEqual([201, 201]);
		const { data } = await (await client.$get()).json();
		expect(data.groups[0]).toMatchObject({ classification: "asset" });
		expect(
			data.groups[0]?.accounts.map(({ name, type, subtype }) => ({ name, type, subtype })),
		).toEqual([
			{ name: "Enveloppe", type: "depository", subtype: null },
			{ name: "Tirelire", type: "depository", subtype: "cash" },
		]);
	});

	it("refuses a loan without a subtype and a depository with Sure's hsa, writing nothing", async () => {
		const before = await accountCount();
		const responses = await Promise.all([
			postRaw({ ...valid, ...mortgage, subtype: null }),
			postRaw({ ...valid, subtype: "hsa" }),
		]);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(body.error.fields).toEqual([{ path: "subtype", code: "invalid_subtype" }]);
		}
		await expect(accountCount()).resolves.toBe(before);
	});

	it("creates a pillar 3a and an investment without a subtype, both listed as investment assets", async () => {
		const client = await ownClient();
		const pillar = await client.$post({
			json: { ...valid, name: "Pilier", type: "investment", subtype: "pillar_3a" },
		});
		const blank = await client.$post({
			json: { ...valid, name: "Placement", type: "investment", subtype: null },
		});

		expect([pillar.status, blank.status]).toEqual([201, 201]);
		const { data } = await (await client.$get()).json();
		expect(
			data.groups
				.flatMap((group) => group.accounts)
				.filter((account) => account.type === "investment")
				.map(({ name, subtype }) => ({ name, subtype })),
		).toEqual([
			{ name: "Pilier", subtype: "pillar_3a" },
			{ name: "Placement", subtype: null },
		]);
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

	it.each(["1,8205", "3,4567", "-1", "12345678", "abc", "1,2,3"])(
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

	// Sure's `Loan` caps neither rate; only its rate changes stop at 100 %.
	it("saves an interest rate of 150 % and an insurance rate of 120 %, and amortises them", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: {
				...valid,
				...mortgage,
				details: { ...ingTerms, interestRate: "150", insuranceRate: "120" },
			},
		});
		const { data } = await response.json();

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({
			data: { details: { interestRate: 1_500_000, insuranceRate: 1_200_000 } },
		});
		expect((await scheduleOf(data.id))?.payments).toHaveLength(300);
	});

	it("amortises the opening balance when the amount borrowed is 0, as Sure's `original_balance`", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...mortgage, details: { ...ingTerms, originalAmount: "0" } },
		});
		const { data } = await response.json();

		expect((await scheduleOf(data.id))?.payments).toHaveLength(300);
		expect(await overviewOf(data.id)).toMatchObject({ originalAmount: 18_000_000 });
	});

	it("refuses an insurance rate with five digits before the decimals", async () => {
		const { body } = await postRaw({ ...valid, ...mortgage, details: { insuranceRate: "12345" } });

		expect(body.error.fields).toEqual([{ path: "details.insuranceRate", code: "invalid_rate" }]);
	});

	// Sure's money field takes any amount. Neither counts as recorded, so the
	// principal falls back to the opening balance, here nothing either, and
	// `amortizable?` declines the loan.
	it.each([
		["0", 0],
		["-5 000", -500_000],
	])("saves the amount borrowed %j without a schedule", async (originalAmount, minorUnits) => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: {
				...valid,
				...mortgage,
				openingBalance: "0",
				details: { ...ingTerms, originalAmount },
			},
		});
		const { data } = await response.json();

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({ data: { details: { originalAmount: minorUnits } } });
		expect(await scheduleOf(data.id)).toBeNull();
		expect(await overviewOf(data.id)).toMatchObject({
			originalAmount: 0,
			monthlyPayment: 0,
			payoffDate: null,
			totalCost: null,
			instalment: null,
		});
	});

	it.each(["abc", "1,234"])("refuses the amount borrowed %j", async (originalAmount) => {
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

	// Sure's `term_months` is an integer column its model never bounds: a
	// provider writes terms its form would refuse, and the loan is saved and
	// left unamortised.
	it.each([
		["0", 0, 0],
		["00000", 0, 0],
		["1201", 1201, null],
		["1500", 1500, null],
		["999999999", 999_999_999, null],
	])("saves the term %j without a schedule", async (termMonths, months, monthlyPayment) => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...mortgage, details: { ...ingTerms, termMonths } },
		});
		const { data } = await response.json();

		const detail = await request("GET", `/api/accounts/${data.id}`);

		expect(detail.body).toMatchObject({ data: { details: { termMonths: months } } });
		expect(await scheduleOf(data.id)).toBeNull();
		expect(await overviewOf(data.id)).toMatchObject({
			termMonths: months,
			monthlyPayment,
			payoffDate: null,
			totalCost: null,
			insurance: { rate: 2917 },
			instalment: null,
		});
	});

	it.each(["12,5", "12.5", "-3", "abc", "1000000000"])(
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

	it("creates a card with its details in minor units and its APR in millionths", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: {
				...valid,
				type: "credit_card",
				subtype: null,
				details: {
					availableCredit: "3000",
					minimumPayment: "25,50",
					apr: "15,99",
					expirationDate: "2028-04-30",
					annualFee: "",
				},
			},
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		const detail = await request("GET", `/api/accounts/${data.id}`);
		expect(detail.body).toMatchObject({
			data: {
				details: {
					availableCredit: 300000,
					minimumPayment: 2550,
					apr: 159900,
					expirationDate: "2028-04-30",
					annualFee: null,
				},
				bankConnection: null,
				treatBalanceAsAvailableCredit: null,
			},
		});
	});

	it("creates a card without details as every detail unknown", async () => {
		const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });

		const detail = await request("GET", `/api/accounts/${card.id}`);
		expect(detail.body).toMatchObject({
			data: {
				details: {
					availableCredit: null,
					minimumPayment: null,
					apr: null,
					expirationDate: null,
					annualFee: null,
				},
			},
		});
	});

	it("takes an APR with no 100 % cap, below Sure's decimal(10,2) bound", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, type: "credit_card", subtype: null, details: { apr: "99999999,99" } },
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		const detail = await request("GET", `/api/accounts/${data.id}`);
		expect(detail.body).toMatchObject({ data: { details: { apr: 999_999_999_900 } } });
		const above = await postRaw({
			...valid,
			type: "credit_card",
			subtype: null,
			details: { apr: "100000000" },
		});
		expect(above.body.error.fields).toEqual([{ path: "details.apr", code: "invalid_rate" }]);
	});

	it("refuses a negative card amount and an APR with three decimals, writing nothing", async () => {
		const before = await accountCount();

		const { status, body } = await postRaw({
			...valid,
			type: "credit_card",
			subtype: null,
			details: { annualFee: "-1", apr: "1,234", expirationDate: "2028-02-30" },
		});

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([
			{ path: "details.annualFee", code: "invalid_amount" },
			{ path: "details.apr", code: "invalid_rate" },
			{ path: "details.expirationDate", code: "invalid_date" },
		]);
		await expect(accountCount()).resolves.toBe(before);
	});

	it("refuses details on a depository and card details on a loan", async () => {
		const depository = await postRaw({ ...valid, details: { availableCredit: "100" } });
		const loan = await postRaw({ ...valid, ...mortgage, details: { apr: "15" } });

		expect(depository.status).toBe(400);
		expect(depository.body.error.fields).toEqual([{ path: "details", code: "invalid_details" }]);
		expect(loan.body.error.fields).toEqual([{ path: "details", code: "invalid_details" }]);
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

	it("refuses an investment with another type's subtype or Sure's US 401k", async () => {
		const before = await accountCount();
		const responses = await Promise.all(
			["savings", "401k"].map(async (subtype) => postRaw({ ...valid, ...pea, subtype })),
		);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(body.error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "subtype", code: "invalid_subtype" }],
			});
		}
		await expect(accountCount()).resolves.toBe(before);
	});

	it("refuses details on an investment", async () => {
		const { status, body } = await postRaw({ ...valid, ...pea, details: { interestRate: "3" } });

		expect(status).toBe(400);
		expect(body.error.fields).toEqual([{ path: "details", code: "invalid_details" }]);
	});

	it("creates a home as an asset worth its estimated value, its details unknown", async () => {
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
			data: { classification: "asset", balance: 32000000, details: noPropertyDetails },
		});
	});

	it("creates a vehicle without a subtype as an asset worth its estimated value, its details unknown", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: { ...valid, ...car },
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		expect(data).toMatchObject({ type: "vehicle", subtype: null, balance: 1850000 });
		const detail = await request("GET", `/api/accounts/${data.id}`);
		expect(detail.body).toMatchObject({
			data: { classification: "asset", balance: 1850000, details: noVehicleDetails },
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

	it("refuses a loan's details on a property and on a vehicle", async () => {
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

	it("stores a property's details trimmed, blank ones null, the area in square metres unless chosen", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: {
				...valid,
				...home,
				subtype: "agri_land",
				details: { areaValue: "120", locality: " Lyon ", region: "  " },
			},
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		expect(data).toMatchObject({ type: "property", subtype: "agri_land" });
		const detail = await request("GET", `/api/accounts/${data.id}`);
		expect(detail.body).toMatchObject({
			data: { details: { ...noPropertyDetails, areaValue: 120, locality: "Lyon" } },
		});
	});

	it("takes each of Sure's ten property subtypes", async () => {
		const subtypes = [
			"single_family_home",
			"multi_family_home",
			"condominium",
			"townhouse",
			"investment_property",
			"second_home",
			"apartment",
			"plot",
			"commercial",
			"agri_land",
		];

		const statuses = await Promise.all(
			subtypes.map(async (subtype) => postStatus({ ...valid, ...home, subtype })),
		);

		expect(statuses).toEqual(subtypes.map(() => 201));
	});

	it("stores a vehicle's details", async () => {
		const response = await testClient(buildApp()).api.accounts.$post({
			json: {
				...valid,
				...car,
				details: { make: "Peugeot", model: "208", year: "2021", mileageValue: "15000" },
			},
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		const detail = await request("GET", `/api/accounts/${data.id}`);
		expect(detail.body).toMatchObject({
			data: {
				details: {
					make: "Peugeot",
					model: "208",
					year: 2021,
					mileageValue: 15000,
					mileageUnit: "km",
				},
			},
		});
	});

	it("saves a year or a mileage only Sure's form would bound", async () => {
		const property = await postStatus({ ...valid, ...home, details: { yearBuilt: "1200" } });
		const vehicle = await postStatus({
			...valid,
			...car,
			details: { year: "1850", mileageValue: "-1", mileageUnit: "mi" },
		});

		expect([property, vehicle]).toEqual([201, 201]);
	});

	it("refuses a number that is not an integer, a text too long or a unit Sure has not, nothing written", async () => {
		const before = await accountCount();

		const property = await postRaw({
			...valid,
			...home,
			details: { areaValue: "12,5", yearBuilt: "deux mille", addressLine1: "x".repeat(256) },
		});
		const unit = await postRaw({ ...valid, ...car, details: { mileageUnit: "furlong" } });
		const mileage = await postRaw({
			...valid,
			...car,
			details: { mileageValue: "1e3", mileageUnit: "km" },
		});

		expect(property.status).toBe(400);
		expect(property.body.error.fields).toEqual([
			{ path: "details.yearBuilt", code: "invalid_number" },
			{ path: "details.areaValue", code: "invalid_number" },
			{ path: "details.addressLine1", code: "too_long" },
		]);
		expect(unit.status).toBe(400);
		expect(unit.body.error.fields).toEqual([
			{ path: "details.mileageUnit", code: "invalid_value" },
		]);
		expect(mileage.status).toBe(400);
		expect(mileage.body.error.fields).toEqual([
			{ path: "details.mileageValue", code: "invalid_number" },
		]);
		await expect(accountCount()).resolves.toBe(before);
	});

	it("refuses a vehicle's details on a property, a property's on a vehicle, and either on a depository", async () => {
		const before = await accountCount();

		const responses = await Promise.all([
			postRaw({ ...valid, ...home, details: { areaValue: "120", make: "Peugeot" } }),
			postRaw({ ...valid, ...car, details: { locality: "Lyon" } }),
			postRaw({ ...valid, details: { yearBuilt: "1975" } }),
			postRaw({ ...valid, details: { mileageValue: "15000" } }),
		]);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(body.error.fields).toEqual([{ path: "details", code: "invalid_details" }]);
		}
		await expect(accountCount()).resolves.toBe(before);
	});

	it("creates an other asset and an other liability without a subtype or details, each in its group", async () => {
		const client = await ownClient();

		const asset = await client.$post({
			json: { ...valid, ...jewellery, openingDate: "2026-05-01" },
		});
		const liability = await client.$post({ json: { ...valid, ...relativeLoan } });

		expect([asset.status, liability.status]).toEqual([201, 201]);
		const { data } = await (await client.$get()).json();
		expect(data.groups).toMatchObject([
			{
				classification: "asset",
				total: 500000,
				accounts: [{ name: "Bijoux", type: "other_asset", subtype: null, balance: 500000 }],
			},
			{
				classification: "liability",
				total: 200000,
				accounts: [
					{ name: "Prêt de Marie", type: "other_liability", subtype: null, balance: 200000 },
				],
			},
		]);
	});

	it("refuses a subtype on an other asset, and details on an other liability as on a depository", async () => {
		const before = await accountCount();

		const subtype = await postRaw({ ...valid, ...jewellery, subtype: "savings" });
		const details = await postRaw({ ...valid, ...relativeLoan, details: { make: "Peugeot" } });

		expect(subtype.status).toBe(400);
		expect(subtype.body.error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "subtype", code: "invalid_subtype" }],
		});
		expect(details.status).toBe(400);
		expect(details.body.error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "details", code: "invalid_details" }],
		});
		await expect(accountCount()).resolves.toBe(before);
	});

	it("creates a crypto exchange, a wallet and one without a subtype, each taxable unless told, in the assets", async () => {
		const client = testClient(buildApp()).api.accounts;

		const created = await Promise.all([
			client.$post({ json: { ...valid, ...exchange } }),
			client.$post({
				json: {
					...valid,
					...exchange,
					name: "Ledger",
					subtype: "wallet",
					details: { taxTreatment: "tax_exempt" },
				},
			}),
			client.$post({ json: { ...valid, ...exchange, name: "Crypto", subtype: null } }),
		]);

		expect(created.map((response) => response.status)).toEqual([201, 201, 201]);
		const details = await Promise.all(
			created.map(async (response) => {
				const { data } = await response.json();

				return (await request("GET", `/api/accounts/${data.id}`)).body;
			}),
		);
		expect(details).toMatchObject([
			{
				data: {
					type: "crypto",
					subtype: "exchange",
					classification: "asset",
					balance: 100000,
					details: { taxTreatment: "taxable" },
				},
			},
			{ data: { subtype: "wallet", details: { taxTreatment: "tax_exempt" } } },
			{ data: { subtype: null, details: { taxTreatment: "taxable" } } },
		]);
	});

	it("refuses a tax treatment Sure's enum lacks, and a crypto subtype it does not name", async () => {
		const before = await accountCount();

		const treatment = await postRaw({
			...valid,
			...exchange,
			details: { taxTreatment: "tax_advantaged" },
		});
		const subtype = await postRaw({ ...valid, ...exchange, subtype: "brokerage" });

		expect(treatment.status).toBe(400);
		expect(treatment.body.error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "details.taxTreatment" }],
		});
		expect(subtype.status).toBe(400);
		expect(subtype.body.error).toMatchObject({
			fields: [{ path: "subtype", code: "invalid_subtype" }],
		});
		await expect(accountCount()).resolves.toBe(before);
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
		"records a transaction dated %s, on or before the opening date, as Sure",
		async (date) => {
			const account = await openAccount();

			const { status, body } = await postTransaction(account.id, { ...expense, date });

			expect(status).toBe(201);
			expect(body).toMatchObject({ data: { date } });
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

	it("starts `all` at a line dated before the opening date, from zero, as Sure's history start", async () => {
		const account = await openAccount({ openingDate: "2026-09-01" });
		await postTransaction(account.id, { ...expense, date: "2026-08-20" });

		const data = await balancesOf(account.id, "all");

		expect(data.from).toBe("2026-08-20");
		expect(data.points[0]).toEqual({ date: "2026-08-20", balance: -4290 });
		expect(data.points.find((point) => point.date === "2026-09-01")).toEqual({
			date: "2026-09-01",
			balance: 123456,
		});
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

	it("records the day before the opening date, and refuses tomorrow on the date field", async () => {
		const account = await openPinned();

		const before = await postSnapshot(account.id, { date: "2026-01-09", balance: "1,00" });
		const tomorrow = await postSnapshot(account.id, { date: "2026-09-22", balance: "1,00" });

		expect(before.status).toBe(201);
		expect(tomorrow.status).toBe(400);
		expect(errorBody.parse(tomorrow.body).error.fields).toEqual([
			{ path: "date", code: "date_in_future" },
		]);
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 1 });
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

async function dryRun(accountId: string, json: { date: string; balance: string }) {
	return testClient(buildApp()).api.accounts[":id"].snapshots["dry-run"].$post({
		param: { id: accountId },
		json,
	});
}

describe("POST /api/accounts/:id/snapshots/dry-run", () => {
	it("answers the balance and the cash a new balance would set, writing nothing", async () => {
		const account = await openPinned();

		const response = await dryRun(account.id, { date: "2026-03-05", balance: "1 234,56" });

		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({
			date: "2026-03-05",
			balance: 123456,
			cash: 123456,
		});
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 0 });
		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(138000);
	});

	it("gives a PEA without trades its whole value as cash, as Sure's derived cash", async () => {
		const account = await openAccount({ ...pea, openingDate: "2026-01-10" });

		const response = await dryRun(account.id, { date: "2026-03-05", balance: "26 300,00" });

		expect((await response.json()).data).toEqual({
			date: "2026-03-05",
			balance: 2630000,
			cash: 2630000,
		});
	});

	it("answers a null cash on a date no balance row holds", async () => {
		const account = await openPinned();

		const response = await dryRun(account.id, { date: "2025-12-01", balance: "1 000,00" });

		expect((await response.json()).data).toEqual({
			date: "2025-12-01",
			balance: 100000,
			cash: null,
		});
	});

	it("refuses a blank balance with amount_required, as Sure's valuations", async () => {
		const account = await openPinned();

		const empty = await request("POST", `/api/accounts/${account.id}/snapshots/dry-run`, {
			date: "2026-03-05",
			balance: "",
		});
		const spaces = await request("POST", `/api/accounts/${account.id}/snapshots/dry-run`, {
			date: "2026-03-05",
			balance: "   ",
		});
		const saved = await postSnapshot(account.id, { date: "2026-03-05", balance: " " });

		for (const { status, body } of [empty, spaces, saved]) {
			expect(status).toBe(400);
			expect(errorBody.parse(body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "balance", code: "amount_required" }],
			});
		}
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("refuses a malformed amount or date and answers NOT_FOUND for an unknown account", async () => {
		const account = await openPinned();

		const malformed = await request("POST", `/api/accounts/${account.id}/snapshots/dry-run`, {
			date: "2026-03-05",
			balance: "12,345",
		});
		const badDate = await request("POST", `/api/accounts/${account.id}/snapshots/dry-run`, {
			date: "2026-3-05",
			balance: "1,00",
		});
		const missing = await request("POST", "/api/accounts/nope/snapshots/dry-run", {
			date: "2026-03-05",
			balance: "1,00",
		});

		expect(errorBody.parse(malformed.body).error.fields).toEqual([
			{ path: "balance", code: "invalid_amount" },
		]);
		expect(errorBody.parse(badDate.body).error.fields).toEqual([
			{ path: "date", code: "invalid_format" },
		]);
		expect(missing.status).toBe(404);
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

	it("clears a checking account's subtype, as Sure's blank depository", async () => {
		const account = await openAccount();

		const { status, body } = await patchAccount(account.id, { subtype: null });

		expect(status).toBe(200);
		expect(accountBody.parse(body).data).toMatchObject({ subtype: null });
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

	it("refuses a subtype on an other asset or an other liability", async () => {
		const asset = await openAccount(jewellery);
		const liability = await openAccount(relativeLoan);

		const responses = await Promise.all([
			patchAccount(asset.id, { subtype: "savings" }),
			patchAccount(liability.id, { subtype: "other" }),
		]);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(errorBody.parse(body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "subtype", code: "invalid_subtype" }],
			});
		}
	});

	it("moves a crypto exchange to a wallet and its tax treatment to tax-deferred, a third value refused", async () => {
		const account = await openAccount(exchange);

		const moved = await patchAccount(account.id, {
			subtype: "wallet",
			details: { taxTreatment: "tax_deferred" },
		});
		const refused = await patchAccount(account.id, { details: { taxTreatment: "exempt" } });

		expect(moved.status).toBe(200);
		expect(moved.body).toMatchObject({
			data: { subtype: "wallet", details: { taxTreatment: "tax_deferred" } },
		});
		expect(refused.status).toBe(400);
		expect(errorBody.parse(refused.body).error.code).toBe("VALIDATION_ERROR");
	});

	it("clears a PEA's subtype, as Sure's blank investment", async () => {
		const account = await openAccount(pea);

		const { status, body } = await patchAccount(account.id, { subtype: null });

		expect(status).toBe(200);
		expect(accountBody.parse(body).data).toMatchObject({ subtype: null });
	});

	it("refuses a loan without a subtype", async () => {
		const account = await openAccount(mortgage);

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

	it("saves a term of 0, which only the dialog refuses, without a schedule", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });

		const { status } = await patchAccount(loan.id, { details: { ...ingTerms, termMonths: "0" } });

		expect(status).toBe(200);
		const detail = await request("GET", `/api/accounts/${loan.id}`);
		expect(detail.body).toMatchObject({ data: { details: { termMonths: 0 } } });
		expect(await scheduleOf(loan.id)).toBeNull();
	});

	it("refuses a start date after today, saving nothing", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });

		const { status, body } = await patchAccount(loan.id, {
			details: { ...ingTerms, startDate: "2026-09-22", termMonths: "abc" },
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
			details: { ...blankTerms, interestRate: "3,4567", originalAmount: "abc" },
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

// Every field of a card's details in a PATCH, blank: it replaces them whole.
const blankCard = {
	availableCredit: "",
	minimumPayment: "",
	apr: "",
	expirationDate: "",
	annualFee: "",
};

/** A card fed by a new bank account of a new connection, its toggle as given. */
async function linkedCard(toggle: boolean) {
	const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });
	const connectionId = crypto.randomUUID();
	const bankAccountId = crypto.randomUUID();
	await temp.db.insert(bankConnections).values({
		id: connectionId,
		connector: "enable-banking",
		institutionName: "Banque Test",
		country: "FR",
		status: "active",
		createdAt: 0,
		updatedAt: 0,
	});
	await temp.db.insert(bankAccounts).values({
		id: bankAccountId,
		bankConnectionId: connectionId,
		identificationHash: `hash-${bankAccountId}`,
		providerUid: `uid-${bankAccountId}`,
		name: "Carte Visa Premier",
		currency: "EUR",
		treatBalanceAsAvailableCredit: toggle,
		createdAt: 0,
		updatedAt: 0,
	});
	await temp.db.update(accounts).set({ bankAccountId }).where(eq(accounts.id, card.id));

	return { id: card.id, bankAccountId };
}

describe("DELETE /api/accounts/:id/unlink", () => {
	it("turns a linked account manual, its bank account kept with its connection", async () => {
		const card = await linkedCard(false);

		const response = await request("DELETE", `/api/accounts/${card.id}/unlink`);

		expect(response).toEqual({ status: 200, body: { data: { id: card.id } } });
		await expect(
			temp.db
				.select({ bankAccountId: accounts.bankAccountId })
				.from(accounts)
				.where(eq(accounts.id, card.id))
				.get(),
		).resolves.toEqual({ bankAccountId: null });
		await expect(
			temp.db
				.select({ id: bankAccounts.id })
				.from(bankAccounts)
				.where(eq(bankAccounts.id, card.bankAccountId))
				.get(),
		).resolves.toEqual({ id: card.bankAccountId });
		await expect(request("GET", `/api/accounts/${card.id}`)).resolves.toMatchObject({
			body: { data: { bankConnection: null } },
		});
	});

	it("refuses a manual account with ACCOUNT_NOT_LINKED, and an unknown one with NOT_FOUND", async () => {
		const manual = await openAccount();

		const refused = await request("DELETE", `/api/accounts/${manual.id}/unlink`);
		const unknown = await request("DELETE", `/api/accounts/${crypto.randomUUID()}/unlink`);

		expect(refused.status).toBe(409);
		expect(errorBody.parse(refused.body).error.code).toBe("ACCOUNT_NOT_LINKED");
		expect(unknown.status).toBe(404);
		expect(errorBody.parse(unknown.body).error.code).toBe("NOT_FOUND");
	});
});

describe("PATCH /api/accounts/:id on a credit card", () => {
	it("replaces a card's details whole, a blank one cleared", async () => {
		const card = await openAccount({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			details: { availableCredit: "3000", annualFee: "99" },
		});

		const { status, body } = await patchAccount(card.id, {
			details: { ...blankCard, minimumPayment: "100", apr: "15,99" },
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({
			data: {
				details: {
					availableCredit: null,
					minimumPayment: 10000,
					apr: 159900,
					expirationDate: null,
					annualFee: null,
				},
			},
		});
	});

	it("refuses invalid card details and saves nothing", async () => {
		const card = await openAccount({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			details: { annualFee: "99" },
		});

		const { status, body } = await patchAccount(card.id, {
			name: "Autre",
			details: { ...blankCard, annualFee: "-1", apr: "1,234" },
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "details.annualFee", code: "invalid_amount" },
			{ path: "details.apr", code: "invalid_rate" },
		]);
		const detail = await request("GET", `/api/accounts/${card.id}`);
		expect(detail.body).toMatchObject({ data: { name: "Carte", details: { annualFee: 9900 } } });
	});

	it("refuses card details on a loan, and loan details on a card", async () => {
		const loan = await openAccount(mortgage);
		const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });

		const onLoan = await patchAccount(loan.id, { details: blankCard });
		const onCard = await patchAccount(card.id, { details: blankTerms });

		expect(errorBody.parse(onLoan.body).error.fields).toEqual([
			{ path: "details", code: "invalid_details" },
		]);
		expect(errorBody.parse(onCard.body).error.fields).toEqual([
			{ path: "details", code: "invalid_details" },
		]);
	});

	it("ignores the toggle on an unlinked card, and saves the rest", async () => {
		const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });

		const { status, body } = await patchAccount(card.id, {
			name: "Visa",
			treatBalanceAsAvailableCredit: true,
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { name: "Visa", treatBalanceAsAvailableCredit: null } });
	});

	it("saves the toggle of a linked card on its bank account", async () => {
		const card = await linkedCard(false);

		const { status, body } = await patchAccount(card.id, { treatBalanceAsAvailableCredit: true });

		expect(status).toBe(200);
		expect(body).toMatchObject({
			data: {
				treatBalanceAsAvailableCredit: true,
				bankConnection: { institutionName: "Banque Test" },
			},
		});
		await expect(
			temp.db
				.select({ toggle: bankAccounts.treatBalanceAsAvailableCredit })
				.from(bankAccounts)
				.where(eq(bankAccounts.id, card.bankAccountId))
				.get(),
		).resolves.toEqual({ toggle: true });
	});

	it("ignores the toggle on a linked account that is not a card", async () => {
		const card = await linkedCard(false);
		await temp.db
			.update(accounts)
			.set({ type: "depository", subtype: "checking" })
			.where(eq(accounts.id, card.id));

		const { status, body } = await patchAccount(card.id, { treatBalanceAsAvailableCredit: true });

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { treatBalanceAsAvailableCredit: false } });
	});
});

// Every field of a property's details in a PATCH, blank: it replaces them whole.
const blankProperty = {
	yearBuilt: "",
	areaValue: "",
	areaUnit: "sqm",
	addressLine1: "",
	locality: "",
	region: "",
	postalCode: "",
	country: "",
} as const;

const blankVehicle = {
	make: "",
	model: "",
	year: "",
	mileageValue: "",
	mileageUnit: "km",
} as const;

describe("PATCH /api/accounts/:id on a property or a vehicle", () => {
	it("replaces a property's details whole, a blank one cleared, its unit as chosen", async () => {
		const property = await openAccount({
			...home,
			details: { yearBuilt: "1975", region: "Rhône" },
		});

		const { status, body } = await patchAccount(property.id, {
			details: {
				...blankProperty,
				areaValue: "1290",
				areaUnit: "sqft",
				addressLine1: "3 rue Mercière",
			},
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({
			data: {
				details: {
					...noPropertyDetails,
					areaValue: 1290,
					areaUnit: "sqft",
					addressLine1: "3 rue Mercière",
				},
			},
		});
	});

	it("saves details on a property created before it had any", async () => {
		const property = await openAccount(home);
		await temp.db.update(accounts).set({ details: null }).where(eq(accounts.id, property.id));

		const { status, body } = await patchAccount(property.id, {
			details: { ...blankProperty, locality: "Lyon" },
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { details: { ...noPropertyDetails, locality: "Lyon" } } });
	});

	it("replaces a vehicle's details, and refuses an invalid one, nothing written", async () => {
		const vehicle = await openAccount({ ...car, details: { make: "Peugeot" } });

		const saved = await patchAccount(vehicle.id, {
			details: { ...blankVehicle, make: "Renault", mileageValue: "42000", mileageUnit: "mi" },
		});
		const refused = await patchAccount(vehicle.id, {
			details: { ...blankVehicle, make: "Citroën", year: "2021.5" },
		});

		expect(saved.status).toBe(200);
		expect(saved.body).toMatchObject({
			data: {
				details: { ...noVehicleDetails, make: "Renault", mileageValue: 42000, mileageUnit: "mi" },
			},
		});
		expect(refused.status).toBe(400);
		expect(errorBody.parse(refused.body).error.fields).toEqual([
			{ path: "details.year", code: "invalid_number" },
		]);
		const detail = await request("GET", `/api/accounts/${vehicle.id}`);
		expect(detail.body).toMatchObject({ data: { details: { make: "Renault" } } });
	});

	it("refuses a vehicle's details on a property, a property's on a vehicle, and either on a depository", async () => {
		const property = await openAccount(home);
		const vehicle = await openAccount(car);
		const checking = await openAccount();

		const responses = await Promise.all([
			patchAccount(property.id, { details: blankVehicle }),
			patchAccount(vehicle.id, { details: blankProperty }),
			patchAccount(checking.id, { details: blankProperty }),
			patchAccount(checking.id, { details: blankVehicle }),
		]);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(errorBody.parse(body).error.fields).toEqual([
				{ path: "details", code: "invalid_details" },
			]);
		}
	});
});

async function detailOf(accountId: string) {
	return z
		.object({
			data: z.object({
				institutionName: z.string().nullable(),
				additionalDetails: z.object({
					institutionName: z.string().nullable(),
					institutionDomain: z.string().nullable(),
					notes: z.string().nullable(),
				}),
			}),
		})
		.parse((await request("GET", `/api/accounts/${accountId}`)).body).data;
}

async function listedInstitution(accountId: string) {
	const list = z
		.object({
			data: z.object({
				groups: z.array(
					z.object({
						accounts: z.array(z.object({ id: z.string(), institutionName: z.string().nullable() })),
					}),
				),
			}),
		})
		.parse((await request("GET", "/api/accounts")).body);

	return list.data.groups
		.flatMap((group) => group.accounts)
		.find((account) => account.id === accountId)?.institutionName;
}

describe("an account's institution and notes", () => {
	const noDetails = { institutionName: null, institutionDomain: null, notes: null };

	it("creates an account with the three trimmed, the list showing the institution", async () => {
		const account = await openAccount({
			institutionName: " BNP ",
			institutionDomain: " bnp.fr ",
			notes: "  IBAN FR76 dans le classeur  ",
		});

		expect(account.institutionName).toBe("BNP");
		await expect(detailOf(account.id)).resolves.toEqual({
			institutionName: "BNP",
			additionalDetails: {
				institutionName: "BNP",
				institutionDomain: "bnp.fr",
				notes: "IBAN FR76 dans le classeur",
			},
		});
		await expect(listedInstitution(account.id)).resolves.toBe("BNP");
	});

	it("saves a blank one as null, and creates without any", async () => {
		const blank = await openAccount({ institutionName: "  ", institutionDomain: "", notes: null });
		const none = await openAccount();

		await expect(detailOf(blank.id)).resolves.toEqual({
			institutionName: null,
			additionalDetails: noDetails,
		});
		await expect(detailOf(none.id)).resolves.toEqual({
			institutionName: null,
			additionalDetails: noDetails,
		});
	});

	it("edits each, clears one with null or a blank, and leaves the others alone", async () => {
		const account = await openAccount({ institutionName: "BNP", notes: "Ancien conseiller" });

		const edited = await patchAccount(account.id, {
			institutionDomain: " bnpparibas.fr ",
			notes: "Nouveau conseiller",
		});
		const nulled = await patchAccount(account.id, { notes: null });
		const blanked = await patchAccount(account.id, { institutionName: "   " });

		expect(edited.body).toMatchObject({
			data: {
				additionalDetails: {
					institutionName: "BNP",
					institutionDomain: "bnpparibas.fr",
					notes: "Nouveau conseiller",
				},
			},
		});
		expect(nulled.body).toMatchObject({
			data: { additionalDetails: { institutionName: "BNP", notes: null } },
		});
		expect(blanked.body).toMatchObject({
			data: {
				institutionName: null,
				additionalDetails: { ...noDetails, institutionDomain: "bnpparibas.fr" },
			},
		});
	});

	it("refuses a name or a domain past 255 characters and notes past 2000, never cut", async () => {
		const account = await openAccount({ institutionName: "BNP" });
		const tooLong = {
			institutionName: "a".repeat(256),
			institutionDomain: "b".repeat(256),
			notes: "c".repeat(2001),
		};
		const fields = [
			{ path: "institutionName", code: "too_big" },
			{ path: "institutionDomain", code: "too_big" },
			{ path: "notes", code: "too_big" },
		];

		const created = await postRaw({ ...valid, ...tooLong });
		const patched = await patchAccount(account.id, tooLong);
		const longest = await patchAccount(account.id, {
			institutionName: "a".repeat(255),
			notes: "c".repeat(2000),
		});

		expect(created.status).toBe(400);
		expect(created.body.error).toMatchObject({ code: "VALIDATION_ERROR", fields });
		expect(patched.status).toBe(400);
		expect(errorBody.parse(patched.body).error.fields).toEqual(fields);
		expect(longest.status).toBe(200);
		await expect(detailOf(account.id)).resolves.toMatchObject({
			institutionName: "a".repeat(255),
			additionalDetails: { notes: "c".repeat(2000) },
		});
	});

	it("shows a linked account's bank without a name typed, and its own name over the bank's", async () => {
		const card = await linkedCard(false);

		await expect(listedInstitution(card.id)).resolves.toBe("Banque Test");
		await expect(detailOf(card.id)).resolves.toEqual({
			institutionName: "Banque Test",
			additionalDetails: noDetails,
		});

		await patchAccount(card.id, { institutionName: "Ma banque" });

		await expect(listedInstitution(card.id)).resolves.toBe("Ma banque");
		await expect(detailOf(card.id)).resolves.toMatchObject({
			institutionName: "Ma banque",
			additionalDetails: { institutionName: "Ma banque" },
		});
	});
});

// Story 28.16: Sure's « Exclure de tous les rapports » switch, in the creation form too.
describe("an account created excluded from reports", () => {
	it("stores the switch, and reads it back excluded", async () => {
		const excluded = await openAccount({ excludedFromReports: true });
		const included = await openAccount();

		expect(excluded).toMatchObject({ excludedFromReports: true });
		expect(included).toMatchObject({ excludedFromReports: false });
		const detail = await request("GET", `/api/accounts/${excluded.id}`);
		expect(accountBody.parse(detail.body).data.excludedFromReports).toBe(true);
	});

	it("refuses a switch that is not a boolean", async () => {
		const { status, body } = await postRaw({ ...valid, excludedFromReports: "yes" });

		expect(status).toBe(400);
		expect(body.error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "excludedFromReports", code: "invalid_type" }],
		});
	});
});

describe("a viewer on a loan or a position", () => {
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

	it("reads an account's institution and notes, and is refused FORBIDDEN on an edit, nothing written", async () => {
		const account = await openAccount({ institutionName: "BNP", notes: "Conseiller" });
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const read = await viewer.request(`/api/accounts/${account.id}`);
		const edit = await viewer.request(`/api/accounts/${account.id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ institutionName: "LCL", notes: null }),
		});

		expect(read.status).toBe(200);
		expect(edit.status).toBe(403);
		expect(errorBody.parse(await edit.json()).error.code).toBe("FORBIDDEN");
		const detail = await request("GET", `/api/accounts/${account.id}`);
		expect(detail.body).toMatchObject({
			data: { additionalDetails: { institutionName: "BNP", notes: "Conseiller" } },
		});
	});

	it("is refused FORBIDDEN on an unlink, the account still linked", async () => {
		const card = await linkedCard(false);
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const unlink = await viewer.request(`/api/accounts/${card.id}/unlink`, { method: "DELETE" });

		expect(unlink.status).toBe(403);
		expect(errorBody.parse(await unlink.json()).error.code).toBe("FORBIDDEN");
		await expect(
			temp.db
				.select({ bankAccountId: accounts.bankAccountId })
				.from(accounts)
				.where(eq(accounts.id, card.id))
				.get(),
		).resolves.toEqual({ bankAccountId: card.bankAccountId });
	});

	it("reads a card's details and toggle, and is refused FORBIDDEN on either, nothing written", async () => {
		const card = await linkedCard(false);
		await patchAccount(card.id, { details: { ...blankCard, apr: "15,99" } });
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);
		const edit = (body: unknown) =>
			viewer.request(`/api/accounts/${card.id}`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});

		const read = await viewer.request(`/api/accounts/${card.id}`);
		const details = await edit({ details: { ...blankCard, apr: "20" } });
		const toggle = await edit({ treatBalanceAsAvailableCredit: true });

		expect(await read.json()).toMatchObject({
			data: { details: { apr: 159900 }, treatBalanceAsAvailableCredit: false },
		});
		expect([details.status, toggle.status]).toEqual([403, 403]);
		const detail = await request("GET", `/api/accounts/${card.id}`);
		expect(detail.body).toMatchObject({
			data: { details: { apr: 159900 }, treatBalanceAsAvailableCredit: false },
		});
	});

	it("refuses an edit of the opening balance with FORBIDDEN, nothing written", async () => {
		const account = await openPinned();
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const refused = await viewer.request(`/api/accounts/${account.id}/opening-balance`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ date: "2025-12-01", balance: "1,00" }),
		});

		expect(refused.status).toBe(403);
		expect(errorBody.parse(await refused.json()).error.code).toBe("FORBIDDEN");
		const detail = await request("GET", `/api/accounts/${account.id}`);
		expect(detail.body).toMatchObject({ data: { openingDate: "2026-01-10" } });
	});

	it("refuses a balance's dry run with FORBIDDEN, as Sure's require_account_permission!", async () => {
		const account = await openPinned();
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const refused = await viewer.request(`/api/accounts/${account.id}/snapshots/dry-run`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ date: "2026-03-05", balance: "1,00" }),
		});

		expect(refused.status).toBe(403);
		expect(errorBody.parse(await refused.json()).error.code).toBe("FORBIDDEN");
	});

	it("is refused a position's deletion or remap with FORBIDDEN, nothing written", async () => {
		const { account, securityId } = await heldFund();
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);
		const url = `/api/accounts/${account.id}/holdings/${securityId}`;

		const deleted = await viewer.request(url, { method: "DELETE" });
		const remapped = await viewer.request(`${url}/security`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ security: { source: "known", id: securityId } }),
		});

		expect([deleted.status, remapped.status]).toEqual([403, 403]);
		expect(errorBody.parse(await deleted.json()).error.code).toBe("FORBIDDEN");
		expect(errorBody.parse(await remapped.json()).error.code).toBe("FORBIDDEN");
		await expect((await holdings(account.id)).json()).resolves.toMatchObject({
			data: { positions: [{ security: { id: securityId } }] },
		});
	});

	it("reads its schedule", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const read = await viewer.request(`/api/accounts/${loan.id}/schedule`);

		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ data: { periodicPayment: 53_969 } });
	});

	it("reads its overview", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const read = await viewer.request(`/api/accounts/${loan.id}/overview`);

		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ data: { monthlyPayment: 53_969, insured: true } });
	});

	it("reads a property's details and overview, and is refused FORBIDDEN on an edit, nothing written", async () => {
		const property = await openAccount({ ...home, details: { locality: "Lyon" } });
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const read = await viewer.request(`/api/accounts/${property.id}`);
		const overviewRead = await viewer.request(`/api/accounts/${property.id}/overview`);
		const edit = await viewer.request(`/api/accounts/${property.id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ details: { ...blankProperty, locality: "Paris" } }),
		});

		expect(await read.json()).toMatchObject({ data: { details: { locality: "Lyon" } } });
		expect(overviewRead.status).toBe(200);
		expect(await overviewRead.json()).toMatchObject({
			data: { kind: "property", purchasePrice: 32_000_000 },
		});
		expect(edit.status).toBe(403);
		const detail = await request("GET", `/api/accounts/${property.id}`);
		expect(detail.body).toMatchObject({ data: { details: { locality: "Lyon" } } });
	});

	it("reads its payoff chart", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const read = await viewer.request(`/api/accounts/${loan.id}/payoff-chart?period=all`);

		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ data: { scheduledPayoffDate: "2045-12-05" } });
	});
});

const patchOpening = (id: string, body: unknown) =>
	request("PATCH", `/api/accounts/${id}/opening-balance`, body);

// Story 27.17's matrix: checking opened on 2026-01-10 at 1 500,00, with
// -120,00 on 2026-03-02, the clock at 2026-09-21.
describe("PATCH /api/accounts/:id/opening-balance", () => {
	const openingDetail = z.object({
		data: z.object({
			balance: z.number(),
			openingDate: z.string(),
			openingBalance: z.object({ balance: z.number(), notes: z.string().nullable() }),
		}),
	});

	it("moves the opening balance to an earlier date and recomputes today's balance", async () => {
		const account = await openPinned();

		const { status, body } = await patchOpening(account.id, {
			date: "2025-12-01",
			balance: "1 000,00",
			notes: "Relevé d'ouverture",
		});

		expect(status).toBe(200);
		expect(openingDetail.parse(body).data).toMatchObject({
			openingDate: "2025-12-01",
			openingBalance: { balance: 100000, notes: "Relevé d'ouverture" },
			balance: 88000,
		});
		await expect(balanceOnDay(account.id, "2025-12-01")).resolves.toBe(100000);
	});

	it("drops the days before a later date", async () => {
		const account = await openPinned();

		await patchOpening(account.id, { date: "2026-01-12", balance: "1 500,00" });

		await expect(balanceOnDay(account.id, "2026-01-11")).resolves.toBeUndefined();
		await expect(balanceOnDay(account.id, "2026-01-12")).resolves.toBe(150000);
	});

	it("saves a date after the oldest entry, as Sure's drawer, the balances starting at that entry", async () => {
		const account = await openPinned();

		const { status, body } = await patchOpening(account.id, {
			date: "2026-03-10",
			balance: "1 000,00",
		});

		expect(status).toBe(200);
		expect(openingDetail.parse(body).data).toMatchObject({
			openingDate: "2026-03-10",
			openingBalance: { balance: 100000 },
			balance: 100000,
		});
		await expect(balanceOnDay(account.id, "2026-03-01")).resolves.toBeUndefined();
		await expect(balanceOnDay(account.id, "2026-03-02")).resolves.toBe(-12000);
		await expect(balanceOnDay(account.id, "2026-03-10")).resolves.toBe(100000);
	});

	it("saves an amount alone when a line predates the opening date", async () => {
		const account = await openPinned();
		await postTransaction(account.id, { date: "2026-01-05", label: "Frais", amount: "-5,00" });

		const { status, body } = await patchOpening(account.id, {
			date: "2026-01-10",
			balance: "2 000,00",
		});

		expect(status).toBe(200);
		expect(openingDetail.parse(body).data).toMatchObject({
			openingDate: "2026-01-10",
			openingBalance: { balance: 200000 },
		});
	});

	it("refuses a day a snapshot holds, as Sure's unique valuation date, and writes nothing", async () => {
		const account = await openPinned();
		await recorded(account.id, { date: "2026-02-01", balance: "1 400,00" });

		const { status, body } = await patchOpening(account.id, {
			date: "2026-02-01",
			balance: "1,00",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "date", code: "snapshot_exists" }]);
		const detail = await request("GET", `/api/accounts/${account.id}`);
		expect(openingDetail.parse(detail.body).data).toMatchObject({
			openingDate: "2026-01-10",
			openingBalance: { balance: 150000 },
		});
	});

	it("refuses a future date and an invalid amount", async () => {
		const account = await openAccount(pinned);

		const future = await patchOpening(account.id, { date: "2026-09-22", balance: "1,00" });
		const amount = await patchOpening(account.id, { date: "2026-01-01", balance: "beaucoup" });

		expect(future.status).toBe(400);
		expect(errorBody.parse(future.body).error.fields).toEqual([
			{ path: "date", code: "date_in_future" },
		]);
		expect(errorBody.parse(amount.body).error.fields).toEqual([
			{ path: "balance", code: "invalid_amount" },
		]);

		const blank = await patchOpening(account.id, { date: "2026-01-01", balance: "  " });

		expect(blank.status).toBe(400);
		expect(errorBody.parse(blank.body).error.fields).toEqual([
			{ path: "balance", code: "amount_required" },
		]);
		const detail = await request("GET", `/api/accounts/${account.id}`);
		expect(openingDetail.parse(detail.body).data).toMatchObject({
			openingDate: "2026-01-10",
			openingBalance: { balance: 150000 },
		});
	});

	it("refuses a date before 1900, as an account's creation", async () => {
		const account = await openAccount(pinned);

		const { status, body } = await patchOpening(account.id, {
			date: "1899-12-31",
			balance: "1,00",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "date", code: "date_too_early" }]);
	});

	it("refuses the opening anchor's id on PATCH and DELETE /api/snapshots/:id, keeping it", async () => {
		const account = await openPinned();
		const anchorId = (await recorded(account.id, { date: "2026-01-10", balance: "1 500,00" })).id;

		const patched = await request("PATCH", `/api/snapshots/${anchorId}`, { balance: "1,00" });
		const deleted = await request("DELETE", `/api/snapshots/${anchorId}`);

		expect(patched.status).toBe(404);
		expect(deleted.status).toBe(404);
		const detail = await request("GET", `/api/accounts/${account.id}`);
		expect(openingDetail.parse(detail.body).data).toMatchObject({
			openingDate: "2026-01-10",
			openingBalance: { balance: 150000 },
		});
	});

	it("moves a linked account's, its day ending there and today staying the bank's", async () => {
		const account = await openAccount(pinned);
		const connectionId = crypto.randomUUID();
		const bankAccountId = crypto.randomUUID();
		await temp.db.insert(bankConnections).values({
			id: connectionId,
			connector: "enable-banking",
			institutionName: "Banque Test",
			country: "FR",
			status: "active",
			createdAt: 0,
			updatedAt: 0,
		});
		await temp.db.insert(bankAccounts).values({
			id: bankAccountId,
			bankConnectionId: connectionId,
			identificationHash: `hash-${bankAccountId}`,
			providerUid: `uid-${bankAccountId}`,
			name: "Compte courant",
			currency: "EUR",
			createdAt: 0,
			updatedAt: 0,
		});
		await linkBankAccount(
			{ db: temp.db, timeZone: "Europe/Paris" },
			account.id,
			{ bankAccountId, balance: toMinorUnits(200000) },
			{ origin: "sync" },
		);

		const { status, body } = await patchOpening(account.id, {
			date: "2026-01-01",
			balance: "1,00",
		});

		expect(status).toBe(200);
		expect(openingDetail.parse(body).data).toMatchObject({
			openingDate: "2026-01-01",
			openingBalance: { balance: 100 },
			balance: 200000,
		});
		await expect(balanceOnDay(account.id, "2026-01-01")).resolves.toBe(100);
		await expect(balanceOnDay(account.id, "2026-01-02")).resolves.toBe(200000);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status } = await patchOpening("nope", { date: "2026-01-01", balance: "1,00" });

		expect(status).toBe(404);
	});

	it("gives a loan's original principal the new amount, as Sure's", async () => {
		const loan = await openAccount({ ...mortgage, openingDate: "2026-01-10" });

		await patchOpening(loan.id, { date: "2026-01-10", balance: "175 000,00" });

		const overview = await request("GET", `/api/accounts/${loan.id}/overview`);
		expect(overview.body).toMatchObject({ data: { originalAmount: 17_500_000 } });
	});

	it("sets the opening anchor from a snapshot on its date", async () => {
		const account = await openPinned();

		const snapshot = await recorded(account.id, { date: "2026-01-10", balance: "1 800,00" });

		expect(snapshot).toMatchObject({ date: "2026-01-10", balance: 180000, gap: 0 });
		const detail = await request("GET", `/api/accounts/${account.id}`);
		expect(openingDetail.parse(detail.body).data).toMatchObject({
			openingDate: "2026-01-10",
			openingBalance: { balance: 180000 },
			balance: 168000,
		});
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 0 });
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

	// Sure's `Account.listable_manual`: the list keeps an inactive account
	// beside the others, and says which ones a bank feeds, the ones
	// `DELETE /api/accounts/:id` refuses.
	it("lists an inactive account in its group by name, and says which accounts are linked", async () => {
		const manual = await openAccount({ name: "Ancien livret", subtype: "savings" });
		const card = await linkedCard(false);
		await patchAccount(manual.id, { active: false });

		const list = z
			.object({
				data: z.object({
					groups: z.array(
						z.object({
							classification: z.string(),
							accounts: z.array(
								z.object({
									id: z.string(),
									name: z.string(),
									active: z.boolean(),
									linked: z.boolean(),
								}),
							),
						}),
					),
				}),
			})
			.parse((await request("GET", "/api/accounts")).body);
		const [assets, liabilities] = list.data.groups;

		expect(assets?.classification).toBe("asset");
		expect(assets?.accounts.find((account) => account.id === manual.id)).toEqual({
			id: manual.id,
			name: "Ancien livret",
			active: false,
			linked: false,
		});
		expect(liabilities?.accounts.find((account) => account.id === card.id)).toMatchObject({
			active: true,
			linked: true,
		});
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
					costBasis: "612.65",
					costBasisLocked: false,
					gain: -250,
					gainPercent: "-0.040806",
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
			data: { costBasis: "612.65", costBasisLocked: false },
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
			{ path: "costBasis", code: "invalid_cost_basis" },
		]);
		expect(notHeld.status).toBe(404);
		expect(notInvestment.status).toBe(409);
		expect(errorBody.parse(await notInvestment.json()).error.code).toBe("TRADES_NOT_SUPPORTED");
	});
});

const position = () => testClient(buildApp()).api.accounts[":id"].holdings[":securityId"];

describe("DELETE /api/accounts/:id/holdings/:securityId and PATCH its security", () => {
	it("deletes a position with its trades, answering its security, NOT_FOUND once gone", async () => {
		const { account, securityId } = await heldFund();
		const param = { id: account.id, securityId };

		const deleted = await position().$delete({ param });

		expect(deleted.status).toBe(200);
		await expect(deleted.json()).resolves.toEqual({ data: { securityId } });
		await expect((await holdings(account.id)).json()).resolves.toMatchObject({
			data: { positions: [], cash: 2_500_000, total: 2_500_000 },
		});
		const again = await position().$delete({ param });
		expect(again.status).toBe(404);
		expect(errorBody.parse(await again.json()).error.code).toBe("NOT_FOUND");
	});

	it("remaps a position onto a new listing, answering the security it is now in", async () => {
		const { account, securityId } = await heldFund();
		const ticker = `AI${crypto.randomUUID().slice(0, 6).toUpperCase()}.PA`;

		const remapped = await position().security.$patch({
			param: { id: account.id, securityId },
			json: {
				security: {
					source: "listing",
					ticker,
					mic: "XPAR",
					name: "Air Liquide",
					currency: "EUR",
					provider: "yahoo",
				},
			},
		});

		expect(remapped.status).toBe(200);
		const { data } = await remapped.json();
		expect(data.securityId).not.toBe(securityId);
		await expect((await holdings(account.id)).json()).resolves.toMatchObject({
			data: {
				positions: [{ security: { id: data.securityId, ticker, name: "Air Liquide" } }],
			},
		});
	});

	it("refuses a remap of a security the account never traded with NOT_FOUND", async () => {
		const { account, securityId } = await heldFund();

		const missing = await position().security.$patch({
			param: { id: account.id, securityId: "nope" },
			json: { security: { source: "known", id: securityId } },
		});

		expect(missing.status).toBe(404);
		expect(errorBody.parse(await missing.json()).error.code).toBe("NOT_FOUND");
	});

	it("answers the same security with nothing written, and refuses another currency on `security`", async () => {
		const { account, securityId } = await heldFund();
		const dollars = crypto.randomUUID();
		await temp.db.insert(securities).values({
			id: dollars,
			isin: null,
			ticker: `AAPL${dollars.slice(0, 6)}`,
			mic: "XNAS",
			name: "Apple",
			currency: "USD",
			provider: "yahoo",
			createdAt: 0,
			updatedAt: 0,
		});
		const param = { id: account.id, securityId };

		const same = await position().security.$patch({
			param,
			json: { security: { source: "known", id: securityId } },
		});
		const refused = await position().security.$patch({
			param,
			json: { security: { source: "known", id: dollars } },
		});
		const manual = await request(
			"PATCH",
			`/api/accounts/${account.id}/holdings/${securityId}/security`,
			{
				security: { source: "manual", name: "Fonds euros" },
			},
		);

		expect(same.status).toBe(200);
		await expect(same.json()).resolves.toEqual({ data: { securityId } });
		expect(refused.status).toBe(400);
		expect(errorBody.parse(await refused.json()).error.fields).toEqual([
			{ path: "security", code: "currency_mismatch" },
		]);
		// Sure's drawer offers provider results only.
		expect(manual.status).toBe(400);
		const refusedManual = errorBody.parse(manual.body).error;
		expect(refusedManual.code).toBe("VALIDATION_ERROR");
		expect(refusedManual.fields?.map(({ path }) => path)).toEqual(["security.source"]);
		await expect((await holdings(account.id)).json()).resolves.toMatchObject({
			data: { positions: [{ security: { id: securityId } }] },
		});
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

	it("amortises the opening balance from the opening date without an amount borrowed, as Sure's", async () => {
		const loan = await openAccount({
			...mortgage,
			openingBalance: "130 000,00",
			openingDate: "2020-12-05",
			details: { ...ingTerms, originalAmount: "", startDate: "" },
		});

		await expect(scheduleOf(loan.id)).resolves.toMatchObject({
			originationDate: "2020-12-05",
			periodicPayment: 53_969,
			totalInterest: 3_190_696,
			totalPaid: 16_190_696,
		});
	});

	it("answers null for a loan without a schedule, and for another account", async () => {
		const withoutRate = await openAccount({
			...mortgage,
			details: { ...ingTerms, rateType: "", interestRate: "" },
		});
		const withoutTerm = await openAccount({
			...mortgage,
			details: { ...ingTerms, originalAmount: "", termMonths: "" },
		});
		const withoutTerms = await openAccount(mortgage);
		const checking = await openAccount();

		const answers = await Promise.all(
			[withoutRate, withoutTerm, withoutTerms, checking].map((account) => scheduleOf(account.id)),
		);

		expect(answers).toEqual([null, null, null, null]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const response = await schedule("nope");

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json()).error.code).toBe("NOT_FOUND");
	});
});

const overview = (accountId: string) =>
	testClient(buildApp()).api.accounts[":id"].overview.$get({ param: { id: accountId } });

async function overviewOf(accountId: string) {
	const response = await overview(accountId);

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("GET /api/accounts/:id/overview", () => {
	it("reads the owner's ING mortgage on 4 October 2026", async () => {
		const loan = await openAccount({
			...mortgage,
			openingBalance: "105 104,82",
			details: ingTerms,
		});
		vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));

		const data = await overviewOf(loan.id);

		expect(data).toEqual({
			kind: "loan",
			asOf: "2026-10-04",
			currency: "EUR",
			originalAmount: 13_000_000,
			remainingBalance: 10_510_482,
			interestRate: 18_200,
			monthlyPayment: 53_969,
			termMonths: 300,
			rateType: "fixed",
			payoffDate: "2045-12-05",
			insured: true,
			totalCost: 17_138_696,
			insurance: { total: 948_000 },
			leverage: null,
			repaidPercent: 19,
			instalment: {
				number: 70,
				date: "2026-10-05",
				principal: 38_028,
				interest: 15_941,
				insurance: 3_160,
				total: 57_129,
				shares: { principal: 67, interest: 28, insurance: 6 },
			},
		});
	});

	it("quotes a variable loan's rate and payment in force, and its leverage", async () => {
		const loan = await openAccount({
			...mortgage,
			details: {
				...ingTerms,
				downPayment: "32 500,00",
				rateType: "variable",
				rateChanges: [{ effectiveDate: "2023-06-05", rate: "3" }],
			},
		});
		const payments = (await scheduleOf(loan.id))?.payments ?? [];

		const data = await overviewOf(loan.id);

		expect(data).toMatchObject({
			interestRate: 30_000,
			monthlyPayment: payments.find((payment) => payment.date >= "2026-09-21")?.payment,
			leverage: { tenths: 40, band: "conservative" },
		});
		expect(data?.kind === "loan" && data.monthlyPayment).not.toBe(53_969);
	});

	it("follows the terms once they are saved", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });

		const { status } = await patchAccount(loan.id, {
			details: { ...ingTerms, insuranceRate: "" },
		});

		expect(status).toBe(200);
		await expect(overviewOf(loan.id)).resolves.toMatchObject({
			insured: false,
			insurance: null,
			totalCost: 16_190_696,
		});
	});

	it("names an insurance rate with no schedule to apply it to", async () => {
		const loan = await openAccount({
			...mortgage,
			details: { ...ingTerms, termMonths: "" },
		});

		await expect(overviewOf(loan.id)).resolves.toMatchObject({
			originalAmount: 13_000_000,
			insured: false,
			insurance: { rate: 2_917 },
			totalCost: null,
			repaidPercent: 0,
			instalment: null,
		});
	});

	it("measures a loan without an amount borrowed by its opening balance, as Sure's", async () => {
		const loan = await openAccount({
			...mortgage,
			openingBalance: "130 000,00",
			openingDate: "2020-12-05",
			details: { ...ingTerms, originalAmount: "", startDate: "" },
		});
		await postSnapshot(loan.id, { date: "2026-09-05", balance: "105 104,82" });
		vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));

		await expect(overviewOf(loan.id)).resolves.toMatchObject({
			originalAmount: 13_000_000,
			remainingBalance: 10_510_482,
			monthlyPayment: 53_969,
			payoffDate: "2045-12-05",
			insured: true,
			insurance: { total: 948_000 },
			repaidPercent: 19,
			instalment: { number: 70, date: "2026-10-05", total: 57_129 },
		});
	});

	it("answers every unknown figure null for a loan without details, and null for another account", async () => {
		const withoutTerms = await openAccount(mortgage);
		const checking = await openAccount();

		await expect(overviewOf(withoutTerms.id)).resolves.toMatchObject({
			originalAmount: 18_000_000,
			remainingBalance: 18_000_000,
			interestRate: null,
			monthlyPayment: null,
			termMonths: null,
			rateType: null,
			insured: false,
			payoffDate: null,
			totalCost: null,
			insurance: null,
			leverage: null,
			repaidPercent: 0,
			instalment: null,
		});
		await expect(overviewOf(checking.id)).resolves.toBeNull();
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const response = await overview("nope");

		expect(response.status).toBe(404);
		expect(errorBody.parse(await response.json()).error.code).toBe("NOT_FOUND");
	});
});

describe("GET /api/accounts/:id/overview on a property or a vehicle", () => {
	it("measures a property's trend from its opening value, its purchase price", async () => {
		const property = await openAccount({
			...home,
			openingBalance: "300 000,00",
			openingDate: "2026-01-10",
		});
		await postSnapshot(property.id, { date: "2026-06-01", balance: "320 000,00" });

		await expect(overviewOf(property.id)).resolves.toEqual({
			kind: "property",
			currency: "EUR",
			balance: 32_000_000,
			purchasePrice: 30_000_000,
			trend: { amount: 2_000_000, percent: 6.7 },
		});
	});

	it("reads the earliest valuation by date, wherever it was written", async () => {
		const vehicle = await openAccount({ ...car, openingDate: "2026-03-01" });
		await postSnapshot(vehicle.id, { date: "2026-08-01", balance: "16 000,00" });
		await postSnapshot(vehicle.id, { date: "2026-02-01", balance: "21 000,00" });

		await expect(overviewOf(vehicle.id)).resolves.toMatchObject({
			kind: "vehicle",
			purchasePrice: 2_100_000,
			trend: { amount: -500_000 },
		});
	});

	it("gives no percentage from a purchase price of zero", async () => {
		const vehicle = await openAccount({ ...car, openingBalance: "0", openingDate: "2026-01-10" });
		await postSnapshot(vehicle.id, { date: "2026-06-01", balance: "5 000,00" });

		await expect(overviewOf(vehicle.id)).resolves.toMatchObject({
			purchasePrice: 0,
			balance: 500_000,
			trend: { amount: 500_000, percent: null },
		});
	});

	it("answers a property created before it had details", async () => {
		const property = await openAccount(home);
		await temp.db.update(accounts).set({ details: null }).where(eq(accounts.id, property.id));

		await expect(overviewOf(property.id)).resolves.toMatchObject({
			kind: "property",
			purchasePrice: 32_000_000,
			trend: { amount: 0, percent: 0 },
		});
	});
});

const payoffChart = (accountId: string, period: "1M" | "3M" | "6M" | "1Y" | "all") =>
	testClient(buildApp()).api.accounts[":id"]["payoff-chart"].$get({
		param: { id: accountId },
		query: { period },
	});

async function payoffChartOf(accountId: string, period: "1M" | "1Y" | "all" = "all") {
	const response = await payoffChart(accountId, period);

	expect(response.status).toBe(200);

	return (await response.json()).data;
}

describe("GET /api/accounts/:id/payoff-chart", () => {
	it("charts the owner's ING mortgage on contract on 6 October 2026", async () => {
		const loan = await openAccount({
			...mortgage,
			openingBalance: "104 724,54",
			details: ingTerms,
		});
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));

		const data = await payoffChartOf(loan.id);

		expect(data).toMatchObject({
			asOf: "2026-10-06",
			currency: "EUR",
			period: "all",
			from: "2020-12-05",
			to: "2045-12-05",
			balance: 10_472_454,
			// Sure's change line « since the loan started ».
			change: { amount: -2_527_546, percent: -19.4 },
			visible: ["actual", "scheduled", "projected"],
			scheduledPayoffDate: "2045-12-05",
			projectedPayoff: { status: "paid_off", date: "2045-12-05" },
			monthsSaved: 0,
			interestSaved: 0,
			balloon: null,
		});
		expect(data?.scheduled).toHaveLength(301);
		expect(data?.scheduled[0]).toEqual({ date: "2020-12-05", balance: 13_000_000 });
		// Each payment says what it repays, as Sure's `scheduled_series`; the amount borrowed does not.
		expect(data?.scheduled[70]).toEqual({
			date: "2026-10-05",
			balance: 10_472_454,
			principal: 38_028,
			interest: 15_941,
		});
		expect(data?.projected).toHaveLength(231);
		expect(data?.projected[0]).toEqual({ date: "2026-10-06", balance: 10_472_454 });
		expect(data?.projected.at(-1)).toEqual({ date: "2045-12-05", balance: 0 });
		// Recorded from the opening date, never past today.
		expect(data?.actual[0]).toEqual({ date: "2026-09-01", balance: 10_472_454 });
		expect(data?.actual.at(-1)).toEqual({ date: "2026-10-06", balance: 10_472_454 });
		await expect(scheduleOf(loan.id)).resolves.toMatchObject({
			projectedPayoff: { status: "paid_off", date: "2045-12-05" },
		});
	});

	it("ends a period today, where the projection draws no line", async () => {
		const loan = await openAccount({
			...mortgage,
			openingBalance: "104 724,54",
			details: ingTerms,
		});
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));

		const data = await payoffChartOf(loan.id, "1Y");

		expect(data).toMatchObject({
			period: "1Y",
			from: "2025-10-06",
			to: "2026-10-06",
			visible: ["actual", "scheduled"],
			projectedPayoff: { status: "paid_off", date: "2045-12-05" },
		});
		expect(data?.scheduled.at(0)?.date).toBe("2025-10-05");
		expect(data?.scheduled.at(-1)?.date).toBe("2026-11-05");
		expect(data?.projected.map((point) => point.date)).toEqual(["2026-10-06", "2026-11-05"]);
	});

	it("thins years of recorded balances as the account chart does", async () => {
		const loan = await openAccount({
			...mortgage,
			openingDate: "2023-10-01",
			openingBalance: "104 724,54",
			details: ingTerms,
		});
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));

		const actual = (await payoffChartOf(loan.id))?.actual ?? [];

		// Weekly past a year: each week's last day, today last.
		expect(actual.length).toBeLessThan(200);
		expect(actual.at(-1)?.date).toBe("2026-10-06");
	});

	it("finishes 25 months early after 10 000,00 € repaid early", async () => {
		const loan = await openAccount({
			...mortgage,
			openingBalance: "94 724,54",
			details: ingTerms,
		});
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));

		await expect(payoffChartOf(loan.id)).resolves.toMatchObject({
			to: "2045-12-05",
			projectedPayoff: { status: "paid_off", date: "2043-11-05" },
			monthsSaved: 25,
			interestSaved: 390_600,
			balloon: null,
		});
		await expect(scheduleOf(loan.id)).resolves.toMatchObject({
			projectedPayoff: { status: "paid_off", date: "2043-11-05" },
		});
	});

	it("names what is left at maturity for a balance the contract no longer clears", async () => {
		const loan = await openAccount({
			...mortgage,
			openingBalance: "105 724,54",
			details: ingTerms,
		});
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));

		await expect(payoffChartOf(loan.id)).resolves.toMatchObject({
			projectedPayoff: { status: "not_converged" },
			monthsSaved: null,
			interestSaved: null,
			balloon: 141_701,
		});
		await expect(scheduleOf(loan.id)).resolves.toMatchObject({
			projectedPayoff: { status: "not_converged" },
		});
	});

	it("projects nothing for a loan that owes nothing", async () => {
		const loan = await openAccount({ ...mortgage, openingBalance: "0", details: ingTerms });

		const data = await payoffChartOf(loan.id);

		expect(data).toMatchObject({
			projectedPayoff: { status: "not_applicable" },
			projected: [],
			visible: ["actual", "scheduled"],
			monthsSaved: null,
			interestSaved: null,
			balloon: null,
		});
		await expect(scheduleOf(loan.id)).resolves.toMatchObject({
			projectedPayoff: { status: "not_applicable" },
		});
	});

	it("follows the balance once a snapshot records it", async () => {
		const loan = await openAccount({
			...mortgage,
			openingBalance: "104 724,54",
			details: ingTerms,
		});
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));

		const { status } = await postSnapshot(loan.id, { date: "2026-10-06", balance: "94 724,54" });

		expect(status).toBe(201);
		await expect(payoffChartOf(loan.id)).resolves.toMatchObject({
			balance: 9_472_454,
			projectedPayoff: { status: "paid_off", date: "2043-11-05" },
		});
	});

	it("charts a loan without an amount borrowed from its opening balance, as Sure's", async () => {
		const loan = await openAccount({
			...mortgage,
			openingBalance: "130 000,00",
			openingDate: "2020-12-05",
			details: { ...ingTerms, originalAmount: "", startDate: "" },
		});
		await postSnapshot(loan.id, { date: "2026-09-05", balance: "105 104,82" });
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));

		const data = await payoffChartOf(loan.id);

		expect(data).toMatchObject({
			from: "2020-12-05",
			scheduledPayoffDate: "2045-12-05",
			balance: 10_510_482,
		});
		expect(data?.scheduled[0]).toEqual({ date: "2020-12-05", balance: 13_000_000 });
		expect(data?.change).toMatchObject({ amount: -2_489_518 });
	});

	it("answers null for a loan without a schedule, and for another account", async () => {
		const withoutTerm = await openAccount({
			...mortgage,
			details: { ...ingTerms, originalAmount: "", termMonths: "" },
		});
		const withoutTerms = await openAccount(mortgage);
		const checking = await openAccount();

		const answers = await Promise.all(
			[withoutTerm, withoutTerms, checking].map((account) => payoffChartOf(account.id)),
		);

		expect(answers).toEqual([null, null, null]);
	});

	it("refuses an unknown period, and answers NOT_FOUND for an unknown account", async () => {
		const loan = await openAccount({ ...mortgage, details: ingTerms });

		const refused = await buildApp().request(`/api/accounts/${loan.id}/payoff-chart?period=2Y`);
		const unknown = await payoffChart("nope", "all");

		expect(refused.status).toBe(400);
		expect(errorBody.parse(await refused.json()).error.code).toBe("VALIDATION_ERROR");
		expect(unknown.status).toBe(404);
		expect(errorBody.parse(await unknown.json()).error.code).toBe("NOT_FOUND");
	});
});

const defaultIdBody = z.object({ data: z.object({ defaultAccountId: z.string().nullable() }) });

/** The names of `group`'s accounts among `wanted`, in the listed order. */
function namesAmong(group: { accounts: { name: string }[] }, wanted: string[]) {
	return group.accounts.map(({ name }) => name).filter((name) => wanted.includes(name));
}

async function saveOrder(order: string, app = buildApp()) {
	return app.request("/api/preferences", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ defaultAccountOrder: order }),
	});
}

const orderedBody = z.object({
	data: z.object({
		groups: z.tuple([
			z.object({ accounts: z.array(z.object({ name: z.string() })) }),
			z.object({ accounts: z.array(z.object({ name: z.string() })) }),
		]),
	}),
});

async function defaultOf(app = buildApp()) {
	const response = await app.request("/api/accounts");

	return defaultIdBody.parse(await response.json()).data.defaultAccountId;
}

async function setDefault(id: string, app = buildApp()) {
	const response = await app.request(`/api/accounts/${id}/default`, { method: "PUT" });

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

async function removeDefault(id: string, app = buildApp()) {
	const response = await app.request(`/api/accounts/${id}/default`, { method: "DELETE" });

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

describe("the default account for new transactions", () => {
	const silent = createLogger("silent");
	const SECOND_ADMIN = { email: "second@example.test", password: "battery staple horse" };
	// Not `addViewer`'s: the viewer block above created that one already.
	const READER = { email: "reader@example.test", password: "horse staple battery" };
	let auth: Auth;
	let secondCookie: string;
	let viewerCookie: string;

	// Two sign-ins for the block, on a fresh allowance: Better Auth allows
	// three per ten seconds, and the viewer block above spent one.
	beforeAll(async () => {
		await temp.db.delete(rateLimits);
		auth = createTestAuth(temp.db, silent);
		await auth.api.createUser({ body: { ...READER, name: "", data: { role: "viewer" } } });
		viewerCookie = cookieOf(await signIn(buildTestApp(temp.db, silent, auth), READER));
		await auth.api.createUser({ body: { ...SECOND_ADMIN, name: "", data: { role: "admin" } } });
		secondCookie = cookieOf(await signIn(buildTestApp(temp.db, silent, auth), SECOND_ADMIN));
	});

	const second = () => withSession(buildTestApp(temp.db, silent, auth), secondCookie);
	const viewer = () => withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

	it("sets an active manual checking account as the default, then switches to another", async () => {
		const checking = await openAccount();
		const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });

		const set = await setDefault(checking.id);

		expect(set).toEqual({ status: 200, body: { data: { defaultAccountId: checking.id } } });
		await expect(defaultOf()).resolves.toBe(checking.id);

		expect((await setDefault(card.id)).status).toBe(200);
		await expect(defaultOf()).resolves.toBe(card.id);
	});

	it("removes the default, whichever account the path names", async () => {
		const checking = await openAccount();
		const other = await openAccount({ name: "Livret A", subtype: "savings" });
		await setDefault(checking.id);

		const removed = await removeDefault(other.id);

		expect(removed).toEqual({ status: 200, body: { data: { defaultAccountId: null } } });
		await expect(defaultOf()).resolves.toBeNull();
	});

	it("refuses a loan, an inactive and a linked account DEFAULT_ACCOUNT_NOT_ELIGIBLE, the default kept", async () => {
		const checking = await openAccount();
		await setDefault(checking.id);
		const loan = await openAccount(mortgage);
		const inactive = await openAccount({ name: "Ancien compte" });
		await request("PATCH", `/api/accounts/${inactive.id}`, { active: false });
		const linked = await linkedCard(false);

		const refusals = await Promise.all(
			[loan.id, inactive.id, linked.id].map(async (id) => setDefault(id)),
		);

		for (const refused of refusals) {
			expect(refused.status).toBe(409);
			expect(errorBody.parse(refused.body).error.code).toBe("DEFAULT_ACCOUNT_NOT_ELIGIBLE");
		}

		await expect(defaultOf()).resolves.toBe(checking.id);
	});

	it("refuses an unknown account NOT_FOUND on either method", async () => {
		const set = await setDefault("missing");
		const removed = await removeDefault("missing");

		expect(set.status).toBe(404);
		expect(errorBody.parse(set.body).error.code).toBe("NOT_FOUND");
		expect(removed.status).toBe(404);
		expect(errorBody.parse(removed.body).error.code).toBe("NOT_FOUND");
	});

	it("keeps each administrator's default their own", async () => {
		const checking = await openAccount();
		const card = await openAccount({ name: "Carte", type: "credit_card", subtype: null });

		await setDefault(checking.id);
		await setDefault(card.id, second());

		await expect(defaultOf()).resolves.toBe(checking.id);
		await expect(defaultOf(second())).resolves.toBe(card.id);

		await removeDefault(card.id, second());

		await expect(defaultOf()).resolves.toBe(checking.id);
		await expect(defaultOf(second())).resolves.toBeNull();
	});

	it("keeps a deactivated default stored, and clears a deleted one", async () => {
		const checking = await openAccount();
		await setDefault(checking.id);

		await request("PATCH", `/api/accounts/${checking.id}`, { active: false });

		await expect(defaultOf()).resolves.toBe(checking.id);

		const deleted = await request("DELETE", `/api/accounts/${checking.id}`);

		expect(deleted.status).toBe(200);
		await expect(defaultOf()).resolves.toBeNull();
	});

	it("lists each group in each administrator's own saved order, the viewer's by name", async () => {
		const names = ["Ordre Alpha", "Ordre Bravo", "Ordre Charlie"];
		const cards = ["Ordre Carte Petite", "Ordre Carte Grosse"];
		await openAccount({ name: "Ordre Alpha", openingBalance: "200,00" });
		await openAccount({ name: "Ordre Bravo", openingBalance: "900,00" });
		await openAccount({ name: "Ordre Charlie", openingBalance: "50,00" });
		await openAccount({
			name: "Ordre Carte Petite",
			type: "credit_card",
			subtype: null,
			openingBalance: "300,00",
		});
		await openAccount({
			name: "Ordre Carte Grosse",
			type: "credit_card",
			subtype: null,
			openingBalance: "800,00",
		});
		const listed = async (app = buildApp()) => {
			const body = orderedBody.parse(await (await app.request("/api/accounts")).json());

			return {
				assets: namesAmong(body.data.groups[0], names),
				liabilities: namesAmong(body.data.groups[1], cards),
			};
		};

		try {
			await expect(listed()).resolves.toEqual({
				assets: names,
				liabilities: ["Ordre Carte Grosse", "Ordre Carte Petite"],
			});

			expect((await saveOrder("balance_desc")).status).toBe(200);
			expect((await saveOrder("name_desc", second())).status).toBe(200);

			// A liability's balance is what is owed, positive as Sure's: the
			// largest debt comes first.
			await expect(listed()).resolves.toEqual({
				assets: ["Ordre Bravo", "Ordre Alpha", "Ordre Charlie"],
				liabilities: ["Ordre Carte Grosse", "Ordre Carte Petite"],
			});
			await expect(listed(second())).resolves.toEqual({
				assets: names.toReversed(),
				liabilities: ["Ordre Carte Petite", "Ordre Carte Grosse"],
			});
			await expect(listed(viewer())).resolves.toEqual({
				assets: names,
				liabilities: ["Ordre Carte Grosse", "Ordre Carte Petite"],
			});

			expect((await saveOrder("balance_asc")).status).toBe(200);

			await expect(listed()).resolves.toEqual({
				assets: ["Ordre Charlie", "Ordre Alpha", "Ordre Bravo"],
				liabilities: ["Ordre Carte Petite", "Ordre Carte Grosse"],
			});
		} finally {
			await saveOrder("name_asc");
			await saveOrder("name_asc", second());
		}
	});

	it("refuses a viewer FORBIDDEN on either method, nothing written", async () => {
		const checking = await openAccount();
		await removeDefault(checking.id);

		const set = await setDefault(checking.id, viewer());
		const removed = await removeDefault(checking.id, viewer());

		expect(set.status).toBe(403);
		expect(errorBody.parse(set.body).error.code).toBe("FORBIDDEN");
		expect(removed.status).toBe(403);
		await expect(defaultOf(viewer())).resolves.toBeNull();
		await expect(defaultOf()).resolves.toBeNull();
	});
});
