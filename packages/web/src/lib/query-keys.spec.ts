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

describe("queryKeys.accounts.snapshots", () => {
	it("goes stale when its account is invalidated, and only then", async () => {
		const client = new QueryClient();
		const own = queryKeys.accounts.snapshots("a", 1);
		const other = queryKeys.accounts.snapshots("b", 1);
		client.setQueryData(own, { items: [] });
		client.setQueryData(other, { items: [] });

		// What every transaction write does through `useInvalidateAccount`.
		await client.invalidateQueries({ queryKey: queryKeys.accounts.detail("a") });

		expect(client.getQueryState(own)?.isInvalidated).toBe(true);
		expect(client.getQueryState(other)?.isInvalidated).toBe(false);
	});
});

describe("queryKeys.transactions.all", () => {
	it("prefixes the cross-account list and every account's list", async () => {
		const client = new QueryClient();
		const list = queryKeys.transactions.list({ q: "loyer" }, 2);
		const account = queryKeys.transactions.byAccount("a", 1);
		client.setQueryData(list, { items: [] });
		client.setQueryData(account, { items: [] });

		// What every transaction write does through `useInvalidateAccount`.
		await client.invalidateQueries({ queryKey: queryKeys.transactions.all });

		expect(client.getQueryState(list)?.isInvalidated).toBe(true);
		expect(client.getQueryState(account)?.isInvalidated).toBe(true);
	});
});
