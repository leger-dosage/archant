import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";

import { createLogger } from "../lib/logger.ts";
import { oneByOne } from "../services/ledger/shared.ts";
import {
	listed,
	openOwn,
	ownCategory,
	ownDatabase,
	postOwn,
	sendOwn,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { READ_WRITE, callTool, connect, mcp, registerClient } from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// Story 26.1. Each test has a household of its own, through `ownDatabase`:
// the candidate search reads every account of the database.

let db: TempDatabase["db"];

/**
 * −500 on the checking account, +500 on the Livret A three days later, which
 * the matcher proposes on creation, and +500 six days later, too far for a
 * proposal but within a pair by hand's 30 days.
 */
async function household() {
	db = (await ownDatabase()).db;
	const checking = await openOwn({ name: "Compte courant" });
	const livret = await openOwn({ name: "Livret A", subtype: "savings", openingBalance: "0" });
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
	const [linked] = await transfersNow();

	if (linked === undefined) {
		throw new Error("The two sides were expected to match on creation.");
	}

	return { checking, livret, outflow, inflow, later, transferId: linked.id };
}

/** A read-only and a read-write assistant of the household, its calls recorded from here. */
async function assistants() {
	const auth = createTestAuth(db);
	const app = buildTestApp(db, createLogger("silent"), auth);
	const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
	const reader = (await connect(session, app, await registerClient(app))).access_token;
	const author = (await connect(session, app, await registerClient(app), READ_WRITE)).access_token;
	await db.delete(assistantCalls);

	return {
		read: (name: string, args: unknown = {}) => callTool(app, reader, name, args),
		write: (name: string, args: unknown = {}) => callTool(app, author, name, args),
		refused: (name: string, args: unknown = {}) =>
			mcp(app, reader, "tools/call", { name, arguments: args }),
	};
}

function calls() {
	return db
		.select({
			tool: assistantCalls.tool,
			outcome: assistantCalls.outcome,
			changedRows: assistantCalls.changedRows,
		})
		.from(assistantCalls);
}

const transferOf = z.object({
	transfer: z.object({ id: z.string(), counterpart_transaction_id: z.string() }).loose().nullable(),
});

/** A get_transactions page: Sure's item says only whether a line is a transfer side. */
const page = z.object({
	transactions: z.array(z.object({ id: z.string(), is_transfer: z.boolean() }).loose()),
});

const candidates = z.object({
	candidates: z.array(
		z.object({
			id: z.string(),
			date: z.string(),
			name: z.string(),
			amount: z.string(),
			currency: z.string(),
			account: z.object({ id: z.string(), name: z.string() }),
		}),
	),
});

const paired = z.object({
	id: z.string(),
	kind: z.string(),
	outflow_transaction_id: z.string(),
	inflow_transaction_id: z.string(),
});

const unpaired = z.object({
	transfer_id: z.string(),
	outflow_transaction_id: z.string(),
	inflow_transaction_id: z.string(),
	never_propose: z.boolean(),
});

/** The transfers of the household, as the transaction list shows them, one per pair. */
async function transfersNow() {
	const { items } = await listed("?direction=transfer");
	const ids = new Set(items.flatMap((item) => (item.transfer === null ? [] : [item.transfer.id])));

	return [...ids].map((id) => ({ id }));
}

/** What an unpair must leave as it was: each side's category and tags, as the list shows them. */
async function sidesOf(ids: string[]) {
	const { items } = await listed("");

	return items
		.filter((item) => ids.includes(item.id))
		.map((item) => ({ id: item.id, categoryId: item.categoryId, tagIds: item.tagIds }))
		.toSorted((a, b) => a.id.localeCompare(b.id));
}

describe("the read tools", () => {
	it("say a side is a transfer in the list, and give its transfer, status and other side in full", async () => {
		const { outflow, inflow, transferId } = await household();
		const tools = await assistants();

		const found = page.parse(
			(await tools.read("get_transactions", { types: ["transfer"] })).structuredContent,
		);
		const detail = transferOf.parse(
			(await tools.read("get_transaction", { id: inflow })).structuredContent,
		);

		expect(found.transactions.find((item) => item.id === outflow)).toEqual(
			expect.objectContaining({ is_transfer: true }),
		);
		expect(found.transactions.find((item) => item.id === outflow)).not.toHaveProperty("transfer");
		expect(detail).toMatchObject({
			transfer: {
				id: transferId,
				kind: "internal_move",
				status: "pending",
				counterpart_transaction_id: outflow,
				counterpart_account: { name: "Compte courant" },
			},
		});
		// Story 27.1 removed the suggestion flag; status replaces it.
		expect(detail).not.toHaveProperty("transfer_suggested");
	});

	it("show the closest candidate the matcher proposed, the other line left alone", async () => {
		db = (await ownDatabase()).db;
		const checking = await openOwn({ name: "Compte courant" });
		const livret = await openOwn({ name: "Livret A", subtype: "savings", openingBalance: "0" });
		const ldds = await openOwn({ name: "LDDS", subtype: "savings", openingBalance: "0" });
		const inflow = await postOwn(livret.id, { date: "2026-09-11", label: "VIR", amount: "500,00" });
		const other = await postOwn(ldds.id, { date: "2026-09-12", label: "VIR", amount: "500,00" });
		const source = await postOwn(checking.id, {
			date: "2026-09-10",
			label: "VIR EPARGNE",
			amount: "-500,00",
		});
		const tools = await assistants();

		const found = page.parse((await tools.read("get_transactions")).structuredContent);
		const detail = transferOf.parse(
			(await tools.read("get_transaction", { id: source })).structuredContent,
		);

		expect(detail).toMatchObject({ transfer: { counterpart_transaction_id: inflow } });
		expect(found.transactions.find((item) => item.id === inflow)).toMatchObject({
			is_transfer: true,
		});
		expect(found.transactions.find((item) => item.id === other)).toMatchObject({
			is_transfer: false,
		});
	});
});

describe("get_transfer_candidates", () => {
	it("lists what « Rapprocher un virement » lists, within 30 days, amounts as decimal strings", async () => {
		const { livret, outflow, inflow, later, transferId } = await household();
		const tools = await assistants();
		await tools.write("unpair_transfer", { transfer_id: transferId });

		const result = await tools.read("get_transfer_candidates", { transaction_id: outflow });

		expect(candidates.parse(result.structuredContent).candidates).toEqual([
			{
				id: inflow,
				date: "2026-09-13",
				name: "VIR COMPTE COURANT",
				amount: "500.00",
				currency: "EUR",
				account: { id: livret.id, name: "Livret A" },
			},
			{
				id: later,
				date: "2026-09-16",
				name: "Plus tard",
				amount: "500.00",
				currency: "EUR",
				account: { id: livret.id, name: "Livret A" },
			},
		]);
	});

	it("gives none for a side already in a transfer, and NOT_FOUND for an unknown id", async () => {
		const { outflow } = await household();
		const tools = await assistants();

		const linked = await tools.read("get_transfer_candidates", { transaction_id: outflow });
		const unknown = await tools.read("get_transfer_candidates", { transaction_id: "nothing" });

		expect(candidates.parse(linked.structuredContent).candidates).toEqual([]);
		expect(unknown.isError).toBe(true);
		expect(unknown.content[0]?.text).toContain('"error":"not_found"');
		expect(await calls()).toEqual([
			{ tool: "get_transfer_candidates", outcome: "OK", changedRows: 0 },
			{ tool: "get_transfer_candidates", outcome: "NOT_FOUND", changedRows: 0 },
		]);
	});
});

describe("pair_transfer", () => {
	it("pairs a line and its candidate as « Rapprocher un virement », recorded with one row", async () => {
		const { outflow, inflow, transferId } = await household();
		const tools = await assistants();
		await tools.write("unpair_transfer", { transfer_id: transferId });
		await db.delete(assistantCalls);

		const result = await tools.write("pair_transfer", {
			transaction_id: inflow,
			counterpart_id: outflow,
		});
		const created = paired.parse(result.structuredContent);

		expect(created).toMatchObject({
			kind: "internal_move",
			outflow_transaction_id: outflow,
			inflow_transaction_id: inflow,
		});
		// No status in the assistant's answer before Story 27.13.
		expect(result.structuredContent).not.toHaveProperty("status");
		expect(await transfersNow()).toEqual([{ id: created.id }]);
		expect(await calls()).toEqual([{ tool: "pair_transfer", outcome: "OK", changedRows: 1 }]);
		// A pair by hand is confirmed, as Sure's.
		expect((await tools.read("get_transaction", { id: inflow })).structuredContent).toMatchObject({
			transfer: { id: created.id, status: "confirmed" },
		});
		const found = page.parse((await tools.read("get_transactions")).structuredContent);
		expect(found.transactions.find((item) => item.id === inflow)).toMatchObject({
			is_transfer: true,
		});
	});

	it("refuses a counterpart that is no candidate, writing nothing", async () => {
		const { outflow, livret, transferId } = await household();
		const tooFarAway = await postOwn(livret.id, {
			date: "2026-10-11",
			label: "Bien plus tard",
			amount: "500,00",
		});
		const tools = await assistants();
		await tools.write("unpair_transfer", { transfer_id: transferId });
		await db.delete(assistantCalls);

		const tooFar = await tools.write("pair_transfer", {
			transaction_id: outflow,
			counterpart_id: tooFarAway,
		});
		const unknown = await tools.write("pair_transfer", {
			transaction_id: "nothing",
			counterpart_id: tooFarAway,
		});

		expect(tooFar.isError).toBe(true);
		expect(tooFar.content[0]?.text).toContain("counterpart_id not_a_candidate");
		expect(unknown.content[0]?.text).toContain('"error":"not_found"');
		expect(await transfersNow()).toEqual([]);
		expect(await calls()).toEqual([
			{ tool: "pair_transfer", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "pair_transfer", outcome: "NOT_FOUND", changedRows: 0 },
		]);
	});
});

describe("unpair_transfer", () => {
	it("undoes a transfer as « Dissocier », both sides as they were, the pair a candidate again", async () => {
		const { outflow, inflow, later, transferId } = await household();
		const categoryId = await ownCategory("Épargne");
		const tag = z
			.object({ data: z.object({ id: z.string() }) })
			.parse(await sendOwn("POST", "/api/tags", { name: "Projet" })).data.id;
		await sendOwn("PATCH", `/api/transactions/${outflow}`, { categoryId, tagIds: [tag] });
		const before = await sidesOf([outflow, inflow]);
		const tools = await assistants();

		const result = await tools.write("unpair_transfer", { transfer_id: transferId });

		expect(unpaired.parse(result.structuredContent)).toEqual({
			transfer_id: transferId,
			outflow_transaction_id: outflow,
			inflow_transaction_id: inflow,
			never_propose: false,
		});
		expect(await transfersNow()).toEqual([]);
		expect(await sidesOf([outflow, inflow])).toEqual(before);
		expect(before.find((side) => side.id === outflow)).toEqual({
			id: outflow,
			categoryId,
			tagIds: [tag],
		});
		const again = await tools.read("get_transfer_candidates", { transaction_id: outflow });
		expect(candidates.parse(again.structuredContent).candidates.map((row) => row.id)).toEqual([
			inflow,
			later,
		]);
		expect(await calls()).toEqual([
			{ tool: "unpair_transfer", outcome: "OK", changedRows: 1 },
			{ tool: "get_transfer_candidates", outcome: "OK", changedRows: 0 },
		]);
	});

	it("with never_propose keeps the matcher from proposing the pair again, as « Ne plus proposer »", async () => {
		const { checking, outflow, inflow, transferId } = await household();
		const tools = await assistants();

		const result = await tools.write("unpair_transfer", {
			transfer_id: transferId,
			never_propose: true,
		});
		// Any later line runs the matcher again.
		await postOwn(checking.id, { date: "2026-09-14", label: "Café", amount: "-3,20" });
		expect(await transfersNow()).toEqual([]);
		const offered = await tools.read("get_transfer_candidates", { transaction_id: outflow });
		const repaired = await tools.write("pair_transfer", {
			transaction_id: outflow,
			counterpart_id: inflow,
		});

		expect(unpaired.parse(result.structuredContent)).toMatchObject({ never_propose: true });
		// By hand, as Sure's picker, a refused pair is still offered.
		expect(candidates.parse(offered.structuredContent).candidates.map((row) => row.id)).toContain(
			inflow,
		);
		expect(paired.parse(repaired.structuredContent)).toMatchObject({
			outflow_transaction_id: outflow,
			inflow_transaction_id: inflow,
		});
		expect(await calls()).toEqual([
			{ tool: "unpair_transfer", outcome: "OK", changedRows: 1 },
			{ tool: "get_transfer_candidates", outcome: "OK", changedRows: 0 },
			{ tool: "pair_transfer", outcome: "OK", changedRows: 1 },
		]);
	});

	it("answers NOT_FOUND for an unknown transfer, either way", async () => {
		await household();
		const tools = await assistants();

		const plain = await tools.write("unpair_transfer", { transfer_id: "nothing" });
		const refused = await tools.write("unpair_transfer", {
			transfer_id: "nothing",
			never_propose: true,
		});

		expect(plain.content[0]?.text).toContain('"error":"not_found"');
		expect(refused.content[0]?.text).toContain('"error":"not_found"');
		expect(await transfersNow()).toHaveLength(1);
		expect(await calls()).toEqual([
			{ tool: "unpair_transfer", outcome: "NOT_FOUND", changedRows: 0 },
			{ tool: "unpair_transfer", outcome: "NOT_FOUND", changedRows: 0 },
		]);
	});
});

describe("a read token", () => {
	it("is refused every transfer write with 403 insufficient_scope, recorded, nothing written", async () => {
		const { outflow, later, transferId } = await household();
		const tools = await assistants();

		const writes = [
			["pair_transfer", { transaction_id: outflow, counterpart_id: later }],
			["unpair_transfer", { transfer_id: transferId, never_propose: true }],
		] as const;

		await oneByOne(writes, async ([name, args]) => {
			const response = await tools.refused(name, args);

			expect(response.status).toBe(403);
			expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
		});

		expect(await transfersNow()).toEqual([{ id: transferId }]);
		expect(await calls()).toEqual([
			{ tool: "pair_transfer", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
			{ tool: "unpair_transfer", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
		]);
	});
});
