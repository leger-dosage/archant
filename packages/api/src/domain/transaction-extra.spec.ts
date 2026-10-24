import { describe, expect, it } from "vitest";

import { mergeExtra } from "./transaction-extra.ts";

describe("mergeExtra", () => {
	it("keeps the stored details and overwrites them with the line's", () => {
		expect(
			mergeExtra(
				{ enable_banking: { merchant_category_code: "5411", fx_rate: "1.08" } },
				{ enable_banking: { fx_rate: "1.09" } },
				false,
			),
		).toEqual({ enable_banking: { merchant_category_code: "5411", fx_rate: "1.09" } });
	});

	it("drops pending once the line is booked, and keeps it while it is not", () => {
		const stored = { enable_banking: { pending: true as const, merchant_category_code: "5462" } };

		expect(mergeExtra(stored, null, false)).toEqual({
			enable_banking: { merchant_category_code: "5462" },
		});
		expect(mergeExtra(stored, { enable_banking: { pending: true } }, true)).toEqual(stored);
	});

	it("leaves nothing when neither side holds a detail", () => {
		expect(mergeExtra({ enable_banking: { pending: true } }, null, false)).toBeNull();
		expect(mergeExtra(null, null, false)).toBeNull();
		expect(mergeExtra(null, { enable_banking: { fx_rate: "1.08" } }, false)).toEqual({
			enable_banking: { fx_rate: "1.08" },
		});
	});
});
