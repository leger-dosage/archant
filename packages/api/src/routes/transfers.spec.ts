import { describe, expect, it } from "vitest";
import { z } from "zod";

import { TRANSFER_KINDS, TRANSFER_STATUSES } from "@archant/data/transfer-kinds";

import { MAX_TAGS_PER_TRANSACTION } from "../schemas/transactions.ts";
import {
	car,
	errorBody,
	home,
	listed,
	mortgage,
	openOwn,
	ownCard,
	ownRequest,
	pea,
	postOwn,
	request,
	useSignedInApp,
} from "../testing/app.ts";

useSignedInApp();

/**
 * −500 on the checking account, +500 on the Livret A three days later, which
 * the matcher proposes on creation, and +500 six days later, too far for a
 * proposal but within a pair by hand's 30 days.
 */
async function household() {
	const checking = await openOwn({ name: "Compte courant" });
	const livret = await openOwn({ name: "Livret A", subtype: "savings", openingBalance: "0" });
	const card = await openOwn({
		name: "Carte",
		type: "credit_card",
		subtype: null,
		openingBalance: "0",
	});
	const outflow = await postOwn(checking.id, {
		date: "2026-09-10",
		label: "VIR LIVRET A",
		amount: "-500,00",
	});
	const inflow = await postOwn(livret.id, {
		date: "2026-09-13",
		label: "VIR COMPTE COURANT",
		amount: "500,00",
	});
	const later = await postOwn(livret.id, {
		date: "2026-09-16",
		label: "Plus tard",
		amount: "500,00",
	});
	const [automatic] = (await listed("?direction=transfer")).items;

	return {
		checking,
		livret,
		card,
		outflow,
		inflow,
		later,
		transferId: automatic?.transfer?.id ?? "",
	};
}

const notFound = async (method: string, path: string, body?: unknown) => {
	const response = await ownRequest(method, path, body);

	expect(response.status).toBe(404);
	expect(errorBody.parse(response.body).error.code).toBe("NOT_FOUND");
};

/** `household()` with its automatic link undone, for the tests that match by hand. */
async function unlinkedHousehold() {
	const found = await household();
	const { status } = await ownRequest("DELETE", `/api/transfers/${found.transferId}`);

	expect(status).toBe(200);

	return found;
}

describe("transfers", () => {
	const candidateList = z.object({
		data: z.array(
			z.object({
				id: z.string(),
				date: z.string(),
				label: z.string(),
				amount: z.number(),
				currency: z.string(),
				accountId: z.string(),
				accountName: z.string(),
			}),
		),
	});

	const created = z.object({
		data: z.object({
			id: z.string(),
			outflowTransactionId: z.string(),
			inflowTransactionId: z.string(),
			kind: z.enum(TRANSFER_KINDS),
			status: z.enum(TRANSFER_STATUSES),
		}),
	});

	it("links a move to savings on creation", async () => {
		const { checking, outflow, inflow, transferId } = await household();

		const data = await listed("?direction=transfer");

		expect(data.items.map((item) => item.id).toSorted()).toEqual([outflow, inflow].toSorted());
		expect(data.items.find((item) => item.id === outflow)).toMatchObject({
			transfer: {
				id: transferId,
				kind: "internal_move",
				status: "pending",
				counterpartAccountName: "Livret A",
			},
		});
		expect(data.items.find((item) => item.id === inflow)).toMatchObject({
			transfer: { id: transferId, counterpartAccountId: checking.id },
		});
		expect(data.sum).toMatchObject({ amount: 0, income: 0, expense: 0 });
		await expect(listed("")).resolves.toMatchObject({
			sum: { amount: 50000, income: 50000, expense: 0 },
		});
	});

	it("lists the candidates within 30 days, closest first, then confirms the one picked", async () => {
		const { livret, outflow, inflow, later } = await unlinkedHousehold();

		const listedCandidates = await ownRequest(
			"GET",
			`/api/transactions/${outflow}/transfer-candidates`,
		);

		expect(listedCandidates.status).toBe(200);
		expect(candidateList.parse(listedCandidates.body).data).toEqual([
			{
				id: inflow,
				date: "2026-09-13",
				label: "VIR COMPTE COURANT",
				amount: 50000,
				currency: "EUR",
				accountId: livret.id,
				accountName: "Livret A",
			},
			{
				id: later,
				date: "2026-09-16",
				label: "Plus tard",
				amount: 50000,
				currency: "EUR",
				accountId: livret.id,
				accountName: "Livret A",
			},
		]);

		const matched = await ownRequest("POST", "/api/transfers", {
			transactionId: outflow,
			counterpartId: inflow,
		});

		expect(matched.status).toBe(201);
		expect(created.parse(matched.body).data).toMatchObject({
			outflowTransactionId: outflow,
			inflowTransactionId: inflow,
			kind: "internal_move",
			status: "confirmed",
		});
		const data = await listed("?direction=transfer");
		expect(data.items.map((item) => item.id).toSorted()).toEqual([outflow, inflow].toSorted());
		expect(data.items.find((item) => item.id === outflow)).toMatchObject({
			transfer: { kind: "internal_move", counterpartAccountName: "Livret A" },
		});
	});

	it("links a payment into a card on creation, as a card payment", async () => {
		const { checking, card } = await household();
		const payment = await postOwn(checking.id, {
			date: "2026-09-12",
			label: "PRLV CARTE",
			amount: "-300,00",
		});
		const repaid = await postOwn(card.id, {
			date: "2026-09-12",
			label: "REMBOURSEMENT",
			amount: "300,00",
		});

		const data = await listed("?direction=transfer");

		expect(data.items.find((item) => item.id === repaid)).toMatchObject({
			transfer: { kind: "credit_card_payment", counterpartAccountName: "Compte courant" },
		});
		expect(data.items.find((item) => item.id === payment)).toMatchObject({
			transfer: { kind: "credit_card_payment", counterpartAccountName: "Carte" },
		});
	});

	it("links a repayment into a loan as a loan payment, by hand too, lowering what it owes", async () => {
		const checking = await openOwn({ name: "Compte courant" });
		const loan = await openOwn(mortgage);
		const payment = await postOwn(checking.id, {
			date: "2026-09-12",
			label: "ECHEANCE PRET",
			amount: "-1 200,00",
		});
		const repaid = await postOwn(loan.id, {
			date: "2026-09-12",
			label: "ECHEANCE",
			amount: "1 200,00",
		});
		const [automatic] = (await listed("?direction=transfer")).items;

		expect(automatic?.transfer?.kind).toBe("loan_payment");
		await ownRequest("DELETE", `/api/transfers/${automatic?.transfer?.id ?? ""}`);
		const matched = await ownRequest("POST", "/api/transfers", {
			transactionId: payment,
			counterpartId: repaid,
		});

		expect(created.parse(matched.body).data).toMatchObject({
			outflowTransactionId: payment,
			inflowTransactionId: repaid,
			kind: "loan_payment",
		});
		const detail = await ownRequest("GET", `/api/accounts/${loan.id}`);
		expect(detail.body).toMatchObject({ data: { balance: 18000000 - 120000 } });
		// Both sides are transfers for « Sens », as Sure's type filter; the
		// outflow still counts as an expense in the cash flow.
		expect((await listed("?direction=expense")).items).toEqual([]);
		expect((await listed("?direction=transfer")).items.map((item) => item.id).toSorted()).toEqual(
			[payment, repaid].toSorted(),
		);
	});

	it("links a card paying off a loan as a loan payment", async () => {
		const card = await openOwn(ownCard);
		const loan = await openOwn(mortgage);
		const payment = await postOwn(card.id, {
			date: "2026-09-12",
			label: "ECHEANCE PRET",
			amount: "-1 200,00",
		});
		await postOwn(loan.id, { date: "2026-09-13", label: "ECHEANCE", amount: "1 200,00" });

		const data = await listed("?direction=transfer");

		expect(data.items.map((item) => item.transfer?.kind)).toEqual(["loan_payment", "loan_payment"]);
		expect(data.items.map((item) => item.id)).toContain(payment);
		expect((await listed("?direction=expense")).items).toEqual([]);
	});

	it("links a move into a PEA as a contribution, by hand too, raising its value", async () => {
		const checking = await openOwn({ name: "Compte courant" });
		const account = await openOwn(pea);
		const contribution = await postOwn(checking.id, {
			date: "2026-09-12",
			label: "VERSEMENT PEA",
			amount: "-500,00",
		});
		const received = await postOwn(account.id, {
			date: "2026-09-13",
			label: "VERSEMENT",
			amount: "500,00",
		});
		const [automatic] = (await listed("?direction=transfer")).items;

		expect(automatic?.transfer?.kind).toBe("investment_contribution");
		await ownRequest("DELETE", `/api/transfers/${automatic?.transfer?.id ?? ""}`);
		const matched = await ownRequest("POST", "/api/transfers", {
			transactionId: received,
			counterpartId: contribution,
		});

		expect(created.parse(matched.body).data).toMatchObject({
			outflowTransactionId: contribution,
			inflowTransactionId: received,
			kind: "investment_contribution",
		});
		const detail = await ownRequest("GET", `/api/accounts/${account.id}`);
		expect(detail.body).toMatchObject({ data: { balance: 2500000 + 50000 } });
		expect((await listed("?direction=expense")).items).toEqual([]);
		expect((await listed("?direction=transfer")).items.map((item) => item.id).toSorted()).toEqual(
			[contribution, received].toSorted(),
		);
	});

	it("links a card paying into a PEA as a contribution", async () => {
		const card = await openOwn(ownCard);
		const account = await openOwn(pea);
		await postOwn(card.id, { date: "2026-09-12", label: "VERSEMENT PEA", amount: "-500,00" });
		await postOwn(account.id, { date: "2026-09-12", label: "VERSEMENT", amount: "500,00" });

		const data = await listed("?direction=transfer");

		expect(data.items.map((item) => item.transfer?.kind)).toEqual([
			"investment_contribution",
			"investment_contribution",
		]);
	});

	it("links a move between two investments, and out of one, as internal moves", async () => {
		const checking = await openOwn({ name: "Compte courant" });
		const account = await openOwn(pea);
		const lifeInsurance = await openOwn({
			...pea,
			name: "Assurance-vie",
			subtype: "assurance_vie",
			openingBalance: "0",
		});
		await postOwn(account.id, { date: "2026-09-12", label: "ARBITRAGE", amount: "-700,00" });
		await postOwn(lifeInsurance.id, { date: "2026-09-12", label: "ARBITRAGE", amount: "700,00" });
		await postOwn(account.id, { date: "2026-09-15", label: "RETRAIT", amount: "-300,00" });
		await postOwn(checking.id, { date: "2026-09-15", label: "RETRAIT PEA", amount: "300,00" });

		const data = await listed("?direction=transfer");

		expect(data.items.map((item) => item.transfer?.kind)).toEqual([
			"internal_move",
			"internal_move",
			"internal_move",
			"internal_move",
		]);
		expect((await listed("?direction=expense")).items).toEqual([]);
		expect((await listed("?direction=income")).items).toEqual([]);
	});

	it("links a move into a home or a vehicle as an internal move, its value left to valuations", async () => {
		const checking = await openOwn({ name: "Compte courant" });
		const account = await openOwn(home);
		const vehicle = await openOwn(car);
		await postOwn(checking.id, { date: "2026-09-12", label: "TRAVAUX", amount: "-2 000,00" });
		await postOwn(account.id, { date: "2026-09-12", label: "TRAVAUX", amount: "2 000,00" });
		await postOwn(checking.id, { date: "2026-09-15", label: "PNEUS", amount: "-400,00" });
		await postOwn(vehicle.id, { date: "2026-09-15", label: "PNEUS", amount: "400,00" });

		const data = await listed("?direction=transfer");

		expect(data.items.map((item) => item.transfer?.kind)).toEqual([
			"internal_move",
			"internal_move",
			"internal_move",
			"internal_move",
		]);
		expect((await listed("?direction=expense")).items).toEqual([]);
		expect((await listed("?direction=income")).items).toEqual([]);
		const detail = await ownRequest("GET", `/api/accounts/${account.id}`);
		// Non-cash, as Sure's: only a valuation moves a home's or a car's value.
		expect(detail.body).toMatchObject({ data: { balance: 32000000 } });
		const vehicleDetail = await ownRequest("GET", `/api/accounts/${vehicle.id}`);
		expect(vehicleDetail.body).toMatchObject({ data: { balance: 1850000 } });
	});

	it("refuses a counterpart that is not a candidate, already matched or 31 days away included", async () => {
		const { checking, livret, inflow, later } = await household();
		// Five days before the other +500, so the matcher proposes nothing.
		const second = await postOwn(checking.id, {
			date: "2026-09-11",
			label: "VIR LIVRET A",
			amount: "-500,00",
		});

		const refused = async (counterpartId: string) => {
			const { status, body } = await ownRequest("POST", "/api/transfers", {
				transactionId: second,
				counterpartId,
			});

			expect(status).toBe(400);
			expect(errorBody.parse(body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "counterpartId", code: "not_a_candidate" }],
			});
		};

		const farAway = await postOwn(livret.id, {
			date: "2026-10-12",
			label: "Bien plus tard",
			amount: "500,00",
		});

		await refused(inflow);
		await refused(farAway);
		await refused("nope");
		const { body } = await ownRequest("GET", `/api/transactions/${second}/transfer-candidates`);
		expect(candidateList.parse(body).data.map((candidate) => candidate.id)).toEqual([later]);
	});

	it("unmatches a transfer, both sides becoming standard again", async () => {
		const { outflow, inflow, transferId: id } = await household();

		await expect(ownRequest("DELETE", `/api/transfers/${id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id, outflowTransactionId: outflow, inflowTransactionId: inflow } },
		});
		const data = await listed("?direction=transfer");
		expect(data.items).toEqual([]);
		expect((await listed("?direction=expense&direction=income")).total).toBe(3);
	});

	it("answers NOT_FOUND for an unknown transaction or transfer", async () => {
		const { inflow } = await household();

		await notFound("GET", "/api/transactions/nope/transfer-candidates");
		await notFound("POST", "/api/transfers", { transactionId: "nope", counterpartId: inflow });
		await notFound("DELETE", "/api/transfers/nope");
		await notFound("POST", "/api/transfers/nope/reject");
		await notFound("POST", "/api/transfers/nope/confirm");
	});

	it("rejects a proposal, which the matcher never makes again, though the owner may pair it by hand", async () => {
		const { checking, outflow, inflow, transferId } = await household();

		await expect(ownRequest("POST", `/api/transfers/${transferId}/reject`)).resolves.toEqual({
			status: 200,
			body: {
				data: { id: transferId, outflowTransactionId: outflow, inflowTransactionId: inflow },
			},
		});
		expect((await listed("?direction=transfer")).items).toEqual([]);
		// Any later line runs the matcher again.
		await postOwn(checking.id, { date: "2026-09-14", label: "Café", amount: "-3,20" });
		expect((await listed("?direction=transfer")).items).toEqual([]);

		const { body } = await ownRequest("GET", `/api/transactions/${outflow}/transfer-candidates`);
		expect(candidateList.parse(body).data.map((candidate) => candidate.id)).toContain(inflow);
		const paired = await ownRequest("POST", "/api/transfers", {
			transactionId: inflow,
			counterpartId: outflow,
		});
		expect(paired.status).toBe(201);
		expect(created.parse(paired.body).data).toMatchObject({ status: "confirmed" });
	});

	it("confirms a proposal, once or twice, still counted as a transfer", async () => {
		const { outflow, inflow, transferId } = await household();

		const confirm = async () => ownRequest("POST", `/api/transfers/${transferId}/confirm`);
		const answer = {
			status: 200,
			body: {
				data: { id: transferId, outflowTransactionId: outflow, inflowTransactionId: inflow },
			},
		};

		await expect(confirm()).resolves.toEqual(answer);
		await expect(confirm()).resolves.toEqual(answer);
		const data = await listed("?direction=transfer");
		expect(data.items.map((item) => item.transfer?.status)).toEqual(["confirmed", "confirmed"]);
		expect(data.sum).toMatchObject({ amount: 0, income: 0, expense: 0 });
	});

	it("marks a transfer as recurring, as Sure's `create_from_transfer`, and only once per pair and amount", async () => {
		const checking = await openOwn({ name: "Compte courant" });
		const loan = await openOwn(mortgage);
		await postOwn(checking.id, { date: "2026-09-05", label: "ECHEANCE PRET", amount: "-800,00" });
		await postOwn(loan.id, { date: "2026-09-05", label: "ECHEANCE", amount: "800,00" });
		const [automatic] = (await listed("?direction=transfer")).items;
		const path = `/api/transfers/${automatic?.transfer?.id ?? ""}/recurring`;

		const marked = await ownRequest("POST", path);

		expect(marked.status).toBe(201);
		expect(marked.body).toMatchObject({
			data: {
				name: "Remboursement vers Prêt immobilier",
				accountId: checking.id,
				destinationAccountId: loan.id,
				destinationAccountName: "Prêt immobilier",
				merchantId: null,
				amount: -80000,
				currency: "EUR",
				expectedDayOfMonth: 5,
				lastOccurrenceDate: "2026-09-05",
				occurrenceCount: 1,
				status: "active",
				manual: true,
				billType: "transfer",
				rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 5 }],
			},
		});

		const again = await ownRequest("POST", path);

		expect(again.status).toBe(409);
		expect(errorBody.parse(again.body).error.code).toBe("RECURRING_TRANSFER_ALREADY_EXISTS");
		await notFound("POST", "/api/transfers/nope/recurring");
	});

	it("refuses « Marquer comme récurrent » while recurring transactions are off, as Sure's `transfer_feature_disabled`", async () => {
		const { transferId } = await household();
		await ownRequest("PUT", "/api/recurring/settings", { enabled: false });

		try {
			const refused = await ownRequest("POST", `/api/transfers/${transferId}/recurring`);

			expect(refused.status).toBe(403);
			expect(errorBody.parse(refused.body).error.code).toBe("RECURRING_DISABLED");
		} finally {
			await ownRequest("PUT", "/api/recurring/settings", { enabled: true });
		}
	});

	it("names a recurring transfer into an asset « Virement vers »", async () => {
		const { transferId } = await household();

		const marked = await ownRequest("POST", `/api/transfers/${transferId}/recurring`);

		expect(marked.body).toMatchObject({ data: { name: "Virement vers Livret A", amount: -50000 } });
	});

	it("creates a transfer from « Virement », and the first one again for a form sent twice", async () => {
		const checking = await openOwn({ name: "Courant" });
		const livret = await openOwn({ name: "Épargne", subtype: "savings", openingBalance: "0" });
		const body = {
			fromAccountId: checking.id,
			toAccountId: livret.id,
			date: "2026-09-15",
			amount: "100,10",
			sourceFee: "1,50",
			destinationFee: "",
			tagIds: [],
			idempotencyKey: crypto.randomUUID(),
		};
		const first = await ownRequest("POST", "/api/transfers/new", body);
		const again = await ownRequest("POST", "/api/transfers/new", body);
		const stale = await ownRequest("POST", "/api/transfers/new", { ...body, amount: "100" });

		expect(first.status).toBe(201);
		expect(first.body).toMatchObject({ data: { kind: "internal_move", status: "confirmed" } });
		expect(again.status).toBe(200);
		expect(again.body).toEqual(first.body);
		expect(stale.status).toBe(409);
		expect(errorBody.parse(stale.body).error.code).toBe("TRANSFER_FORM_STALE");
		expect((await listed(`?account=${livret.id}`)).items).toMatchObject([
			{ label: "Virement depuis Courant", amount: 10010 },
		]);
		expect(
			(await listed(`?account=${checking.id}`)).items.map(({ label, amount }) => ({
				label,
				amount,
			})),
		).toEqual(
			expect.arrayContaining([
				{ label: "Virement vers Épargne", amount: -10010 },
				{ label: "Frais de virement — Virement vers Épargne", amount: -150 },
			]),
		);
	});

	it("refuses an amount not above zero, a fee below zero and an unknown source account", async () => {
		const checking = await openOwn({ name: "Courant" });
		const livret = await openOwn({ name: "Épargne", subtype: "savings", openingBalance: "0" });
		const send = (overrides: Record<string, unknown>) =>
			ownRequest("POST", "/api/transfers/new", {
				fromAccountId: checking.id,
				toAccountId: livret.id,
				date: "2026-09-15",
				amount: "10",
				...overrides,
			});
		const fieldsOf = async (overrides: Record<string, unknown>) => {
			const { status, body } = await send(overrides);

			expect(status).toBe(400);

			return errorBody.parse(body).error.fields;
		};

		await expect(fieldsOf({ amount: "0" })).resolves.toEqual([
			{ path: "amount", code: "not_positive" },
		]);
		await expect(fieldsOf({ amount: "-5" })).resolves.toEqual([
			{ path: "amount", code: "not_positive" },
		]);
		await expect(fieldsOf({ amount: "abc", destinationFee: "-1" })).resolves.toEqual([
			{ path: "amount", code: "invalid_amount" },
			{ path: "destinationFee", code: "negative_amount" },
		]);
		await expect(fieldsOf({ fromAccountId: "none" })).resolves.toEqual([
			{ path: "fromAccountId", code: "invalid_value" },
		]);
		await expect(fieldsOf({ idempotencyKey: "twice" })).resolves.toEqual([
			{ path: "idempotencyKey", code: "invalid_format" },
		]);
	});

	it("refuses a body without both ids", async () => {
		const { status, body } = await request("POST", "/api/transfers", { transactionId: "t1" });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "counterpartId", code: "invalid_type" },
		]);
	});

	it("filters by direction, and deletes the rows of a direction in bulk", async () => {
		const { checking, later } = await household();
		const spent = await postOwn(checking.id, { date: "2026-09-14", label: "Café", amount: "-20" });
		const earned = await postOwn(checking.id, { date: "2026-09-14", label: "Prime", amount: "30" });

		expect((await listed("?direction=expense")).items.map((item) => item.id)).toEqual([spent]);
		// The +500 left alone on the Livret is income until someone matches it.
		expect((await listed("?direction=income")).items.map((item) => item.id).toSorted()).toEqual(
			[earned, later].toSorted(),
		);
		const refused = await ownRequest("GET", "/api/transactions?direction=refund");
		expect(refused.status).toBe(400);

		await expect(
			ownRequest("POST", "/api/transactions/bulk-delete", {
				filter: { direction: "expense" },
			}),
		).resolves.toEqual({ status: 200, body: { data: { deleted: 1 } } });
	});
});

/** A transfer of 100 € from « Courant » to « Épargne », with both fees. */
async function feeTransfer() {
	const checking = await openOwn({ name: "Courant" });
	const livret = await openOwn({ name: "Épargne", subtype: "savings", openingBalance: "0" });
	const { body } = await ownRequest("POST", "/api/transfers/new", {
		fromAccountId: checking.id,
		toAccountId: livret.id,
		date: "2026-09-15",
		amount: "100,00",
		sourceFee: "1,50",
		destinationFee: "0,80",
	});
	const transfer = z
		.object({ data: z.object({ id: z.string(), outflowTransactionId: z.string() }) })
		.parse(body).data;

	return { checking, livret, transfer };
}

describe("the transfer's drawer, Sure's `transfers#show`, `update` and `update_tags`", () => {
	it("reads both sides with their fees, and answers `404` for an unknown transfer", async () => {
		const { checking, livret, transfer } = await feeTransfer();

		await expect(ownRequest("GET", `/api/transfers/${transfer.id}`)).resolves.toMatchObject({
			status: 200,
			body: {
				data: {
					categorizable: false,
					outflow: { accountId: checking.id, amount: -10_000, fee: 150 },
					inflow: { accountId: livret.id, amount: 10_000, fee: 80 },
				},
			},
		});
		expect((await ownRequest("GET", "/api/transfers/none")).status).toBe(404);
	});

	it("saves the notes, a blank one as none, and refuses notes too long or a category on a move", async () => {
		const { transfer } = await feeTransfer();
		const path = `/api/transfers/${transfer.id}`;

		await expect(ownRequest("PATCH", path, { notes: "  Loyer  " })).resolves.toMatchObject({
			status: 200,
			body: { data: { notes: "Loyer" } },
		});
		await expect(ownRequest("PATCH", path, { notes: " " })).resolves.toMatchObject({
			body: { data: { notes: null } },
		});

		const tooLong = await ownRequest("PATCH", path, { notes: "x".repeat(2001) });
		const category = await ownRequest("PATCH", path, { categoryId: "any" });

		expect(tooLong.status).toBe(400);
		expect(errorBody.parse(tooLong.body).error.fields).toEqual([
			{ path: "notes", code: "too_big" },
		]);
		expect(category.status).toBe(400);
		expect(errorBody.parse(category.body).error.fields).toEqual([
			{ path: "categoryId", code: "not_categorizable" },
		]);
	});

	it("sets the same tags on both sides", async () => {
		const { checking, livret, transfer } = await feeTransfer();
		const tag = z
			.object({ data: z.object({ id: z.string() }) })
			.parse((await ownRequest("POST", "/api/tags", { name: "Vacances" })).body).data;

		await expect(
			ownRequest("PUT", `/api/transfers/${transfer.id}/tags`, { tagIds: [tag.id] }),
		).resolves.toMatchObject({ status: 200, body: { data: { tagIds: [tag.id] } } });

		const sides = await Promise.all(
			[checking, livret].map(async (account) => (await listed(`?account=${account.id}`)).items),
		);

		expect(sides.map((items) => items.find((item) => item.transfer !== null)?.tagIds)).toEqual([
			[tag.id],
			[tag.id],
		]);
		const unknown = await ownRequest("PUT", `/api/transfers/${transfer.id}/tags`, {
			tagIds: ["none"],
		});

		expect(unknown.status).toBe(400);
		expect(errorBody.parse(unknown.body).error.fields).toEqual([
			{ path: "tagIds", code: "invalid_value" },
		]);
	});

	it("caps the tags after dropping repeats, and answers `404` for an unknown transfer", async () => {
		const { transfer } = await feeTransfer();
		const path = `/api/transfers/${transfer.id}/tags`;
		const ids = Array.from({ length: MAX_TAGS_PER_TRANSACTION + 1 }, (_, index) => `t${index}`);
		const tooMany = await ownRequest("PUT", path, { tagIds: ids });
		const repeated = await ownRequest("PUT", path, {
			tagIds: Array.from({ length: MAX_TAGS_PER_TRANSACTION + 1 }, () => "none"),
		});

		expect(errorBody.parse(tooMany.body).error.fields).toEqual([
			{ path: "tagIds", code: "too_big" },
		]);
		// One tag once repeats are dropped: within the cap, refused only as unknown.
		expect(errorBody.parse(repeated.body).error.fields).toEqual([
			{ path: "tagIds", code: "invalid_value" },
		]);
		expect((await ownRequest("PUT", "/api/transfers/none/tags", { tagIds: [] })).status).toBe(404);
		expect((await ownRequest("PATCH", "/api/transfers/none", { notes: "x" })).status).toBe(404);
	});

	it("deletes the transfer and its fee lines, never its two sides, as Sure's `destroy!`", async () => {
		const { checking, livret, transfer } = await feeTransfer();
		const balances = async () =>
			Promise.all(
				[checking, livret].map(
					async (account) =>
						z
							.object({ data: z.object({ balance: z.number() }) })
							.parse((await ownRequest("GET", `/api/accounts/${account.id}`)).body).data.balance,
				),
			);
		const [checkingBefore = 0, livretBefore = 0] = await balances();

		expect((await ownRequest("DELETE", `/api/transfers/${transfer.id}`)).status).toBe(200);
		// Each account gets its fee back, the sides' amounts staying.
		await expect(balances()).resolves.toEqual([checkingBefore + 150, livretBefore + 80]);
		expect(
			(await listed(`?account=${checking.id}`)).items.map(({ label, transfer: link }) => ({
				label,
				link,
			})),
		).toEqual([{ label: "Virement vers Épargne", link: null }]);
		expect((await listed(`?account=${livret.id}`)).items).toHaveLength(1);
		expect((await ownRequest("DELETE", `/api/transfers/${transfer.id}`)).status).toBe(404);
	});
});
