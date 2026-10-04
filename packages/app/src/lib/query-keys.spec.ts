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

describe("queryKeys.accounts.imports", () => {
	it("goes stale when its account is invalidated, and only then", async () => {
		const client = new QueryClient();
		const own = queryKeys.accounts.imports("a", 1);
		const other = queryKeys.accounts.imports("b", 1);
		client.setQueryData(own, { items: [] });
		client.setQueryData(other, { items: [] });

		// What confirming or reverting an import does through `useInvalidateAccount`.
		await client.invalidateQueries({ queryKey: queryKeys.accounts.detail("a") });

		expect(client.getQueryState(own)?.isInvalidated).toBe(true);
		expect(client.getQueryState(other)?.isInvalidated).toBe(false);
	});
});

describe("queryKeys.accounts.trades", () => {
	it("goes stale when its account is invalidated, and only then", async () => {
		const client = new QueryClient();
		const own = queryKeys.accounts.trades("a", 1);
		const other = queryKeys.accounts.trades("b", 1);
		client.setQueryData(own, { items: [] });
		client.setQueryData(other, { items: [] });

		// What every trade write does through `useInvalidateAccount`.
		await client.invalidateQueries({ queryKey: queryKeys.accounts.detail("a") });

		expect(client.getQueryState(own)?.isInvalidated).toBe(true);
		expect(client.getQueryState(other)?.isInvalidated).toBe(false);
	});
});

describe("queryKeys.securities.all", () => {
	it("prefixes every search, which a trade write refreshes", async () => {
		const client = new QueryClient();
		const search = queryKeys.securities.search("lvmh");
		client.setQueryData(search, { known: [] });

		await client.invalidateQueries({ queryKey: queryKeys.securities.all });

		expect(client.getQueryState(search)?.isInvalidated).toBe(true);
	});
});

describe("queryKeys.transactions.all", () => {
	it("prefixes the cross-account list, its totals, its latest rows and every account's list", async () => {
		const client = new QueryClient();
		const list = queryKeys.transactions.list({ q: "loyer" }, 2);
		const totals = queryKeys.transactions.totals({ q: "loyer" });
		const recent = queryKeys.transactions.recent({ category: ["c"] });
		const account = queryKeys.transactions.byAccount("a", 1);
		client.setQueryData(list, { items: [] });
		client.setQueryData(totals, { total: 0 });
		client.setQueryData(recent, []);
		client.setQueryData(account, { items: [] });

		// What every transaction write does through `useInvalidateAccount`.
		await client.invalidateQueries({ queryKey: queryKeys.transactions.all });

		expect(client.getQueryState(list)?.isInvalidated).toBe(true);
		expect(client.getQueryState(totals)?.isInvalidated).toBe(true);
		expect(client.getQueryState(recent)?.isInvalidated).toBe(true);
		expect(client.getQueryState(account)?.isInvalidated).toBe(true);
	});
});

describe("queryKeys.transactions.ofAccount", () => {
	it("prefixes every page of its account's list, and only those", () => {
		const client = new QueryClient();
		const own = queryKeys.transactions.byAccount("a", 1);
		const other = queryKeys.transactions.byAccount("b", 1);
		client.setQueryData(own, { items: [] });
		client.setQueryData(other, { items: [] });

		// What deleting account `a` does through `useDeleteAccount`.
		client.removeQueries({ queryKey: queryKeys.transactions.ofAccount("a") });

		expect(client.getQueryState(own)).toBeUndefined();
		expect(client.getQueryState(other)).toBeDefined();
	});
});

describe("queryKeys.accounts.netWorth", () => {
	it("goes stale with any account write", async () => {
		const client = new QueryClient();
		const key = queryKeys.accounts.netWorth("3M");
		client.setQueryData(key, { points: [] });

		await client.invalidateQueries({ queryKey: queryKeys.accounts.all });

		expect(client.getQueryState(key)?.isInvalidated).toBe(true);
	});
});

describe("queryKeys.transactions.cashFlow", () => {
	it("goes stale on every transaction write, which invalidates `transactions.all`", async () => {
		const client = new QueryClient();
		const key = queryKeys.transactions.cashFlow("2026-09");
		client.setQueryData(key, { lines: { income: [], expense: [] } });

		await client.invalidateQueries({ queryKey: queryKeys.transactions.all });

		expect(client.getQueryState(key)?.isInvalidated).toBe(true);
	});
});

describe("queryKeys.transactions.budget", () => {
	it("goes stale on every transaction write, which invalidates `transactions.all`", async () => {
		const client = new QueryClient();
		const key = queryKeys.transactions.budget("2026-09");
		client.setQueryData(key, { setUp: false });

		await client.invalidateQueries({ queryKey: queryKeys.transactions.all });

		expect(client.getQueryState(key)?.isInvalidated).toBe(true);
	});
});

describe("queryKeys.transactions.budgets", () => {
	it("prefixes every month's budget", async () => {
		const client = new QueryClient();
		const key = queryKeys.transactions.budget("2026-09");
		client.setQueryData(key, { setUp: false });

		await client.invalidateQueries({ queryKey: queryKeys.transactions.budgets });

		expect(client.getQueryState(key)?.isInvalidated).toBe(true);
	});
});

describe("queryKeys.recurring.ofEntry", () => {
	it("goes stale with the recurring list", async () => {
		const client = new QueryClient();
		const series = queryKeys.recurring.ofEntry("e1");
		client.setQueryData(series, null);

		// What adding, confirming or detecting does through `useInvalidateRecurring`.
		await client.invalidateQueries({ queryKey: queryKeys.recurring.all });

		expect(client.getQueryState(series)?.isInvalidated).toBe(true);
	});
});

describe("queryKeys.accounts.goals", () => {
	it("goes stale on every write that moves a balance, and on a goal's own write", async () => {
		const client = new QueryClient();
		const list = queryKeys.accounts.goals;
		const one = queryKeys.accounts.goal("g");
		client.setQueryData(list, []);
		client.setQueryData(one, {});

		await client.invalidateQueries({ queryKey: queryKeys.accounts.all });

		expect(client.getQueryState(list)?.isInvalidated).toBe(true);
		expect(client.getQueryState(one)?.isInvalidated).toBe(true);

		client.setQueryData(list, []);
		client.setQueryData(one, {});
		await client.invalidateQueries({ queryKey: queryKeys.accounts.goals });

		expect(client.getQueryState(one)?.isInvalidated).toBe(true);
	});

	it("prefixes a goal's chart and the dashboard's card, so a goal's write refreshes both", async () => {
		const client = new QueryClient();
		const history = queryKeys.accounts.goalHistory("g");
		const summary = queryKeys.accounts.goalsSummary;
		client.setQueryData(history, { points: [] });
		client.setQueryData(summary, { goals: [] });

		await client.invalidateQueries({ queryKey: queryKeys.accounts.goals });

		expect(client.getQueryState(history)?.isInvalidated).toBe(true);
		expect(client.getQueryState(summary)?.isInvalidated).toBe(true);
	});
});
