import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	asUser,
	categoryOf,
	deps,
	loanPaymentOf,
	lockedFields,
	newCategory,
	add,
	newTag,
	openChecking,
	openHousehold,
	openLoan,
	splitInTwo,
	tagsOf,
	transferRows,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { setTransferTags, transferDetails, updateTransferDetails } from "./transfer-details.ts";
import { createTransferBetween } from "./transfers.ts";

useLedgerDatabase();

async function feeTransfer() {
	const { checking, livret } = await openHousehold();
	const { transfer } = await createTransferBetween(
		deps(),
		{
			fromAccountId: checking.id,
			toAccountId: livret.id,
			date: "2026-09-15",
			amount: toMinorUnits(10_000),
			sourceFee: toMinorUnits(150),
			destinationFee: toMinorUnits(80),
			tagIds: [],
		},
		asUser,
	);

	return { checking, livret, transfer };
}

/** A loan payment, whose kind takes a category, and its transfer's id. */
async function loanPayment() {
	const checking = await openChecking();
	const loan = await openLoan();
	const { outflow } = await loanPaymentOf(checking.id, loan.id);
	const [transfer] = await transferRows(outflow);

	return { outflow, transferId: transfer?.id ?? "" };
}

const refusal = (path: string, code: string) => ({
	code: "VALIDATION_ERROR",
	fields: [{ path, code }],
});

describe("transferDetails", () => {
	it("reads both sides and the fees on each account, as Sure's drawer", async () => {
		const { checking, livret, transfer } = await feeTransfer();

		await expect(transferDetails(deps(), transfer.id)).resolves.toMatchObject({
			id: transfer.id,
			kind: "internal_move",
			status: "confirmed",
			notes: null,
			categorizable: false,
			categoryId: null,
			tagIds: [],
			outflow: {
				transactionId: transfer.outflowTransactionId,
				accountId: checking.id,
				accountName: "Compte courant",
				accountType: "depository",
				date: "2026-09-15",
				amount: -10_000,
				currency: "EUR",
				fee: 150,
			},
			inflow: {
				transactionId: transfer.inflowTransactionId,
				accountId: livret.id,
				accountName: "Livret A",
				amount: 10_000,
				fee: 80,
			},
		});
	});

	it("reads a transfer without fees as zero on both sides, and takes a category on a loan payment", async () => {
		const { transferId } = await loanPayment();

		await expect(transferDetails(deps(), transferId)).resolves.toMatchObject({
			kind: "loan_payment",
			status: "confirmed",
			categorizable: true,
			outflow: { fee: 0 },
			inflow: { fee: 0, accountType: "loan" },
		});
	});

	it("answers `NOT_FOUND` for an unknown transfer", async () => {
		await expect(transferDetails(deps(), "none")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("updateTransferDetails", () => {
	it("saves the outflow's category on a loan payment, locked, and clears it", async () => {
		const { outflow, transferId } = await loanPayment();
		const category = await newCategory("Prêt");

		await updateTransferDetails(deps(), transferId, { categoryId: category }, asUser);

		await expect(categoryOf(outflow)).resolves.toBe(category);
		await expect(lockedFields(outflow)).resolves.toContain("category");
		await expect(transferDetails(deps(), transferId)).resolves.toMatchObject({
			categorizable: true,
			categoryId: category,
		});

		// The same category again changes nothing.
		await updateTransferDetails(deps(), transferId, { categoryId: category }, asUser);
		await updateTransferDetails(deps(), transferId, { categoryId: null }, asUser);

		await expect(categoryOf(outflow)).resolves.toBeNull();
	});

	it("refuses a category on a kind that takes none, and an unknown category", async () => {
		const { transfer } = await feeTransfer();
		const { transferId } = await loanPayment();
		const category = await newCategory("Épargne");

		await expect(
			updateTransferDetails(deps(), transfer.id, { categoryId: category }, asUser),
		).rejects.toMatchObject(refusal("categoryId", "not_categorizable"));
		await expect(categoryOf(transfer.outflowTransactionId)).resolves.toBeNull();
		await expect(
			updateTransferDetails(deps(), transferId, { categoryId: "none" }, asUser),
		).rejects.toMatchObject(refusal("categoryId", "invalid_value"));
	});

	it("refuses a category on a split line, whose category is its split's (AD-20)", async () => {
		const checking = await openChecking();
		const loan = await openLoan();
		const { food } = await splitInTwo(checking.id);
		const inflow = await add(loan.id, { amount: toMinorUnits(6_000), label: "Échéance" });
		// The matcher proposes the line and the payment as soon as the payment arrives.
		const [transfer] = await transferRows(inflow);

		expect(transfer?.outflowTransactionId).toBe(food);
		const category = await newCategory("Prêt");

		await expect(
			updateTransferDetails(deps(), transfer?.id ?? "", { categoryId: category }, asUser),
		).rejects.toMatchObject({ code: "TRANSACTION_SPLIT" });
		await expect(categoryOf(food)).resolves.toBeNull();
	});

	it("saves the transfer's own notes, apart from each side's", async () => {
		const { transfer } = await feeTransfer();

		await updateTransferDetails(deps(), transfer.id, { notes: "Loyer de mars" }, asUser);

		await expect(transferDetails(deps(), transfer.id)).resolves.toMatchObject({
			notes: "Loyer de mars",
		});

		await updateTransferDetails(deps(), transfer.id, { notes: null }, asUser);

		await expect(transferDetails(deps(), transfer.id)).resolves.toMatchObject({ notes: null });
	});

	it("answers `NOT_FOUND` for an unknown transfer", async () => {
		await expect(
			updateTransferDetails(deps(), "none", { notes: "x" }, asUser),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("setTransferTags", () => {
	it("sets the same tags on both sides and locks them, as Sure's `update_tags`", async () => {
		const { transfer } = await feeTransfer();
		const holidays = await newTag("Vacances");
		const house = await newTag("Maison");
		const both = [holidays, house].toSorted();

		await setTransferTags(deps(), transfer.id, [holidays, house, holidays], asUser);

		const sides = [transfer.outflowTransactionId, transfer.inflowTransactionId];

		await expect(Promise.all(sides.map(tagsOf))).resolves.toEqual([both, both]);
		await expect(Promise.all(sides.map(lockedFields))).resolves.toEqual([
			expect.arrayContaining(["tags"]),
			expect.arrayContaining(["tags"]),
		]);

		// The same set again, and a rule's set, leave both sides as they are.
		await setTransferTags(deps(), transfer.id, [house, holidays], asUser);
		await setTransferTags(deps(), transfer.id, [holidays], { origin: "rule" });

		await expect(Promise.all(sides.map(tagsOf))).resolves.toEqual([both, both]);

		await setTransferTags(deps(), transfer.id, [], asUser);

		await expect(tagsOf(transfer.inflowTransactionId)).resolves.toEqual([]);
	});

	it("locks a side whose tags were already these, as Sure's `lock_attr!` on both", async () => {
		const { transfer } = await feeTransfer();
		const tag = await newTag("Vacances");
		await setTransferTags(deps(), transfer.id, [tag], { origin: "rule" });

		await expect(tagsOf(transfer.inflowTransactionId)).resolves.toEqual([tag]);
		await expect(lockedFields(transfer.inflowTransactionId)).resolves.not.toContain("tags");

		await setTransferTags(deps(), transfer.id, [tag], asUser);

		await expect(lockedFields(transfer.inflowTransactionId)).resolves.toContain("tags");
	});

	it("refuses an unknown tag and writes nothing", async () => {
		const { transfer } = await feeTransfer();
		const tag = await newTag("Vacances");

		await expect(setTransferTags(deps(), transfer.id, [tag, "none"], asUser)).rejects.toMatchObject(
			refusal("tagIds", "invalid_value"),
		);
		await expect(tagsOf(transfer.outflowTransactionId)).resolves.toEqual([]);
	});
});
