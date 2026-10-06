import type { TempDatabase } from "../testing/temp-database.ts";

import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { purgeStalePreviews } from "../services/imports.ts";
import * as recurringService from "../services/recurring/pipeline.ts";
import {
	balanceOf,
	balanceOnDay,
	buildApp,
	clearLogLines,
	confirmedImport,
	creditAgricole,
	errorBody,
	freshDatabase,
	importBody,
	logLines,
	openAccount,
	ownRecurringAccount,
	postTransaction,
	recurringRows,
	request,
	temp,
	template,
	transactionsOf,
	upload,
	uploaded,
	useSignedInApp,
	valid,
} from "../testing/app.ts";
import { buildTestApp, withSession } from "../testing/auth.ts";

useSignedInApp();

/** Three monthly Netflix lines at -13,99 €, the last on 5 September. */
function netflixOfx(): Uint8Array {
	const lines = ["20260705", "20260805", "20260905"].map(
		(date, index) =>
			`<STMTTRN><DTPOSTED>${date}<TRNAMT>-13.99<FITID>N${index}<NAME>NETFLIX.COM</STMTTRN>`,
	);

	return new TextEncoder().encode(
		`<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<BANKTRANLIST>\n${lines.join("\n")}\n</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`,
	);
}

async function confirmOwnImport(app: ReturnType<typeof buildApp>, accountId: string) {
	const form = new FormData();
	form.append("file", new File([netflixOfx()], "releve.ofx"));
	const uploadResponse = await app.request(`/api/accounts/${accountId}/imports`, {
		method: "POST",
		body: form,
	});
	const { data } = importBody.parse(await uploadResponse.json());
	const response = await app.request(`/api/imports/${data.id}/confirm`, { method: "POST" });

	return { id: data.id, status: response.status };
}

async function transactionsOfDb(db: TempDatabase["db"], accountId: string) {
	const [row] = await db.all<{ count: number }>(
		sql`select count(*) as count from entries where account_id = ${accountId} and kind = 'transaction'`,
	);

	return row?.count;
}

describe("POST /api/imports/:id/confirm", () => {
	it("writes the lines, moves the balance, and shows them as imported", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());

		const response = await testClient(buildApp()).api.imports[":id"].confirm.$post({
			param: { id: preview.id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: {
				id: preview.id,
				counts: { created: 5, present: 0, matched: 0, duplicates: 0, rejected: 0 },
			},
		});
		const list = await transactionsOf(account.id);
		expect(list.total).toBe(5);
		expect(list.items[0]?.source).toEqual({ kind: "import", format: "ofx", date: "2026-09-21" });
		const all = await testClient(buildApp()).api.transactions.$get({
			query: { account: account.id },
		});
		const { data: everyAccount } = await all.json();
		expect(everyAccount.items.map((item) => item.source)).toEqual(
			Array.from({ length: 5 }, () => ({ kind: "import", format: "ofx", date: "2026-09-21" })),
		);
		// The file's LEDGERBAL of 1 234,56 on 15 September, not the lines' sum,
		// sets today's balance.
		await expect(balanceOnDay(account.id, "2026-09-10")).resolves.toBe(
			123456 - 4290 - 8712 + 215000 - 350 - 350,
		);
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it("records the card fixture's negative balance as a positive amount owed", async () => {
		const card = await openAccount({ type: "credit_card", subtype: null, openingBalance: "0" });
		const bytes = new Uint8Array(
			await readFile(
				new URL("../connectors/ofx/fixtures/societe-generale-card-102-sgml.ofx", import.meta.url),
			),
		);
		const preview = await uploaded(card.id, bytes);
		expect(preview.statementBalance).toEqual({
			status: "recorded",
			date: "2026-09-15",
			balance: 51230,
		});

		await request("POST", `/api/imports/${preview.id}/confirm`);

		await expect(balanceOf(card.id)).resolves.toBe(51230);
	});

	it("keeps a snapshot the user entered on the statement date, and gives the gap", async () => {
		const account = await openAccount();
		await request("POST", `/api/accounts/${account.id}/snapshots`, {
			date: "2026-09-15",
			balance: "1 200,00",
		});

		const preview = await uploaded(account.id, await creditAgricole());

		expect(preview.statementBalance).toEqual({
			status: "kept",
			date: "2026-09-15",
			balance: 123456,
			recorded: 120000,
			gap: 3456,
		});
		await request("POST", `/api/imports/${preview.id}/confirm`);
		await expect(balanceOf(account.id)).resolves.toBe(120000);
	});

	it("keeps statement lines and amounts out of the logs", async () => {
		const account = await openAccount();
		const app = buildApp();
		const form = new FormData();
		form.append("file", new File([await creditAgricole()], "releve.ofx"));
		const { data } = importBody.parse(
			await (
				await app.request(`/api/accounts/${account.id}/imports`, { method: "POST", body: form })
			).json(),
		);
		await app.request(`/api/imports/${data.id}/confirm`, { method: "POST" });

		const logs = logLines.join("\n");
		expect(logs).toContain(data.id);
		expect(logs).not.toMatch(/CAF|BOULANGERIE|4290|releve/u);
	});

	it("recognises the same file on re-import", async () => {
		const account = await openAccount();
		const first = await uploaded(account.id, await creditAgricole());
		await request("POST", `/api/imports/${first.id}/confirm`);

		const again = await uploaded(account.id, await creditAgricole());

		expect(again.groups.created).toEqual([]);
		expect(again.groups.present).toHaveLength(5);
	});

	it("answers NOT_FOUND for an import already confirmed or unknown", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());
		await request("POST", `/api/imports/${preview.id}/confirm`);

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 404,
			body: { error: { code: "NOT_FOUND" } },
		});
		await expect(request("POST", "/api/imports/nope/confirm")).resolves.toMatchObject({
			status: 404,
		});
	});

	it("answers IMPORT_PREVIEW_STALE when a transaction arrived since the preview, then previews anew", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());
		const manual = await postTransaction(account.id, {
			date: "2026-09-04",
			label: "Café",
			amount: "-42,90",
		});

		const stale = await request("POST", `/api/imports/${preview.id}/confirm`);

		expect(stale).toEqual({
			status: 409,
			body: {
				error: { code: "IMPORT_PREVIEW_STALE", message: "The account changed since the preview." },
			},
		});
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 1 });

		const fresh = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: null,
		});
		const { data } = importBody.parse(fresh.body);
		expect(data.groups.matched).toEqual([expect.objectContaining({ ref: "0" })]);
		expect(z.object({ data: z.object({ id: z.string() }) }).parse(manual.body).data.id).toBe(
			data.groups.matched[0]?.entryId,
		);
		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 200,
		});
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 5 });
	});

	it("detects recurring transactions once the lines are written", async () => {
		const { app, db, account } = await ownRecurringAccount();

		const { status } = await confirmOwnImport(app, account.id);

		expect(status).toBe(200);
		await expect(recurringRows(db)).resolves.toEqual([
			{
				accountId: account.id,
				merchantId: null,
				labelKey: "netflix.com",
				amount: -1399,
				currency: "EUR",
				day: 5,
				last: "2026-09-05",
				next: "2026-10-05",
				count: 3,
			},
		]);
	});

	it("answers 200 when detection throws, and logs the import id and code only", async () => {
		const run = vi
			.spyOn(recurringService, "runRecurring")
			.mockRejectedValue(new Error("SQLITE_ERROR: params [-1399, 'NETFLIX.COM']"));
		const { app, db, account } = await ownRecurringAccount();

		const { id, status } = await confirmOwnImport(app, account.id);

		expect(status).toBe(200);
		await expect(transactionsOfDb(db, account.id)).resolves.toBe(3);
		const failures = logLines
			.map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
			.filter((line) => line["level"] === 50);
		expect(failures).toEqual([
			expect.objectContaining({
				importId: id,
				code: "INTERNAL_ERROR",
				msg: "recurring detection failed",
			}),
		]);
		expect(logLines.join("\n")).not.toMatch(/1399|13\.99|NETFLIX/u);
		expect(run).toHaveBeenCalledWith(expect.anything(), { backfill: false });
	});
});

describe("POST /api/imports/:id/revert and recurring detection", () => {
	it("deletes the detected series whose every line it removed", async () => {
		const { app, db, account } = await ownRecurringAccount();
		const { id } = await confirmOwnImport(app, account.id);
		await expect(recurringRows(db)).resolves.toHaveLength(1);

		const response = await app.request(`/api/imports/${id}/revert`, { method: "POST" });

		expect(response.status).toBe(200);
		await expect(recurringRows(db)).resolves.toEqual([]);
	});

	it("answers 200 when detection throws, and logs the import id and code only", async () => {
		const { app, db, account } = await ownRecurringAccount();
		const { id } = await confirmOwnImport(app, account.id);
		clearLogLines();
		const run = vi
			.spyOn(recurringService, "runRecurring")
			.mockRejectedValue(new Error("SQLITE_ERROR: params [-1399, 'NETFLIX.COM']"));

		const response = await app.request(`/api/imports/${id}/revert`, { method: "POST" });

		expect(response.status).toBe(200);
		await expect(transactionsOfDb(db, account.id)).resolves.toBe(0);
		const failures = logLines
			.map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
			.filter((line) => line["level"] === 50);
		expect(failures).toEqual([
			expect.objectContaining({
				importId: id,
				code: "INTERNAL_ERROR",
				msg: "recurring detection failed",
			}),
		]);
		expect(logLines.join("\n")).not.toMatch(/1399|13\.99|NETFLIX/u);
		expect(run).toHaveBeenCalledWith(expect.anything(), { backfill: false });
	});
});

describe("POST /api/imports/:id/preview", () => {
	it("moves the opening date back on request, and confirm keeps today's balance", async () => {
		const account = await openAccount({ openingDate: "2026-09-05" });
		const preview = await uploaded(account.id, await creditAgricole());
		expect(preview.openingSuggestion).toBe("2026-09-02");
		expect(
			preview.groups.rejected.map(({ ref, reason, line }) => [ref, reason, line?.date]),
		).toEqual([
			["0", "BEFORE_OPENING_DATE", "2026-09-03"],
			["1", "BEFORE_OPENING_DATE", "2026-09-05"],
		]);

		const moved = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: "2026-09-02",
		});

		const { data } = importBody.parse(moved.body);
		expect(data.groups.created).toHaveLength(5);
		expect(data.opening).toEqual({ date: "2026-09-02", balance: 123456 + 4290 + 8712 });
		await expect(balanceOnDay(account.id, "2026-09-05")).resolves.toBe(123456);

		await request("POST", `/api/imports/${preview.id}/confirm`);

		await expect(balanceOnDay(account.id, "2026-09-05")).resolves.toBe(123456);
		// The file's LEDGERBAL on 15 September sets today's balance.
		await expect(balanceOf(account.id)).resolves.toBe(123456);
		const { data: detail } = await (
			await testClient(buildApp()).api.accounts[":id"].$get({ param: { id: account.id } })
		).json();
		expect(detail.openingDate).toBe("2026-09-02");
	});

	it("refuses a malformed date and answers NOT_FOUND for an unknown import", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());

		await expect(
			request("POST", `/api/imports/${preview.id}/preview`, { moveOpeningDate: "hier" }),
		).resolves.toMatchObject({ status: 400, body: { error: { code: "VALIDATION_ERROR" } } });
		await expect(
			request("POST", `/api/imports/${preview.id}/preview`, { moveOpeningDate: "0001-01-01" }),
		).resolves.toEqual({
			status: 400,
			body: {
				error: {
					code: "VALIDATION_ERROR",
					message: "The request is invalid.",
					fields: [{ path: "moveOpeningDate", code: "date_too_early" }],
				},
			},
		});
		await expect(
			request("POST", "/api/imports/nope/preview", { moveOpeningDate: null }),
		).resolves.toMatchObject({ status: 404 });
	});
});

describe("purgeStalePreviews", () => {
	it("deletes the previews older than a day and keeps confirmed imports", async () => {
		const purgeDb = await freshDatabase();

		try {
			const app = withSession(buildTestApp(purgeDb.db), template.cookie);
			const created = await (await testClient(app).api.accounts.$post({ json: valid })).json();
			const accountId = created.data.id;
			const form = () => {
				const body = new FormData();
				body.append("file", new File([new TextEncoder().encode(CARD_OFX)], "carte.ofx"));
				return body;
			};
			const post = async () =>
				importBody.parse(
					await (
						await app.request(`/api/accounts/${accountId}/imports`, {
							method: "POST",
							body: form(),
						})
					).json(),
				).data.id;
			const old = await post();
			const confirmed = await post();
			await app.request(`/api/imports/${confirmed}/confirm`, { method: "POST" });
			vi.setSystemTime(new Date("2026-09-22T10:00:01Z"));

			await expect(purgeStalePreviews({ db: purgeDb.db, timeZone: "Europe/Paris" })).resolves.toBe(
				1,
			);
			const recent = await post();

			const rows = await purgeDb.db.all<{ id: string }>(sql`select id from imports order by id`);
			expect(rows.map((row) => row.id).toSorted()).toEqual([confirmed, recent].toSorted());
			expect(rows.map((row) => row.id)).not.toContain(old);
		} finally {
			await purgeDb.dispose();
		}
	});
});

const CARD_OFX = [
	"<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<BANKTRANLIST>",
	"<STMTTRN><DTPOSTED>20260910<TRNAMT>-12.00<FITID>C1<NAME>Librairie</STMTTRN>",
	"</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>",
].join("\n");

// Story 2.3: import a CSV file with a saved mapping.

const csvMapping = z.object({
	delimiter: z.string(),
	skipRows: z.number(),
	hasHeader: z.boolean(),
	dateFormat: z.string(),
	decimal: z.string(),
	sign: z.string(),
	columns: z.array(z.string()),
});

const csvBody = z.object({
	data: importBody.shape.data.extend({
		csv: z.object({
			sample: z.array(z.array(z.string())),
			mapping: csvMapping.nullable(),
			saved: z.boolean(),
			prefill: csvMapping,
		}),
	}),
});

const societeGenerale = async () =>
	new Uint8Array(
		await readFile(
			new URL("../connectors/csv/fixtures/societe-generale-1252.csv", import.meta.url),
		),
	);

const sgMapping = {
	delimiter: ";",
	skipRows: 3,
	hasHeader: true,
	dateFormat: "DD/MM/YYYY",
	decimal: ",",
	sign: "inflows-positive",
	columns: ["date", "label", "notes", "amount", "ignore"],
} as const;

async function uploadedCsv(accountId: string, bytes: Uint8Array, name = "releve.csv") {
	const { status, body } = await upload(accountId, bytes, name);

	expect(status).toBe(201);

	return csvBody.parse(body).data;
}

async function previewCsv(id: string, csv: unknown, moveOpeningDate: string | null = null) {
	return request("POST", `/api/imports/${id}/preview`, { moveOpeningDate, csv });
}

async function mappingRows(accountId: string) {
	return temp.db.all<{ mapping: string }>(
		sql`select mapping from import_mappings where account_id = ${accountId}`,
	);
}

describe("CSV imports", () => {
	it("opens a first CSV on its columns, with French defaults and nothing computed", async () => {
		const account = await openAccount();

		const preview = await uploadedCsv(account.id, await societeGenerale());

		expect(preview.source).toBe("csv");
		expect(preview.groups).toEqual({
			created: [],
			present: [],
			matched: [],
			duplicates: [],
			rejected: [],
		});
		expect(preview.csv.mapping).toBeNull();
		expect(preview.csv.saved).toBe(false);
		expect(preview.csv.prefill).toEqual({
			delimiter: ";",
			skipRows: 0,
			hasHeader: true,
			dateFormat: "DD/MM/YYYY",
			decimal: ",",
			sign: "inflows-positive",
			columns: ["ignore", "ignore", "ignore", "ignore", "ignore"],
		});
		// windows-1252 decoded: the header reads with its accents.
		expect(preview.csv.sample[3]).toEqual([
			"Date de l'opération",
			"Libellé",
			"Détail de l'écriture",
			"Montant de l'opération",
			"Devise",
		]);
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("ignores a stored mapping that no longer passes the schema", async () => {
		const account = await openAccount();
		const broken = JSON.stringify({ ...sgMapping, columns: ["date", "date", "label", "amount"] });
		await temp.db.run(
			sql`insert into import_mappings (account_id, mapping, updated_at) values (${account.id}, ${broken}, 0)`,
		);

		const preview = await uploadedCsv(account.id, await societeGenerale());

		expect(preview.csv.mapping).toBeNull();
		expect(preview.csv.saved).toBe(false);
		expect(preview.csv.prefill).toEqual({
			delimiter: ";",
			skipRows: 0,
			hasHeader: true,
			dateFormat: "DD/MM/YYYY",
			decimal: ",",
			sign: "inflows-positive",
			columns: ["ignore", "ignore", "ignore", "ignore", "ignore"],
		});
		expect(preview.groups.created).toEqual([]);
		expect(preview.groups.rejected).toEqual([]);
	});

	it("refuses to confirm a CSV import that has no mapping yet", async () => {
		const account = await openAccount();
		const preview = await uploadedCsv(account.id, await societeGenerale());

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 400,
			body: { error: { code: "VALIDATION_ERROR" } },
		});
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("previews with a mapping, confirms, saves the mapping, and applies it to the next file", async () => {
		const account = await openAccount();
		const first = await uploadedCsv(account.id, await societeGenerale());

		const previewed = await previewCsv(first.id, sgMapping);

		expect(previewed.status).toBe(200);
		const { data } = csvBody.parse(previewed.body);
		expect(data.groups.created.map((line) => line.label)).toEqual([
			"CARTE X1234 CAFE DE LA GARE",
			"PRLV SEPA EDF",
			"Prélèvement Crédit Agricole",
			"VIR RECU SALAIRE",
			"CARTE X1234 BOULANGERIE",
			"CARTE X1234 BOULANGERIE",
		]);
		expect(data.csv.mapping).toEqual(sgMapping);
		expect(data.csv.saved).toBe(false);
		// The sample is the file's first records, split with the mapping's delimiter.
		expect(data.csv.sample[3]?.[0]).toBe("Date de l'opération");
		await expect(mappingRows(account.id)).resolves.toEqual([]);

		await expect(request("POST", `/api/imports/${first.id}/confirm`)).resolves.toMatchObject({
			status: 200,
			body: { data: { counts: { created: 6 } } },
		});
		await expect(balanceOf(account.id)).resolves.toBe(
			123456 - 4290 - 8712 - 3150 + 215000 - 350 - 350,
		);
		const list = await transactionsOf(account.id);
		expect(list.items[0]?.source).toEqual({ kind: "import", format: "csv", date: "2026-09-21" });
		const [saved] = await mappingRows(account.id);
		expect(JSON.parse(saved?.mapping ?? "null")).toEqual(sgMapping);

		const again = await uploadedCsv(account.id, await societeGenerale());

		expect(again.csv).toMatchObject({ mapping: sgMapping, saved: true, prefill: sgMapping });
		// Twin lines both created, both recognised.
		expect(again.groups.present).toHaveLength(6);
		expect(again.groups.created).toEqual([]);
	});

	it("keeps recognising lines edited since their import", async () => {
		const account = await openAccount();
		const first = await uploadedCsv(account.id, await societeGenerale());
		await previewCsv(first.id, sgMapping);
		await request("POST", `/api/imports/${first.id}/confirm`);
		const list = await transactionsOf(account.id);
		const cafe = list.items.find((item) => item.label === "CARTE X1234 CAFE DE LA GARE");

		await request("PATCH", `/api/transactions/${cafe?.id}`, {
			label: "Café de la gare",
			amount: "-50,00",
		});
		const again = await uploadedCsv(account.id, await societeGenerale());

		expect(again.groups.present).toHaveLength(6);
	});

	it("opens a file the saved mapping no longer fits on its columns, prefilled with it", async () => {
		const account = await openAccount();
		const first = await uploadedCsv(account.id, await societeGenerale());
		await previewCsv(first.id, {
			...sgMapping,
			skipRows: 0,
			hasHeader: false,
			columns: ["ignore", "ignore", "ignore", "ignore", "date", "label", "amount"],
		});
		// Any line rejected or not, confirm saves the mapping.
		await request("POST", `/api/imports/${first.id}/confirm`);

		const narrow = new TextEncoder().encode("01/09/2026;A;-1,00;x\n02/09/2026;B;-2,00;y\n");
		const preview = await uploadedCsv(account.id, narrow);

		expect(preview.csv.mapping).toBeNull();
		expect(preview.csv.saved).toBe(false);
		expect(preview.csv.prefill.columns).toEqual(["ignore", "ignore", "ignore", "ignore"]);
		expect(preview.csv.prefill.hasHeader).toBe(false);
		expect(preview.groups.created).toEqual([]);

		// A preview without a mapping stays on the columns.
		const without = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: null,
		});
		expect(csvBody.parse(without.body).data.csv.mapping).toBeNull();
	});

	it("gives a rejected record its line in the whole file", async () => {
		const account = await openAccount();
		const file = new TextEncoder().encode(
			[
				"# export",
				"Date;Libellé;Débit;Crédit",
				"03/09/2026;A;1,00;",
				"04/09/2026;B;1,00;2,00",
			].join("\n"),
		);
		const preview = await uploadedCsv(account.id, file);

		const { data } = csvBody.parse(
			(
				await previewCsv(preview.id, {
					...sgMapping,
					skipRows: 1,
					columns: ["date", "label", "debit", "credit"],
				})
			).body,
		);

		expect(data.groups.rejected).toEqual([{ ref: "3", reason: "INVALID_AMOUNT", line: null }]);
	});

	it.each([
		["two date columns", { ...sgMapping, columns: ["date", "date", "label", "amount"] }],
		["no label", { ...sgMapping, columns: ["date", "amount"] }],
		["an amount beside a debit", { ...sgMapping, columns: ["date", "label", "amount", "debit"] }],
		["two debit columns", { ...sgMapping, columns: ["date", "label", "debit", "debit"] }],
		["neither amount nor debit nor credit", { ...sgMapping, columns: ["date", "label"] }],
		["too many rows to skip", { ...sgMapping, skipRows: 51 }],
		["an unknown delimiter", { ...sgMapping, delimiter: "|" }],
	])("refuses a mapping with %s and computes nothing", async (_name, csv) => {
		const account = await openAccount();
		const preview = await uploadedCsv(account.id, await societeGenerale());

		await expect(previewCsv(preview.id, csv)).resolves.toMatchObject({
			status: 400,
			body: { error: { code: "VALIDATION_ERROR" } },
		});
	});

	it("names the columns in the field error of an invalid mapping", async () => {
		const account = await openAccount();
		const preview = await uploadedCsv(account.id, await societeGenerale());

		const { body } = await previewCsv(preview.id, {
			...sgMapping,
			columns: ["date", "date", "label", "amount"],
		});

		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "csv.columns", code: "invalid_columns" },
		]);
	});

	it("refuses a .csv file holding one column of text, and stores nothing", async () => {
		const account = await openAccount();

		const { status, body } = await upload(
			account.id,
			new TextEncoder().encode("Liste de courses\npain\nlait\n"),
			"courses.csv",
		);

		expect(status).toBe(400);
		expect(body).toMatchObject({ error: { code: "INVALID_IMPORT_FILE" } });
		const [row] = await temp.db.all<{ count: number }>(
			sql`select count(*) as count from imports where account_id = ${account.id}`,
		);
		expect(row?.count).toBe(0);
	});

	it("refuses a first CSV with an unterminated quote, and stores nothing", async () => {
		const account = await openAccount();

		const { status, body } = await upload(
			account.id,
			new TextEncoder().encode(
				'Date;Libellé;Montant\n03/09/2026;"CAFE;-4,20\n04/09/2026;PAIN;-1,10\n',
			),
			"releve.csv",
		);

		expect(status).toBe(400);
		expect(body).toMatchObject({ error: { code: "INVALID_IMPORT_FILE" } });
		const [row] = await temp.db.all<{ count: number }>(
			sql`select count(*) as count from imports where account_id = ${account.id}`,
		);
		expect(row?.count).toBe(0);
	});

	it("refuses a CSV whose first line holds more fields than a mapping can name", async () => {
		const account = await openAccount();
		const wide = Array.from({ length: 101 }, (_, index) => `c${index}`).join(";");

		const { status, body } = await upload(
			account.id,
			new TextEncoder().encode(`${wide}\n03/09/2026;CAFE;-4,20\n`),
			"releve.csv",
		);

		expect(status).toBe(400);
		expect(body).toMatchObject({ error: { code: "INVALID_IMPORT_FILE" } });
	});

	it("saves no mapping when confirm finds the account changed", async () => {
		const account = await openAccount();
		const preview = await uploadedCsv(account.id, await societeGenerale());
		await previewCsv(preview.id, sgMapping);
		await postTransaction(account.id, { date: "2026-09-03", label: "Café", amount: "-42,90" });

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 409,
		});

		await expect(mappingRows(account.id)).resolves.toEqual([]);
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 1 });
	});

	it("updates the saved mapping at the next confirm, and drops it with the account", async () => {
		const account = await openAccount();
		const first = await uploadedCsv(account.id, await societeGenerale());
		await previewCsv(first.id, sgMapping);
		await request("POST", `/api/imports/${first.id}/confirm`);
		const second = await uploadedCsv(account.id, await societeGenerale());
		const notesless = { ...sgMapping, columns: ["date", "label", "ignore", "amount", "ignore"] };
		await previewCsv(second.id, notesless);
		await request("POST", `/api/imports/${second.id}/confirm`);

		const [saved] = await mappingRows(account.id);
		expect(JSON.parse(saved?.mapping ?? "null")).toEqual(notesless);

		await request("DELETE", `/api/accounts/${account.id}`);
		await expect(mappingRows(account.id)).resolves.toEqual([]);
	});

	it("ignores a CSV mapping sent for an OFX import", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());

		const again = await previewCsv(preview.id, sgMapping);

		expect(again.status).toBe(200);
		expect(importBody.parse(again.body).data.groups.created).toHaveLength(5);
		expect(z.object({ data: z.object({ csv: z.null() }) }).parse(again.body).data.csv).toBeNull();
	});

	it("confirms 5,000 lines in under 10 seconds, then recognises them all", async () => {
		const account = await openAccount();
		const lines = Array.from(
			{ length: 5000 },
			(_, index) =>
				`${String((index % 19) + 2).padStart(2, "0")}/09/2026;CB MAGASIN ${index % 50};-${(index % 97) + 1},${String(index % 100).padStart(2, "0")}`,
		);
		const file = new TextEncoder().encode(["Date;Libellé;Montant", ...lines].join("\n"));
		const mapping = { ...sgMapping, skipRows: 0, columns: ["date", "label", "amount"] };
		const started = performance.now();
		const preview = await uploadedCsv(account.id, file);
		await previewCsv(preview.id, mapping);

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 200,
			body: { data: { counts: { created: 5000 } } },
		});

		expect(performance.now() - started).toBeLessThan(10_000);
		const again = await uploadedCsv(account.id, file);
		expect(again.groups.present).toHaveLength(5000);
		expect(again.groups.created).toEqual([]);
	}, 30_000);
});

// Story 2.4: import a QIF file.

const qifBody = z.object({
	data: importBody.shape.data.extend({
		qif: z.object({ dateOrder: z.string(), ambiguous: z.boolean() }),
	}),
});

const banquePostale = async () =>
	new Uint8Array(
		await readFile(
			new URL("../connectors/qif/fixtures/banque-postale-bank-1252.qif", import.meta.url),
		),
	);

const qifFile = (...records: string[][]) =>
	new TextEncoder().encode(
		["!Type:Bank", ...records.flatMap((record) => [...record, "^"])].join("\n"),
	);

async function uploadedQif(accountId: string, bytes: Uint8Array, name = "releve.qif") {
	const { status, body } = await upload(accountId, bytes, name);

	expect(status).toBe(201);

	return qifBody.parse(body).data;
}

async function previewQif(id: string, body: Record<string, unknown>) {
	const { status, body: json } = await request("POST", `/api/imports/${id}/preview`, {
		moveOpeningDate: null,
		...body,
	});

	expect(status).toBe(200);

	return qifBody.parse(json).data;
}

const dates = async (id: string) =>
	z
		.object({
			data: z.object({
				groups: z.object({ created: z.array(z.object({ date: z.string() })) }),
			}),
		})
		.parse((await request("POST", `/api/imports/${id}/preview`, { moveOpeningDate: null })).body)
		.data.groups.created.map((line) => line.date);

describe("QIF imports", () => {
	it("previews a bank file, confirms it with its cheque numbers, and recognises it all again", async () => {
		const account = await openAccount();

		const preview = await uploadedQif(account.id, await banquePostale());

		expect(preview.source).toBe("qif");
		expect(preview.qif).toEqual({ dateOrder: "day-first", ambiguous: false });
		expect(preview.statementBalance).toBeNull();
		expect(preview.groups.created.map((line) => line.label)).toEqual([
			"CARTE X1234 CAFÉ DE LA GARE",
			"PRLV EDF Électricité échéance septembre",
			"CHEQUE 1234567",
			"VIR SEPA ACME SAS SALAIRE",
			"CHEQUE 1234568",
			"PRLV FREE MOBILE",
		]);
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });

		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 200,
			body: { data: { counts: { created: 6 } } },
		});
		// The balance row of today, 21 September: the 28th has not happened yet.
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290 - 8712 - 15000 + 215000 - 350);
		const list = await transactionsOf(account.id);
		const cheque = list.items.find((item) => item.label === "CHEQUE 1234567");
		expect(cheque).toMatchObject({
			reference: "1234567",
			source: { kind: "import", format: "qif", date: "2026-09-21" },
		});
		expect(list.items.find((item) => item.label === "PRLV FREE MOBILE")?.reference).toBeNull();

		const again = await uploadedQif(account.id, await banquePostale());

		expect(again.groups.present).toHaveLength(6);
		expect(again.groups.created).toEqual([]);
	});

	it("creates two identical records and recognises both on re-import", async () => {
		const account = await openAccount();
		const twin = ["D10/09/2026", "T-3,50", "PBOULANGERIE"];
		const file = qifFile(twin, twin);
		const preview = await uploadedQif(account.id, file);

		await request("POST", `/api/imports/${preview.id}/confirm`);

		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 2 });
		const again = await uploadedQif(account.id, file);
		expect(again.groups.present).toHaveLength(2);
		expect(again.groups.created).toEqual([]);
	});

	it("reads ambiguous dates day-first, and keeps the month-first choice across re-previews and confirm", async () => {
		const account = await openAccount({ openingDate: "2026-01-01" });
		const file = qifFile(["D02/09/2026", "T-10,00", "PA"], ["D03/04/2026", "T-20,00", "PB"]);

		const preview = await uploadedQif(account.id, file);

		expect(preview.qif).toEqual({ dateOrder: "day-first", ambiguous: true });
		expect(preview.groups.created.map((line) => line.label)).toEqual(["A", "B"]);
		await expect(dates(preview.id)).resolves.toEqual(["2026-09-02", "2026-04-03"]);

		const monthFirst = await previewQif(preview.id, { qif: { dateOrder: "month-first" } });

		expect(monthFirst.qif).toEqual({ dateOrder: "month-first", ambiguous: true });
		// Without `qif`, the stored choice stays.
		await expect(dates(preview.id)).resolves.toEqual(["2026-02-09", "2026-03-04"]);
		await expect(request("POST", `/api/imports/${preview.id}/confirm`)).resolves.toMatchObject({
			status: 200,
		});
		const list = await transactionsOf(account.id);
		expect(list.items.map((item) => item.date).toSorted()).toEqual(["2026-02-09", "2026-03-04"]);
	});

	it("reads month-first without a choice when one date only reads that way", async () => {
		const account = await openAccount({ openingDate: "2026-01-01" });

		const preview = await uploadedQif(account.id, qifFile(["D03/29/2026", "T-1,00", "PA"]));

		expect(preview.qif).toEqual({ dateOrder: "month-first", ambiguous: false });
		expect(preview.groups.created).toMatchObject([{ label: "A" }]);
	});

	it("rejects unreadable records and the opening balance, numbered among transactions", async () => {
		const account = await openAccount();

		const preview = await uploadedQif(
			account.id,
			qifFile(
				["D10/09/2026", "T-1,00", "PA"],
				["D10/09/2026", "U-28,500.00", "T-28,500.00", "PB"],
				["D10/09/2026", "T1.234,56", "PC"],
				["D10/09/2026", "T12,5,0", "PD"],
				["D10/09/2026", "T100,00", "POpening Balance"],
			),
		);

		expect(preview.groups.created.map((line) => [line.label, line.amount])).toEqual([
			["A", -100],
			["B", -2850000],
			["C", 123456],
		]);
		expect(preview.groups.rejected).toEqual([
			{ ref: "3", reason: "INVALID_AMOUNT", line: null },
			{ ref: "4", reason: "OPENING_BALANCE", line: null },
		]);
	});

	it.each([
		["an investment file, naming its type", "!Type:Invst\nD1/5'26\nT50.00\n^", { type: "Invst" }],
		["a file with two accounts", "!Account\nNA\n^\n!Type:Bank\n^\n!Account\nNB\n^\n", undefined],
		["a .qif of plain text", "Liste de courses : pain, lait", undefined],
	])("refuses %s with INVALID_IMPORT_FILE and stores nothing", async (_name, text, params) => {
		const account = await openAccount();

		const { status, body } = await upload(account.id, new TextEncoder().encode(text), "releve.qif");

		expect(status).toBe(400);
		expect(body).toEqual({
			error: {
				code: "INVALID_IMPORT_FILE",
				message:
					params === undefined
						? "The file is not a readable QIF statement."
						: "QIF statements of type Invst are not supported.",
				...(params === undefined ? {} : { params }),
			},
		});
		await expect(
			temp.db.all(sql`select id from imports where account_id = ${account.id}`),
		).resolves.toEqual([]);
		expect(logLines.join("")).not.toContain("Invst");
	});

	it("refuses an unknown date order", async () => {
		const account = await openAccount();
		const preview = await uploadedQif(account.id, qifFile(["D10/09/2026", "T-1,00", "PA"]));

		const { status, body } = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: null,
			qif: { dateOrder: "year-first" },
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.code).toBe("VALIDATION_ERROR");
	});

	it("ignores a date order sent for an OFX import", async () => {
		const account = await openAccount();
		const preview = await uploaded(account.id, await creditAgricole());

		const { status, body } = await request("POST", `/api/imports/${preview.id}/preview`, {
			moveOpeningDate: null,
			qif: { dateOrder: "month-first" },
		});

		expect(status).toBe(200);
		expect(z.object({ data: z.object({ qif: z.null() }) }).parse(body).data.qif).toBeNull();
		const rows = await temp.db.all<{ options: string }>(
			sql`select options from imports where id = ${preview.id}`,
		);
		expect(JSON.parse(rows[0]?.options ?? "null")).toEqual({});
	});
});

describe("POST /api/imports/:id/revert", () => {
	it("deletes the import's transactions and snapshot, and puts the balance back", async () => {
		const account = await openAccount({ openingBalance: "1 000,00" });
		const id = await confirmedImport(account.id);
		await expect(balanceOf(account.id)).resolves.toBe(123456);

		const response = await testClient(buildApp()).api.imports[":id"].revert.$post({
			param: { id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: { id, removed: { transactions: 5, snapshot: 1 } },
		});
		await expect(transactionsOf(account.id)).resolves.toMatchObject({ total: 0 });
		await expect(balanceOf(account.id)).resolves.toBe(100000);
	});

	it("keeps a matched manual transaction, shown as manual again", async () => {
		const account = await openAccount();
		await postTransaction(account.id, { date: "2026-09-04", label: "Café", amount: "-42,90" });
		const id = await confirmedImport(account.id);

		await expect(request("POST", `/api/imports/${id}/revert`)).resolves.toMatchObject({
			status: 200,
			body: { data: { removed: { transactions: 4, snapshot: 1 } } },
		});

		const list = await transactionsOf(account.id);
		expect(list.items).toEqual([
			expect.objectContaining({ label: "Café", source: { kind: "manual" } }),
		]);
	});

	it("lets the same file be imported again, every line to create", async () => {
		const account = await openAccount();
		const id = await confirmedImport(account.id);
		await request("POST", `/api/imports/${id}/revert`);

		const again = await uploaded(account.id, await creditAgricole());

		expect(again.groups.created).toHaveLength(5);
		expect(again.groups.present).toEqual([]);
	});

	it("answers IMPORT_NOT_REVERTABLE twice or for a preview, NOT_FOUND for an unknown id", async () => {
		const account = await openAccount();
		const id = await confirmedImport(account.id);
		await request("POST", `/api/imports/${id}/revert`);
		const preview = await uploaded(account.id, await creditAgricole());

		await expect(request("POST", `/api/imports/${id}/revert`)).resolves.toEqual({
			status: 409,
			body: {
				error: {
					code: "IMPORT_NOT_REVERTABLE",
					message: "Only a confirmed import can be reverted.",
				},
			},
		});
		await expect(request("POST", `/api/imports/${preview.id}/revert`)).resolves.toMatchObject({
			status: 409,
			body: { error: { code: "IMPORT_NOT_REVERTABLE" } },
		});
		await expect(request("POST", "/api/imports/nope/revert")).resolves.toMatchObject({
			status: 404,
			body: { error: { code: "NOT_FOUND" } },
		});
	});

	it("logs the import id, the counts and the duration, never a line or an amount", async () => {
		const account = await openAccount();
		const id = await confirmedImport(account.id);
		const app = buildApp();

		await app.request(`/api/imports/${id}/revert`, { method: "POST" });
		await app.request(`/api/imports/${id}/revert`, { method: "POST" });

		const [reverted, refused] = logLines.map((line) =>
			z.record(z.string(), z.unknown()).parse(JSON.parse(line)),
		);
		expect(reverted).toMatchObject({ importId: id, removed: { transactions: 5, snapshot: 1 } });
		expect(typeof reverted?.["durationMs"]).toBe("number");
		expect(refused).toMatchObject({ importId: id, code: "IMPORT_NOT_REVERTABLE" });
		expect(logLines.join("\n")).not.toMatch(/CAF|BOULANGERIE|4290|releve/u);
	});
});
