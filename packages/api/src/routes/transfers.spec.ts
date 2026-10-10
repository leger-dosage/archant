import { describe, expect, it } from "vitest";
import { z } from "zod";

import { TRANSFER_KINDS, TRANSFER_STATUSES } from "@archant/data/transfer-kinds";

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

	it("links a move into a home or a vehicle as an internal move, raising its value", async () => {
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
		expect(detail.body).toMatchObject({ data: { balance: 32000000 + 200000 } });
		const vehicleDetail = await ownRequest("GET", `/api/accounts/${vehicle.id}`);
		expect(vehicleDetail.body).toMatchObject({ data: { balance: 1850000 + 40000 } });
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
