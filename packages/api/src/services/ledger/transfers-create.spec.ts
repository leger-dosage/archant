import type { TransferBetween } from "./transfers.ts";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { categories } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { transactions } from "@archant/data/schema/transactions";
import { transferFees } from "@archant/data/schema/transfer-fees";
import { transfers } from "@archant/data/schema/transfers";

import {
	asUser,
	bankDeps,
	deps,
	history,
	lockedFields,
	newTag,
	openChecking,
	openHousehold,
	openLoan,
	openPea,
	tagsOf,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { updateAccount } from "../accounts.ts";
import { deleteTransaction } from "./edits.ts";
import { createTransferBetween, rejectTransfer, unmatchTransfer } from "./transfers.ts";

useLedgerDatabase();

const cents = (value: number): MinorUnits => toMinorUnits(value);

function between(
	fromAccountId: string,
	toAccountId: string,
	overrides: Partial<TransferBetween> = {},
): TransferBetween {
	return {
		fromAccountId,
		toAccountId,
		date: "2026-09-15",
		amount: cents(10_000),
		sourceFee: cents(0),
		destinationFee: cents(0),
		tagIds: [],
		...overrides,
	};
}

async function rowOf(entryId: string) {
	return temp.db
		.select({
			accountId: entries.accountId,
			date: entries.date,
			amount: entries.amount,
			label: transactions.label,
			categoryId: transactions.categoryId,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();
}

async function feesOf(transferId: string) {
	return temp.db
		.select({
			id: entries.id,
			accountId: entries.accountId,
			amount: entries.amount,
			label: transactions.label,
			categoryId: transactions.categoryId,
		})
		.from(transferFees)
		.innerJoin(entries, eq(entries.id, transferFees.transactionId))
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(transferFees.transferId, transferId))
		.orderBy(entries.amount);
}

const refusal = (path: string, code: string) => ({
	code: "VALIDATION_ERROR",
	fields: [{ path, code }],
});

const feesCategories = () =>
	temp.db.select({ id: categories.id }).from(categories).where(eq(categories.name, "Frais"));

describe("createTransferBetween", () => {
	it("creates both sides, confirmed, and moves both balances, as Sure's `Transfer::Creator`", async () => {
		const { checking, livret } = await openHousehold();
		const checkingBefore = (await history(checking.id)).get("2026-09-15");
		const { transfer, created } = await createTransferBetween(
			deps(),
			between(checking.id, livret.id),
			asUser,
		);

		expect(created).toBe(true);
		expect(transfer).toMatchObject({ kind: "internal_move", status: "confirmed" });
		await expect(rowOf(transfer.outflowTransactionId)).resolves.toMatchObject({
			accountId: checking.id,
			date: "2026-09-15",
			amount: -10_000,
			label: "Virement vers Livret A",
		});
		await expect(rowOf(transfer.inflowTransactionId)).resolves.toMatchObject({
			accountId: livret.id,
			amount: 10_000,
			label: "Virement depuis Compte courant",
		});
		await expect(lockedFields(transfer.outflowTransactionId)).resolves.toEqual([
			"date",
			"amount",
			"label",
		]);
		expect((await history(checking.id)).get("2026-09-15")).toBe((checkingBefore ?? 0) - 10_000);
		expect((await history(livret.id)).get("2026-09-15")).toBe(10_000);
		await expect(feesOf(transfer.id)).resolves.toEqual([]);
	});

	it("takes each kind from both accounts and names a liability's sides « Paiement »", async () => {
		const { checking, card } = await openHousehold();
		const loan = await openLoan();
		const pea = await openPea();
		const wallet = await openChecking({ name: "Portefeuille", type: "crypto", subtype: "wallet" });
		const toCard = await createTransferBetween(deps(), between(checking.id, card.id), asUser);
		const toLoan = await createTransferBetween(deps(), between(checking.id, loan.id), asUser);
		const toPea = await createTransferBetween(deps(), between(checking.id, pea.id), asUser);
		const peaToWallet = await createTransferBetween(deps(), between(pea.id, wallet.id), asUser);

		expect(toCard.transfer.kind).toBe("credit_card_payment");
		await expect(rowOf(toCard.transfer.outflowTransactionId)).resolves.toMatchObject({
			label: "Paiement vers Carte",
		});
		await expect(rowOf(toCard.transfer.inflowTransactionId)).resolves.toMatchObject({
			label: "Paiement depuis Compte courant",
		});
		expect(toLoan.transfer.kind).toBe("loan_payment");
		await expect(rowOf(toLoan.transfer.outflowTransactionId)).resolves.toMatchObject({
			label: "Paiement vers Prêt immobilier",
		});
		expect(toPea.transfer.kind).toBe("investment_contribution");
		await expect(rowOf(toPea.transfer.outflowTransactionId)).resolves.toMatchObject({
			label: "Virement vers PEA",
		});
		expect(peaToWallet.transfer.kind).toBe("internal_move");
	});

	it("records each fee as a standard line in « Frais », created once and linked", async () => {
		const { checking, livret } = await openHousehold();
		const first = await createTransferBetween(
			deps(),
			between(checking.id, livret.id, { sourceFee: cents(150), destinationFee: cents(80) }),
			asUser,
		);
		await createTransferBetween(
			deps(),
			between(checking.id, livret.id, { sourceFee: cents(150) }),
			asUser,
		);
		const [fees] = await feesCategories();
		const lines = await feesOf(first.transfer.id);

		await expect(feesCategories()).resolves.toHaveLength(1);
		expect(lines.map(({ id: _id, ...line }) => line)).toEqual([
			{
				accountId: checking.id,
				amount: -150,
				label: "Frais de virement — Virement vers Livret A",
				categoryId: fees?.id,
			},
			{
				accountId: livret.id,
				amount: -80,
				label: "Frais de virement — Virement depuis Compte courant",
				categoryId: fees?.id,
			},
		]);
		await expect(lockedFields(lines[0]?.id ?? "")).resolves.toEqual([]);
		expect((await history(livret.id)).get("2026-09-15")).toBe(10_000 - 80 + 10_000);
	});

	it("tags both sides and locks the tags", async () => {
		const { checking, livret } = await openHousehold();
		const tagIds = [await newTag("Vacances"), await newTag("Épargne")].toSorted();
		const { transfer } = await createTransferBetween(
			deps(),
			between(checking.id, livret.id, { tagIds }),
			asUser,
		);

		await expect(tagsOf(transfer.outflowTransactionId)).resolves.toEqual(tagIds);
		await expect(tagsOf(transfer.inflowTransactionId)).resolves.toEqual(tagIds);
		await expect(lockedFields(transfer.inflowTransactionId)).resolves.toContain("tags");
	});

	it("returns the first transfer for a double submit, and refuses a key sent with other values", async () => {
		const { checking, livret } = await openHousehold();
		const idempotencyKey = crypto.randomUUID();
		const input = between(checking.id, livret.id, { idempotencyKey, sourceFee: cents(150) });
		const before = await temp.db.$count(transfers);
		const first = await createTransferBetween(deps(), input, asUser);
		const again = await createTransferBetween(deps(), input, asUser);

		expect(again).toEqual({ transfer: first.transfer, created: false });
		await expect(temp.db.$count(transfers)).resolves.toBe(before + 1);
		await expect(
			createTransferBetween(deps(), { ...input, amount: cents(9_999) }, asUser),
		).rejects.toMatchObject({ code: "TRANSFER_FORM_STALE" });
		await expect(
			createTransferBetween(deps(), { ...input, destinationFee: cents(1) }, asUser),
		).rejects.toMatchObject({ code: "TRANSFER_FORM_STALE" });
		await expect(temp.db.$count(transfers)).resolves.toBe(before + 1);
	});

	it("refuses the same account, two currencies, an unknown account or tag, writing nothing", async () => {
		const { checking, livret } = await openHousehold();
		const dollars = await openChecking({ name: "Compte USD", currency: "USD" });
		const before = await temp.db.$count(entries);

		await expect(
			createTransferBetween(deps(), between(checking.id, checking.id), asUser),
		).rejects.toMatchObject(refusal("toAccountId", "same_account"));
		await expect(
			createTransferBetween(deps(), between(checking.id, dollars.id), asUser),
		).rejects.toMatchObject(refusal("toAccountId", "exchange_rate_unavailable"));
		await expect(
			createTransferBetween(deps(), between("none", livret.id), asUser),
		).rejects.toMatchObject(refusal("fromAccountId", "invalid_value"));
		await expect(
			createTransferBetween(deps(), between(checking.id, "none"), asUser),
		).rejects.toMatchObject(refusal("toAccountId", "invalid_value"));
		await expect(
			createTransferBetween(deps(), between(checking.id, livret.id, { tagIds: ["none"] }), asUser),
		).rejects.toMatchObject(refusal("tagIds", "invalid_value"));
		await expect(
			createTransferBetween(
				deps(),
				between(checking.id, livret.id, { date: "2062-09-15" }),
				asUser,
			),
		).rejects.toMatchObject(refusal("date", "date_too_late"));
		await updateAccount(bankDeps(), livret.id, { active: false });
		await expect(
			createTransferBetween(deps(), between(checking.id, livret.id), asUser),
		).rejects.toMatchObject(refusal("toAccountId", "invalid_value"));
		await expect(temp.db.$count(entries)).resolves.toBe(before);
	});

	it("deletes the fee lines, never the sides, when the transfer is undone or refused", async () => {
		const { checking, livret } = await openHousehold();
		const fees = { sourceFee: cents(150), destinationFee: cents(80) };
		const checkingBefore = (await history(checking.id)).get("2026-09-15") ?? 0;
		const before = await temp.db.$count(transactions);
		const undone = await createTransferBetween(
			deps(),
			between(checking.id, livret.id, fees),
			asUser,
		);
		const refused = await createTransferBetween(
			deps(),
			between(checking.id, livret.id, fees),
			asUser,
		);
		const undoneFees = await feesOf(undone.transfer.id);

		await unmatchTransfer(deps(), undone.transfer.id, asUser);
		await rejectTransfer(deps(), refused.transfer.id, asUser);

		await expect(rowOf(undoneFees[0]?.id ?? "")).resolves.toBeUndefined();
		await expect(feesOf(refused.transfer.id)).resolves.toEqual([]);
		await expect(rowOf(undone.transfer.outflowTransactionId)).resolves.toBeDefined();
		await expect(rowOf(refused.transfer.inflowTransactionId)).resolves.toBeDefined();
		await expect(temp.db.$count(transactions)).resolves.toBe(before + 4);
		expect((await history(livret.id)).get("2026-09-15")).toBe(20_000);
		expect((await history(checking.id)).get("2026-09-15")).toBe(checkingBefore - 20_000);
	});

	it("leaves the fees standard lines when a side is deleted, as no transfer is left to undo", async () => {
		const { checking, livret } = await openHousehold();
		const { transfer } = await createTransferBetween(
			deps(),
			between(checking.id, livret.id, { sourceFee: cents(150) }),
			asUser,
		);
		const [fee] = await feesOf(transfer.id);

		await deleteTransaction(deps(), transfer.inflowTransactionId, asUser);

		await expect(temp.db.$count(transfers, eq(transfers.id, transfer.id))).resolves.toBe(0);
		await expect(
			temp.db.$count(transferFees, eq(transferFees.transferId, transfer.id)),
		).resolves.toBe(0);
		await expect(rowOf(fee?.id ?? "")).resolves.toMatchObject({ amount: -150 });
	});
});
