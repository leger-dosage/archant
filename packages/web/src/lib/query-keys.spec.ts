import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "./query-keys";

describe("queryKeys.accounts.balances", () => {
	it("goes stale when its account is invalidated, and only then", async () => {
		const client = new QueryClient();
		const own = queryKeys.accounts.balances("a", "3M");
		const other = queryKeys.accounts.balances("b", "3M");
		client.setQueryData(own, { points: [] });
		client.setQueryData(other, { points: [] });

		// What every transaction write does through `useInvalidateAccount`.
		await client.invalidateQueries({ queryKey: queryKeys.accounts.detail("a") });

		expect(client.getQueryState(own)?.isInvalidated).toBe(true);
		expect(client.getQueryState(other)?.isInvalidated).toBe(false);
	});
});
