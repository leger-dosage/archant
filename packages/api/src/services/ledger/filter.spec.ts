import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { direction } from "../../domain/cash-flow.ts";
import {
	add,
	addStandard,
	categoryOf,
	categoryOriginOf,
	contributionOf,
	deps,
	firstPage,
	loanPaymentOf,
	lockedFields,
	matchedPair,
	newCategory,
	openHousehold,
	openLoan,
	openPea,
	pairOf,
	transferAmount,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { bulkUpdateTransactions } from "./edits.ts";
import { findTransaction, listTransactions, sumTransactions } from "./queries.ts";

useLedgerDatabase();

const sortedIds = (page: { items: { id: string }[] }) =>
	page.items.map((item) => item.id).toSorted();

describe("the direction filter", () => {
	it("partitions every case as `direction` does, a loan payment's and a contribution's outflow under « Transfert » where they were expenses", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const mortgage = await openLoan();
		const pea = await openPea();
		const accountIds = [joint.id, livret.id, card.id, mortgage.id, pea.id];
		// Amounts of their own: step 6 would link them to another test's rows.
		const earned = transferAmount();
		const expense = await add(joint.id, {
			amount: toMinorUnits(-transferAmount()),
			label: "expense",
		});
		const income = await add(joint.id, { amount: toMinorUnits(earned), label: "income" });
		const zero = await add(joint.id, { amount: toMinorUnits(0), label: "zero" });
		const move = await pairOf("internal_move", joint.id, livret.id);
		const cardPayment = await pairOf("credit_card_payment", joint.id, card.id);
		const loan = await loanPaymentOf(joint.id, mortgage.id);
		const investment = await contributionOf(joint.id, pea.id);
		const expected = {
			income: [income],
			expense: [expense, zero],
			transfer: [
				loan.outflow,
				investment.outflow,
				move.outflow,
				move.inflow,
				cardPayment.outflow,
				cardPayment.inflow,
				loan.inflow,
				investment.inflow,
			],
		};

		const all = await listTransactions(deps(), { accountIds }, firstPage);
		const [incomes, expenses, moves] = await Promise.all(
			(["income", "expense", "transfer"] as const).map(async (value) =>
				listTransactions(deps(), { accountIds, direction: [value] }, firstPage),
			),
		);

		const byRule = (value: string) =>
			all.items
				.filter((item) => direction(item) === value)
				.map((item) => item.id)
				.toSorted();
		expect(byRule("income")).toEqual(expected.income.toSorted());
		expect(byRule("expense")).toEqual(expected.expense.toSorted());
		expect(byRule("transfer")).toEqual(expected.transfer.toSorted());
		expect(incomes && sortedIds(incomes)).toEqual(byRule("income"));
		expect(expenses && sortedIds(expenses)).toEqual(byRule("expense"));
		expect(moves && sortedIds(moves)).toEqual(byRule("transfer"));
		await expect(
			listTransactions(deps(), { accountIds, direction: ["income", "expense"] }, firstPage),
		).resolves.toMatchObject({ total: 3 });
		await expect(
			listTransactions(deps(), { accountIds, direction: [] }, firstPage),
		).resolves.toEqual({ items: [], total: 0 });
		await expect(sumTransactions(deps(), { accountIds, direction: ["income"] })).resolves.toEqual([
			{ currency: "EUR", amount: earned, income: earned, expense: 0, count: 1 },
		]);
	});

	it("counts a transfer's two sides in the signed sum, and in neither the income nor the expense sum", async () => {
		const { checking: joint, livret } = await openHousehold();
		await pairOf("internal_move", joint.id, livret.id);
		const spent = transferAmount();
		await addStandard(joint.id, { amount: toMinorUnits(-spent), label: "expense" });

		await expect(sumTransactions(deps(), { accountIds: [joint.id, livret.id] })).resolves.toEqual([
			{ currency: "EUR", amount: -spent, income: 0, expense: -spent, count: 3 },
		]);
	});
});

describe("transfer sides and categories", () => {
	it("leaves a transfer side out of « Sans catégorie »", async () => {
		const { checking: joint, livret, outflow, inflow } = await matchedPair();
		const standard = await add(joint.id, { amount: toMinorUnits(-transferAmount()) });

		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id, livret.id], uncategorised: true },
			firstPage,
		);

		expect(page.items.map((item) => item.id)).toEqual([standard]);
		expect(page.items.map((item) => item.id)).not.toContain(outflow);
		expect(page.items.map((item) => item.id)).not.toContain(inflow);
	});

	it("lists the outflow of a loan payment under « Sans catégorie », as the dashboard counts it, and under « Transfert » for the « Sens » filter", async () => {
		const { checking: joint } = await openHousehold();
		const mortgage = await openLoan();
		const { outflow, inflow } = await loanPaymentOf(joint.id, mortgage.id);

		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id, mortgage.id], uncategorised: true, direction: ["transfer"] },
			firstPage,
		);
		const all = await listTransactions(
			deps(),
			{ accountIds: [joint.id, mortgage.id], uncategorised: true },
			firstPage,
		);

		expect(page.items.map((item) => item.id)).toEqual([outflow]);
		expect(all.items.map((item) => item.id)).not.toContain(inflow);
	});

	it("sets no bulk category on an internal move, other fields on every row", async () => {
		const { checking: joint, livret, outflow, inflow } = await matchedPair();
		const standard = await add(joint.id, { amount: toMinorUnits(-transferAmount()) });
		const groceries = await newCategory("Courses");
		const outflowLocks = await lockedFields(outflow);

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ filter: { accountIds: [joint.id, livret.id] } },
				{ categoryId: groceries, excluded: true },
				{ origin: "user" },
			),
		).resolves.toEqual({ matched: 3, changed: 3 });

		await expect(categoryOf(standard)).resolves.toBe(groceries);
		await expect(categoryOf(outflow)).resolves.toBeNull();
		await expect(categoryOf(inflow)).resolves.toBeNull();
		await expect(categoryOriginOf(outflow)).resolves.toBeNull();
		await expect(lockedFields(outflow)).resolves.toEqual([...(outflowLocks ?? []), "excluded"]);
		await expect(findTransaction(deps(), outflow)).resolves.toMatchObject({ excluded: true });
	});

	it("selects for a bulk edit as many rows as the totals count, transfer sides included", async () => {
		const { checking: joint, livret } = await matchedPair();
		const mortgage = await openLoan();
		await loanPaymentOf(joint.id, mortgage.id);
		await add(joint.id, { amount: toMinorUnits(-transferAmount()) });
		const accountIds = [joint.id, livret.id, mortgage.id];
		const filters = [
			{ accountIds, uncategorised: true },
			{ accountIds, direction: ["transfer" as const] },
		];

		const results = await filters.reduce<Promise<{ counted: number; matched: number }[]>>(
			async (previous, filter) => {
				const done = await previous;
				const counted = (await sumTransactions(deps(), filter)).reduce(
					(total, row) => total + row.count,
					0,
				);
				const { matched } = await bulkUpdateTransactions(
					deps(),
					{ filter },
					{ excluded: true },
					{ origin: "user", expectedCount: counted },
				);

				return [...done, { counted, matched }];
			},
			Promise.resolve([]),
		);

		// Every transfer side, the loan payment's two included.
		expect(results.map(({ counted }) => counted)).toEqual([2, 4]);
		expect(results.map(({ matched }) => matched)).toEqual(results.map(({ counted }) => counted));
	});

	it("sets a bulk category on the spent outflow of a loan payment, as the dashboard counts it", async () => {
		const { checking: joint, livret } = await openHousehold();
		const mortgage = await openLoan();
		const loan = await loanPaymentOf(joint.id, mortgage.id);
		const move = await pairOf("internal_move", joint.id, livret.id);
		const housing = await newCategory("Logement");

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ ids: [loan.outflow, loan.inflow, move.outflow, move.inflow] },
				{ categoryId: housing },
				{ origin: "user" },
			),
		).resolves.toEqual({ matched: 4, changed: 1 });

		await expect(categoryOf(loan.outflow)).resolves.toBe(housing);
		await expect(categoryOf(loan.inflow)).resolves.toBeNull();
		await expect(categoryOf(move.outflow)).resolves.toBeNull();
		await expect(categoryOf(move.inflow)).resolves.toBeNull();
	});
});
