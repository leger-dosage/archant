import { describe, expect, it } from "vitest";

import { toFieldErrors } from "../lib/zod-error.ts";
import {
	MAX_BULK_IDS,
	MAX_MERCHANT_FILTER,
	MAX_TAGS_PER_TRANSACTION,
	MAX_TAG_FILTER,
	bulkDeleteBodySchema,
	bulkUpdateBodySchema,
	compareAmountBounds,
	parseAmountBound,
	transactionFilterSchema,
	updateTransactionSchema,
} from "./transactions.ts";

describe("parseAmountBound", () => {
	it.each([
		["42,90", { units: 4290n, scale: 2 }],
		["42.90", { units: 4290n, scale: 2 }],
		["20", { units: 20n, scale: 0 }],
		["0,005", { units: 5n, scale: 3 }],
		[" 50 ", { units: 50n, scale: 0 }],
		["1 234,56", { units: 123456n, scale: 2 }],
		["1 234,56", { units: 123456n, scale: 2 }],
		["1 234 567.8", { units: 12345678n, scale: 1 }],
		["999999999999999", { units: 999999999999999n, scale: 0 }],
		["1,0123456789", { units: 10123456789n, scale: 10 }],
	])("reads %j exactly", (text, expected) => {
		expect(parseAmountBound(text)).toEqual(expected);
	});

	it.each([
		["42,"],
		[",5"],
		["-5"],
		["+5"],
		["−5"],
		["abc"],
		[""],
		["12 34"],
		["1 234 5"],
		["42,90,1"],
		// Sixteen integer digits, eleven decimals: past any amount or currency.
		["1234567890123456"],
		["1,01234567890"],
	])("refuses %j", (text) => {
		expect(parseAmountBound(text)).toBeNull();
	});
});

describe("compareAmountBounds", () => {
	it("compares values written with different numbers of decimals", () => {
		expect(compareAmountBounds({ units: 429n, scale: 1 }, { units: 4290n, scale: 2 })).toBe(0);
		expect(compareAmountBounds({ units: 429n, scale: 1 }, { units: 43n, scale: 0 })).toBe(-1);
		expect(compareAmountBounds({ units: 43n, scale: 0 }, { units: 42999n, scale: 3 })).toBe(1);
		expect(compareAmountBounds({ units: 60n, scale: 0 }, { units: 5000n, scale: 2 })).toBe(1);
	});
});

describe("transactionFilterSchema", () => {
	it("reads a lone category as a list, and repeated ones in order", () => {
		expect(transactionFilterSchema.parse({ category: "none" }).category).toEqual(["none"]);
		expect(transactionFilterSchema.parse({ category: ["c1", "none"] }).category).toEqual([
			"c1",
			"none",
		]);
		expect(transactionFilterSchema.parse({}).category).toBeUndefined();
	});

	it("reads a lone merchant as a list, and repeated ones in order", () => {
		expect(transactionFilterSchema.parse({ merchant: "m1" }).merchant).toEqual(["m1"]);
		expect(transactionFilterSchema.parse({ merchant: ["m1", "m2"] }).merchant).toEqual([
			"m1",
			"m2",
		]);
		expect(transactionFilterSchema.parse({}).merchant).toBeUndefined();
	});

	it("refuses more merchants than the cap", () => {
		const merchant = Array.from({ length: MAX_MERCHANT_FILTER + 1 }, (_, index) => `m${index}`);

		expect(transactionFilterSchema.safeParse({ merchant }).success).toBe(false);
		expect(transactionFilterSchema.safeParse({ merchant: merchant.slice(1) }).success).toBe(true);
	});

	it("reads a lone direction as a list, drops repeats and refuses an unknown one", () => {
		expect(transactionFilterSchema.parse({ direction: "income" }).direction).toEqual(["income"]);
		expect(
			transactionFilterSchema.parse({ direction: ["transfer", "expense", "transfer"] }).direction,
		).toEqual(["transfer", "expense"]);
		expect(transactionFilterSchema.parse({}).direction).toBeUndefined();
		expect(transactionFilterSchema.safeParse({ direction: "refund" }).success).toBe(false);
		expect(bulkDeleteBodySchema.parse({ filter: { direction: "transfer" } }).selection).toEqual({
			filter: { direction: ["transfer"] },
		});
	});

	it("reads a lone tag as a list, repeated ones in order, and refuses more than the cap", () => {
		const tag = Array.from({ length: MAX_TAG_FILTER + 1 }, (_, index) => `t${index}`);

		expect(transactionFilterSchema.parse({ tag: "t1" }).tag).toEqual(["t1"]);
		expect(transactionFilterSchema.parse({ tag: ["t1", "t2"] }).tag).toEqual(["t1", "t2"]);
		expect(transactionFilterSchema.parse({}).tag).toBeUndefined();
		expect(transactionFilterSchema.safeParse({ tag }).success).toBe(false);
		expect(transactionFilterSchema.safeParse({ tag: tag.slice(1) }).success).toBe(true);
		expect(transactionFilterSchema.safeParse({ tag: ["t1", ""] }).success).toBe(false);
	});

	it("refuses an empty account, category or merchant rather than matching nothing", () => {
		expect(transactionFilterSchema.safeParse({ category: "" }).success).toBe(false);
		expect(transactionFilterSchema.safeParse({ merchant: ["m1", ""] }).success).toBe(false);
		expect(transactionFilterSchema.safeParse({ account: ["a1", ""] }).success).toBe(false);
	});
});

describe("updateTransactionSchema", () => {
	it("keeps a category id, a cleared category, and no category at all apart", () => {
		const schema = updateTransactionSchema("EUR");

		expect(schema.parse({ categoryId: "c1" })).toEqual({ categoryId: "c1" });
		expect(schema.parse({ categoryId: null })).toEqual({ categoryId: null });
		expect(schema.parse({})).toEqual({});
		expect(schema.safeParse({ categoryId: "" }).success).toBe(false);
	});

	it("keeps a merchant id, a cleared merchant, and no merchant at all apart", () => {
		const schema = updateTransactionSchema("EUR");

		expect(schema.parse({ merchantId: "m1" })).toEqual({ merchantId: "m1" });
		expect(schema.parse({ merchantId: null })).toEqual({ merchantId: null });
		expect(schema.safeParse({ merchantId: "" }).success).toBe(false);
	});

	it("keeps a tag set, an empty one, and none at all apart, dropping repeats", () => {
		const schema = updateTransactionSchema("EUR");

		expect(schema.parse({ tagIds: ["t1", "t2", "t1"] })).toEqual({ tagIds: ["t1", "t2"] });
		expect(schema.parse({ tagIds: [] })).toEqual({ tagIds: [] });
		expect(schema.parse({})).toEqual({});
		expect(schema.safeParse({ tagIds: [""] }).success).toBe(false);
	});

	it("refuses more tags than the cap, counting repeats once", () => {
		const schema = updateTransactionSchema("EUR");
		const tagIds = Array.from({ length: MAX_TAGS_PER_TRANSACTION + 1 }, (_, index) => `t${index}`);

		expect(schema.safeParse({ tagIds }).error?.issues[0]?.path).toEqual(["tagIds"]);
		expect(schema.safeParse({ tagIds: [...tagIds.slice(1), "t1"] }).success).toBe(true);
	});
});

describe("bulk selection", () => {
	const patch = { categoryId: "c1" };

	it("reads ids, dropping repeats, before counting them", () => {
		const ids = [...Array.from({ length: MAX_BULK_IDS }, (_, index) => `t${index}`), "t0"];

		expect(bulkUpdateBodySchema.parse({ ids, patch }).selection).toEqual({
			ids: ids.slice(0, MAX_BULK_IDS),
		});
		expect(bulkDeleteBodySchema.parse({ ids: ["t1", "t1"] })).toEqual({
			selection: { ids: ["t1"] },
		});
	});

	it.each([
		["no id", { ids: [] }, "ids", "too_small"],
		[
			"too many ids",
			{ ids: Array.from({ length: MAX_BULK_IDS + 1 }, (_, index) => `t${index}`) },
			"ids",
			"too_big",
		],
		["ids and a filter", { ids: ["t1"], filter: {} }, "selection", "ids_or_filter"],
		["neither", {}, "selection", "ids_or_filter"],
	])("refuses %s", (_label, body, path, code) => {
		const result = bulkDeleteBodySchema.safeParse(body);

		expect(result.success).toBe(false);
		expect(result.error && toFieldErrors(result.error)).toEqual([{ path, code }]);
	});

	it("reads the filter as the list's query, a lone value as a list", () => {
		expect(
			bulkDeleteBodySchema.parse({
				filter: { category: "none", tag: ["g1", "g2"], amountMin: "20" },
			}),
		).toEqual({
			selection: {
				filter: { category: ["none"], tag: ["g1", "g2"], amountMin: { units: 20n, scale: 0 } },
			},
		});
	});

	it("refuses a filter the list would refuse", () => {
		const result = bulkDeleteBodySchema.safeParse({
			filter: { from: "2026-09-10", to: "2026-09-01" },
		});

		expect(result.error && toFieldErrors(result.error)).toEqual([
			{ path: "filter.to", code: "before_from" },
		]);
	});

	it("refuses an unknown filter key rather than widening to every transaction", () => {
		const result = bulkDeleteBodySchema.safeParse({ filter: { categorie: ["c1"] } });

		expect(result.success).toBe(false);
	});
});

describe("bulk patch", () => {
	const ids = ["t1"];

	it("keeps a cleared merchant apart from an untouched one", () => {
		expect(bulkUpdateBodySchema.parse({ ids, patch: { merchantId: null } }).patch).toEqual({
			merchantId: null,
		});
	});

	it("drops repeated tags, then refuses none or more than the cap", () => {
		expect(bulkUpdateBodySchema.parse({ ids, patch: { addTagIds: ["g1", "g1"] } }).patch).toEqual({
			addTagIds: ["g1"],
		});
		expect(bulkUpdateBodySchema.safeParse({ ids, patch: { addTagIds: [] } }).success).toBe(false);
		const tags = Array.from({ length: MAX_TAGS_PER_TRANSACTION + 1 }, (_, index) => `g${index}`);
		expect(bulkUpdateBodySchema.safeParse({ ids, patch: { addTagIds: tags } }).success).toBe(false);
	});

	it("refuses a patch that changes nothing", () => {
		const result = bulkUpdateBodySchema.safeParse({ ids, patch: {} });

		expect(result.error && toFieldErrors(result.error)).toEqual([
			{ path: "patch", code: "empty_patch" },
		]);
	});

	it("drops the date, the amount, the label and the notes", () => {
		expect(
			bulkUpdateBodySchema.parse({
				ids,
				patch: { excluded: true, date: "2026-09-10", amount: "1", label: "Autre", notes: "x" },
			}).patch,
		).toEqual({ excluded: true });
		expect(bulkUpdateBodySchema.safeParse({ ids, patch: { label: "Autre" } }).success).toBe(false);
	});
});
