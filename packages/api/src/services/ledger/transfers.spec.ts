import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { transfers } from "@archant/data/schema/transfers";

import {
	add,
	addStandard,
	categoryOf,
	confirm,
	deps,
	firstPage,
	history,
	importStatement,
	line,
	lockedFields,
	matchedPair,
	newCategory,
	newTag,
	openChecking,
	openHousehold,
	preview,
	rejectedRows,
	revert,
	statementOf,
	tagsOf,
	temp,
	transferAmount,
	transferRows,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { updateAccount } from "../accounts.ts";
import { deleteAccount } from "./accounts.ts";
import {
	bulkDeleteTransactions,
	bulkUpdateTransactions,
	deleteTransaction,
	updateTransaction,
} from "./edits.ts";
import { findTransaction, listTransactions } from "./queries.ts";
import { matchTransfer, rejectTransfer, transferCandidates, unmatchTransfer } from "./transfers.ts";

useLedgerDatabase();

describe("transferCandidates", () => {
	it("offers only the opposite amount in another account within four days", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const source = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		const dayFour = await addStandard(livret.id, {
			date: "2026-09-14",
			amount: toMinorUnits(amount),
		});
		await add(livret.id, { date: "2026-09-15", amount: toMinorUnits(amount) });
		await add(joint.id, { date: "2026-09-11", amount: toMinorUnits(amount) });
		await add(livret.id, { date: "2026-09-11", amount: toMinorUnits(amount - 1) });

		await expect(transferCandidates(deps(), source)).resolves.toEqual([
			{
				id: dayFour,
				date: "2026-09-14",
				label: "Boulangerie",
				amount,
				currency: "EUR",
				accountId: livret.id,
				accountName: "Livret A",
			},
		]);
	});

	it("lists the closest date first, before or after", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		const source = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		const far = await addStandard(livret.id, { date: "2026-09-13", amount: toMinorUnits(-amount) });
		const near = await add(card.id, { date: "2026-09-09", amount: toMinorUnits(-amount) });

		const candidates = await transferCandidates(deps(), source);

		expect(candidates.map((candidate) => candidate.id)).toEqual([near, far]);
	});

	it("leaves out another currency, zero amounts and a matched counterpart", async () => {
		const { checking: joint, livret } = await openHousehold();
		const dollars = await openChecking({ name: "Dollars", currency: "USD" });
		const amount = transferAmount();
		const source = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		await add(dollars.id, { date: "2026-09-10", amount: toMinorUnits(amount), currency: "USD" });
		const zero = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(0) });
		await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(0) });

		await expect(transferCandidates(deps(), source)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), zero)).resolves.toEqual([]);

		const taken = await addStandard(livret.id, {
			date: "2026-09-10",
			amount: toMinorUnits(amount),
		});
		const other = await add(joint.id, { date: "2026-09-11", amount: toMinorUnits(-amount) });
		await matchTransfer(deps(), other, taken, { origin: "user" });

		await expect(transferCandidates(deps(), source)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), other)).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await expect(transferCandidates(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

const refusedMatch = async (source: string, counterpart: string) =>
	expect(matchTransfer(deps(), source, counterpart, { origin: "user" })).rejects.toMatchObject({
		code: "VALIDATION_ERROR",
		fields: [{ path: "counterpartId", code: "not_a_candidate" }],
	});

describe("matchTransfer", () => {
	it("links a move to savings as an internal move, moving no balance and touching nothing else", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const groceries = await newCategory("Courses");
		const holidays = await newTag("Vacances");
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		const inflow = await addStandard(livret.id, {
			date: "2026-09-13",
			amount: toMinorUnits(amount),
		});
		await updateTransaction(
			deps(),
			outflow,
			{ categoryId: groceries, tagIds: [holidays] },
			{ origin: "user" },
		);
		const before = {
			joint: await history(joint.id),
			livret: await history(livret.id),
			locks: await lockedFields(outflow),
		};

		// Started from the inflow: the negative side is still the outflow.
		const transfer = await matchTransfer(deps(), inflow, outflow, { origin: "user" });

		expect(transfer).toMatchObject({
			outflowTransactionId: outflow,
			inflowTransactionId: inflow,
			kind: "internal_move",
		});
		await expect(transferRows(outflow)).resolves.toEqual([transfer]);
		await expect(history(joint.id)).resolves.toEqual(before.joint);
		await expect(history(livret.id)).resolves.toEqual(before.livret);
		await expect(lockedFields(outflow)).resolves.toEqual(before.locks);
		await expect(categoryOf(outflow)).resolves.toBe(groceries);
		await expect(tagsOf(outflow)).resolves.toEqual([holidays]);
		await expect(findTransaction(deps(), outflow)).resolves.toMatchObject({
			transfer: {
				id: transfer.id,
				kind: "internal_move",
				counterpartAccountId: livret.id,
				counterpartAccountName: "Livret A",
			},
		});
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({
			transfer: {
				id: transfer.id,
				counterpartAccountId: joint.id,
				counterpartAccountName: "Compte courant",
			},
		});
		const page = await listTransactions(deps(), { accountIds: [joint.id, livret.id] }, firstPage);
		expect(page.items.map((item) => item.transfer?.counterpartAccountName)).toEqual([
			"Compte courant",
			"Livret A",
		]);
	});

	it("makes a payment into a credit card a card payment", async () => {
		const { checking: joint, card } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });
		const inflow = await addStandard(card.id, { amount: toMinorUnits(amount) });

		await expect(matchTransfer(deps(), outflow, inflow, { origin: "user" })).resolves.toMatchObject(
			{ outflowTransactionId: outflow, inflowTransactionId: inflow, kind: "credit_card_payment" },
		);
	});

	it("refuses a counterpart already matched, writing nothing", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const first = await add(joint.id, { amount: toMinorUnits(-amount) });
		const second = await add(joint.id, { amount: toMinorUnits(-amount) });
		const inflow = await add(livret.id, { amount: toMinorUnits(amount) });
		await matchTransfer(deps(), first, inflow, { origin: "user" });

		await expect(matchTransfer(deps(), second, inflow, { origin: "user" })).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "counterpartId", code: "not_a_candidate" }],
		});
		await expect(transferRows(second)).resolves.toEqual([]);
		await expect(transferRows(inflow)).resolves.toHaveLength(1);
	});

	it("refuses another currency, two zeros, the same account and an unknown counterpart", async () => {
		const { checking: joint, livret } = await openHousehold();
		const dollars = await openChecking({ name: "Dollars", currency: "USD" });
		const amount = transferAmount();
		const euros = await add(joint.id, { amount: toMinorUnits(-amount) });
		const usd = await add(dollars.id, { amount: toMinorUnits(amount), currency: "USD" });
		const zero = await add(joint.id, { amount: toMinorUnits(0) });
		const otherZero = await add(livret.id, { amount: toMinorUnits(0) });
		const sameAccount = await add(joint.id, { amount: toMinorUnits(amount) });

		await refusedMatch(euros, usd);
		await refusedMatch(zero, otherZero);
		await refusedMatch(euros, sameAccount);
		await refusedMatch(euros, "nope");
		await expect(
			temp.db.select().from(transfers).where(eq(transfers.outflowTransactionId, euros)),
		).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		const { checking: joint } = await openHousehold();
		const id = await add(joint.id, { amount: toMinorUnits(-transferAmount()) });

		await expect(matchTransfer(deps(), "nope", id, { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("unmatchTransfer", () => {
	it("returns both sides to standard transactions", async () => {
		const { outflow, inflow, transfer, checking: joint } = await matchedPair();
		const before = await history(joint.id);

		await unmatchTransfer(deps(), transfer.id, { origin: "user" });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), outflow)).resolves.toMatchObject({ transfer: null });
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({ transfer: null });
		await expect(history(joint.id)).resolves.toEqual(before);
		await expect(transferCandidates(deps(), outflow)).resolves.toMatchObject([{ id: inflow }]);
	});

	it("answers NOT_FOUND for an unknown transfer", async () => {
		await expect(unmatchTransfer(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("a transfer when a side goes", () => {
	it("goes with a deleted side, the other one standard again", async () => {
		const { outflow, inflow } = await matchedPair();

		await deleteTransaction(deps(), outflow, { origin: "user" });

		await expect(transferRows(inflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({ transfer: null });
	});

	it("goes with a bulk delete", async () => {
		const { outflow, inflow } = await matchedPair();

		await bulkDeleteTransactions(deps(), { ids: [inflow] }, { origin: "user" });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), outflow)).resolves.toMatchObject({ transfer: null });
	});

	it("goes with a bulk delete of both sides", async () => {
		const { outflow, inflow } = await matchedPair();

		await expect(
			bulkDeleteTransactions(deps(), { ids: [outflow, inflow] }, { origin: "user" }),
		).resolves.toBe(2);
		await expect(transferRows(outflow)).resolves.toEqual([]);
	});

	it("goes with a reverted import", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const { importId, result } = await importStatement(
			joint.id,
			statementOf(line({ date: "2026-09-10", amount: toMinorUnits(-amount), label: "VIR LIVRET" })),
		);
		const [outflow = ""] = result.created;
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		await expect(transferRows(outflow)).resolves.toHaveLength(1);

		await revert(importId);

		await expect(transferRows(inflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({ transfer: null });
	});

	it("goes with a deleted account, the other account's side staying", async () => {
		const { checking: joint, outflow, inflow } = await matchedPair();

		await deleteAccount(deps(), joint.id, { origin: "user" });

		await expect(findTransaction(deps(), outflow)).resolves.toBeNull();
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({ transfer: null });
	});

	it("goes when a side's amount changes, and stays when only its date or label does", async () => {
		const kept = await matchedPair();
		const dropped = await matchedPair();

		await updateTransaction(
			deps(),
			kept.outflow,
			{ date: "2026-09-12", label: "Épargne" },
			{ origin: "user" },
		);
		await updateTransaction(
			deps(),
			dropped.outflow,
			{ amount: toMinorUnits(-(dropped.amount - 50)) },
			{ origin: "user" },
		);

		// The sheet sends every field, the unchanged amount included.
		await updateTransaction(
			deps(),
			kept.inflow,
			{ amount: toMinorUnits(kept.amount), label: "Épargne reçue" },
			{ origin: "user" },
		);

		await expect(transferRows(kept.outflow)).resolves.toEqual([kept.transfer]);
		await expect(transferRows(dropped.outflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), dropped.inflow)).resolves.toMatchObject({
			transfer: null,
		});
	});
});

const suggested = async (entryId: string) =>
	(await findTransaction(deps(), entryId))?.transferSuggested;

// Story 11.2: neither an excluded row nor a row of a deactivated account is a
// side, as Sure's `Family::AutoTransferMatchable`.

const exclude = (entryId: string) =>
	updateTransaction(deps(), entryId, { excluded: true }, { origin: "user" });

const deactivate = (accountId: string) => updateAccount(deps(), accountId, { active: false });

describe("transfer matching and excluded or inactive sides", () => {
	it("never offers, links or suggests an excluded candidate", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		await exclude(inflow);

		const outflow = await add(joint.id, { date: "2026-09-11", amount: toMinorUnits(-amount) });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), inflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
		await refusedMatch(outflow, inflow);
		await refusedMatch(inflow, outflow);
	});

	it("gives an excluded source no candidate", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		await exclude(outflow);

		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		await expect(transferRows(inflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), inflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
		await refusedMatch(outflow, inflow);
		await refusedMatch(inflow, outflow);
	});

	it("never offers, links or suggests a row of a deactivated account, either side", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		await deactivate(livret.id);
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		const outflow = await add(joint.id, { date: "2026-09-12", amount: toMinorUnits(-amount) });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), inflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
		await refusedMatch(outflow, inflow);
		await refusedMatch(inflow, outflow);
	});

	it("links the real pair beside an excluded twin, which no longer breaks uniqueness", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		const twin = await add(card.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		await exclude(twin);
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });

		const [transfer] = await transferRows(outflow);
		expect(transfer).toMatchObject({ outflowTransactionId: outflow, inflowTransactionId: inflow });

		// Unlinked, the outflow has one candidate left: no suggestion.
		await unmatchTransfer(deps(), transfer?.id ?? "", { origin: "user" });
		await expect(transferCandidates(deps(), outflow)).resolves.toMatchObject([{ id: inflow }]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
	});

	it("links the real pair beside a twin on a deactivated account", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		await deactivate(card.id);
		const twin = await add(card.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });

		const [transfer] = await transferRows(outflow);
		expect(transfer).toMatchObject({ outflowTransactionId: outflow, inflowTransactionId: inflow });
		await expect(transferRows(twin)).resolves.toEqual([]);

		await unmatchTransfer(deps(), transfer?.id ?? "", { origin: "user" });
		await expect(transferCandidates(deps(), outflow)).resolves.toMatchObject([{ id: inflow }]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
	});

	it("keeps an existing transfer when a side is excluded or its account deactivated", async () => {
		const { outflow, inflow, livret, transfer } = await matchedPair();

		await exclude(outflow);
		await deactivate(livret.id);

		await expect(transferRows(outflow)).resolves.toEqual([transfer]);
		await expect(transferRows(inflow)).resolves.toEqual([transfer]);
	});
});

describe("automatic transfer matching", () => {
	it("links a unique pair on creation as an internal move, moving nothing else", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const groceries = await newCategory("Courses");
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		await updateTransaction(deps(), outflow, { categoryId: groceries }, { origin: "user" });
		const before = { joint: await history(joint.id), locks: await lockedFields(outflow) };

		const inflow = await add(livret.id, { date: "2026-09-14", amount: toMinorUnits(amount) });

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: inflow, kind: "internal_move" },
		]);
		await expect(history(joint.id)).resolves.toEqual(before.joint);
		await expect(lockedFields(outflow)).resolves.toEqual(before.locks);
		await expect(categoryOf(outflow)).resolves.toBe(groceries);
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({
			transfer: { counterpartAccountName: "Compte courant" },
			transferSuggested: false,
		});
	});

	it("leaves a row five days away alone, without a suggestion", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });

		const inflow = await add(livret.id, { date: "2026-09-15", amount: toMinorUnits(amount) });

		await expect(transferRows(inflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(inflow)).resolves.toBe(false);
	});

	it("links a payment into a card as a card payment", async () => {
		const { checking: joint, card } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });

		await add(card.id, { amount: toMinorUnits(amount) });

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, kind: "credit_card_payment" },
		]);
	});

	it("links an imported inflow once the import is confirmed, never in the preview", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { date: "2026-09-10", amount: toMinorUnits(-amount) });
		const statement = statementOf(
			line({ date: "2026-09-12", amount: toMinorUnits(amount), label: "VIR COMPTE" }),
		);

		const previewed = await preview(livret.id, statement);

		await expect(transferRows(outflow)).resolves.toEqual([]);

		const confirmed = await confirm(livret.id, previewed.importId, statement);

		expect(confirmed.groups).toEqual(previewed.result.groups);
		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ inflowTransactionId: confirmed.created[0] },
		]);
	});

	it("links nothing when a row has two candidates, and suggests a match on it", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		await importStatement(livret.id, statementOf(line({ amount: toMinorUnits(amount) })));
		await importStatement(card.id, statementOf(line({ amount: toMinorUnits(amount) })));

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(suggested(outflow)).resolves.toBe(true);
		await expect(transferCandidates(deps(), outflow)).resolves.toHaveLength(2);
		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id, livret.id, card.id] },
			firstPage,
		);
		expect(page.items.filter((item) => item.transferSuggested).map((item) => item.id)).toEqual([
			outflow,
		]);
	});

	it("links nothing when the candidate has another candidate, which it suggests", async () => {
		const { checking: joint, livret } = await openHousehold();
		const other = await openChecking({ name: "Compte joint" });
		const amount = transferAmount();
		const savings = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		// Linked on creation, then unlinked with « Dissocier »: one candidate each.
		const shared = await addStandard(other.id, {
			date: "2026-09-06",
			amount: toMinorUnits(-amount),
		});
		await expect(suggested(savings)).resolves.toBe(false);

		const outflow = await add(joint.id, { date: "2026-09-14", amount: toMinorUnits(-amount) });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferRows(savings)).resolves.toEqual([]);
		await expect(suggested(savings)).resolves.toBe(true);
		await expect(suggested(outflow)).resolves.toBe(false);
		await expect(suggested(shared)).resolves.toBe(false);
	});

	it("leaves an outflow that two inflows of one file compete for unlinked", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });

		await importStatement(
			livret.id,
			statementOf(
				line({ amount: toMinorUnits(amount), label: "A" }),
				line({ amount: toMinorUnits(amount), label: "B" }),
			),
		);

		await expect(transferRows(outflow)).resolves.toEqual([]);
	});

	it("never links two opposite rows of one file on one account", async () => {
		const { checking: joint } = await openHousehold();
		const amount = transferAmount();

		const { result } = await importStatement(
			joint.id,
			statementOf(
				line({ amount: toMinorUnits(-amount), label: "Sortie" }),
				line({ amount: toMinorUnits(amount), label: "Entrée" }),
			),
		);

		expect(result.created).toHaveLength(2);
		await expect(transferRows(result.created[0] ?? "")).resolves.toEqual([]);
	});

	it("never links on an edit or a bulk edit", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount) });
		const inflow = await add(livret.id, { amount: toMinorUnits(amount + 1) });

		await updateTransaction(deps(), inflow, { amount: toMinorUnits(amount) }, { origin: "user" });
		await bulkUpdateTransactions(
			deps(),
			{ ids: [outflow, inflow] },
			{ excluded: true },
			{
				origin: "user",
			},
		);

		await expect(transferRows(outflow)).resolves.toEqual([]);
	});
});

describe("rejectTransfer", () => {
	it("undoes the transfer and records the pair", async () => {
		const { outflow, inflow, transfer, checking: joint } = await matchedPair();
		const before = await history(joint.id);

		await rejectTransfer(deps(), transfer.id, { origin: "user" });

		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(rejectedRows(outflow)).resolves.toEqual([{ outflow, inflow }]);
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({
			transfer: null,
			transferSuggested: false,
		});
		await expect(history(joint.id)).resolves.toEqual(before);
	});

	it("never offers nor accepts the rejected pair, and still links others", async () => {
		const { outflow, inflow, transfer, card, amount } = await matchedPair();
		await rejectTransfer(deps(), transfer.id, { origin: "user" });
		const refused = {
			code: "VALIDATION_ERROR",
			fields: [{ path: "counterpartId", code: "not_a_candidate" }],
		};

		await expect(transferCandidates(deps(), outflow)).resolves.toEqual([]);
		await expect(transferCandidates(deps(), inflow)).resolves.toEqual([]);
		await expect(matchTransfer(deps(), outflow, inflow, { origin: "user" })).rejects.toMatchObject(
			refused,
		);
		await expect(matchTransfer(deps(), inflow, outflow, { origin: "user" })).rejects.toMatchObject(
			refused,
		);

		// Were the rejected pair counted, the outflow would have two candidates
		// and stay unlinked.
		const repaid = await add(card.id, { date: "2026-09-10", amount: toMinorUnits(amount) });

		await expect(transferRows(repaid)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: repaid },
		]);
		await expect(transferRows(inflow)).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an unknown transfer", async () => {
		await expect(rejectTransfer(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

async function rejectedPair() {
	const pair = await matchedPair();
	await rejectTransfer(deps(), pair.transfer.id, { origin: "user" });

	return pair;
}

describe("a rejected pair when a side goes", () => {
	it("goes with a deleted side", async () => {
		const { outflow, inflow } = await rejectedPair();

		await deleteTransaction(deps(), inflow, { origin: "user" });

		await expect(rejectedRows(outflow)).resolves.toEqual([]);
	});

	it("goes with a bulk delete", async () => {
		const { outflow, inflow } = await rejectedPair();

		await bulkDeleteTransactions(deps(), { ids: [outflow] }, { origin: "user" });

		await expect(rejectedRows(inflow)).resolves.toEqual([]);
		await expect(findTransaction(deps(), outflow)).resolves.toBeNull();
	});

	it("goes with a reverted import", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const { importId, result } = await importStatement(
			joint.id,
			statementOf(line({ date: "2026-09-10", amount: toMinorUnits(-amount), label: "VIR" })),
		);
		const [outflow = ""] = result.created;
		const inflow = await add(livret.id, { date: "2026-09-10", amount: toMinorUnits(amount) });
		const [transfer] = await transferRows(inflow);
		await rejectTransfer(deps(), transfer?.id ?? "", { origin: "user" });

		await revert(importId);

		await expect(findTransaction(deps(), outflow)).resolves.toBeNull();
		await expect(rejectedRows(inflow)).resolves.toEqual([]);
	});

	it("goes with a deleted account", async () => {
		const { checking: joint, outflow, inflow } = await rejectedPair();

		await deleteAccount(deps(), joint.id, { origin: "user" });

		await expect(findTransaction(deps(), outflow)).resolves.toBeNull();
		await expect(rejectedRows(inflow)).resolves.toEqual([]);
	});
});
