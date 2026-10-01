import type { TempDatabase } from "../testing/temp-database.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { createLogger } from "../lib/logger.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { STATISTICS_REFRESH_LINES, confirmImport, createImport } from "./imports.ts";
import { createAccount } from "./ledger.ts";

let temp: TempDatabase;
let logLines: string[];

const importDeps = () => ({
	db: temp.db,
	timeZone: "Europe/Paris",
	logger: createLogger("info", { write: (line: string) => logLines.push(line) }),
});

beforeEach(async () => {
	temp = await createTempDatabase();
	logLines = [];
});

afterEach(async () => {
	vi.restoreAllMocks();
	await temp.dispose();
});

/** Confirms an OFX file of `count` distinct lines on a new account. */
async function confirmLines(count: number) {
	const account = await createAccount(
		importDeps(),
		{
			name: "Compte",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			openingBalance: toMinorUnits(0),
			openingDate: "2020-01-01",
		},
		{ origin: "user" },
	);
	const lines = Array.from(
		{ length: count },
		(_, index) =>
			`<STMTTRN><DTPOSTED>20250101<TRNAMT>-${index + 1}.00<FITID>F${index}<NAME>LIGNE ${index}</STMTTRN>`,
	);
	const bytes = new TextEncoder().encode(
		`<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<BANKTRANLIST>\n${lines.join("\n")}\n</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`,
	);
	const preview = await createImport(importDeps(), account.id, { name: "releve.ofx", bytes });

	return confirmImport(importDeps(), preview.id);
}

const analyses = (spy: { mock: { calls: unknown[][] } }) =>
	spy.mock.calls.filter(([statement]) => String(statement).includes("ANALYZE")).length;

describe("confirmImport and the planner's statistics", () => {
	it("refreshes them after an import of more than 1,000 created lines", async () => {
		const spy = vi.spyOn(temp.db.$client, "executeMultiple");

		const confirmed = await confirmLines(STATISTICS_REFRESH_LINES + 1);

		expect(confirmed.counts.created).toBe(STATISTICS_REFRESH_LINES + 1);
		expect(analyses(spy)).toBe(1);
	}, 30_000);

	it("leaves them alone at 1,000 created lines or fewer", async () => {
		const spy = vi.spyOn(temp.db.$client, "executeMultiple");

		const confirmed = await confirmLines(STATISTICS_REFRESH_LINES);

		expect(confirmed.counts.created).toBe(STATISTICS_REFRESH_LINES);
		expect(analyses(spy)).toBe(0);
	}, 30_000);

	it("logs a refused refresh, code only, and keeps the import", async () => {
		vi.spyOn(temp.db.$client, "executeMultiple").mockRejectedValueOnce(
			Object.assign(new Error("not authorized: 1234,56 EUR"), { code: "SQLITE_AUTH" }),
		);

		const confirmed = await confirmLines(STATISTICS_REFRESH_LINES + 1);

		expect(confirmed.counts.created).toBe(STATISTICS_REFRESH_LINES + 1);
		const warning = logLines.find((line) => line.includes("statistics refresh failed"));
		expect(JSON.parse(warning ?? "{}")).toMatchObject({ level: 40, code: "SQLITE_AUTH" });
		expect(warning).not.toContain("1234");
		expect(logLines.some((line) => line.includes("import confirmed"))).toBe(true);
	}, 30_000);
});
