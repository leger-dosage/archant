import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { countsInCashFlow } from "../../domain/cash-flow.ts";
import { monthRange } from "../../domain/dates.ts";
import {
	add,
	addStandard,
	asUser,
	contributionOf,
	deps,
	firstPage,
	importStatement,
	insertTransfer,
	loanPaymentOf,
	newCategory,
	newMerchant,
	newTag,
	openChecking,
	openHousehold,
	openLoan,
	openPea,
	pairOf,
	salary,
	setToday,
	splitInTwo,
	statementOf,
	transferAmount,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { updateTransaction } from "./edits.ts";
import {
	cashFlowByCategory,
	cashFlowByMonth,
	entryOrigins,
	findTransaction,
	listTransactions,
	sumTransactions,
	sumTransactionsByLabel,
	oldestEntryDate,
} from "./queries.ts";

useLedgerDatabase();

describe("entryOrigins", () => {
	it("names the import behind each imported entry and leaves manual ones out", async () => {
		const account = await openChecking();
		const manual = await add(account.id);
		const { result } = await importStatement(account.id, statementOf(salary));
		const [imported = ""] = result.created;

		const origins = await entryOrigins(deps(), [manual, imported]);

		expect([...origins.keys()]).toEqual([imported]);
		const origin = origins.get(imported);
		expect(origin).toMatchObject({ kind: "import", source: "ofx" });
		expect(origin?.kind === "import" && typeof origin.confirmedAt).toBe("number");
		await expect(entryOrigins(deps(), [])).resolves.toEqual(new Map());
	});
});

describe("listTransactions", () => {
	it("orders by date, then creation, then id, most recent first, and pages", async () => {
		const account = await openChecking();
		const first = await add(account.id, { date: "2026-09-12", label: "A" });
		setToday("2026-09-21T10:00:01Z");
		const second = await add(account.id, { date: "2026-09-12", label: "B" });
		const older = await add(account.id, { date: "2026-09-02", label: "C" });

		const all = await listTransactions(
			deps(),
			{ accountIds: [account.id] },
			{ page: 1, pageSize: 50 },
		);
		const secondPage = await listTransactions(
			deps(),
			{ accountIds: [account.id] },
			{ page: 2, pageSize: 2 },
		);

		expect(all.items.map((item) => item.id)).toEqual([second, first, older]);
		expect(all.total).toBe(3);
		expect(secondPage).toEqual({ items: [expect.objectContaining({ id: older })], total: 3 });
	});
});

// Two accounts of the I/O matrix of Story 1.5, each test with its own pair, so
// rows from other tests never match.
async function openPair() {
	const joint = await openChecking({ name: "Compte joint" });
	const card = await openChecking({
		name: "Carte",
		type: "credit_card",
		subtype: null,
		openingBalance: toMinorUnits(0),
	});

	return { joint, card, accountIds: [joint.id, card.id] };
}

const labelsOf = (page: { items: { label: string }[] }) => page.items.map((item) => item.label);

describe("listTransactions across accounts", () => {
	it("lists every account's transactions most recent first, with the account's name", async () => {
		const { joint, card, accountIds } = await openPair();
		await add(joint.id, { date: "2026-09-02", label: "C1" });
		await add(card.id, { date: "2026-09-05", label: "K1" });
		await add(joint.id, { date: "2026-09-08", label: "C2" });
		await add(card.id, { date: "2026-09-11", label: "K2" });
		await add(joint.id, { date: "2026-09-14", label: "C3" });
		await add(card.id, { date: "2026-09-17", label: "K3" });

		const page = await listTransactions(deps(), { accountIds }, firstPage);

		expect(labelsOf(page)).toEqual(["K3", "C3", "K2", "C2", "K1", "C1"]);
		expect(page.total).toBe(6);
		expect(page.items[0]).toMatchObject({ accountId: card.id, accountName: "Carte" });
		expect(page.items[1]).toMatchObject({ accountId: joint.id, accountName: "Compte joint" });
	});

	it("lists every account when no account is named", async () => {
		const { joint } = await openPair();
		const label = `Partout ${crypto.randomUUID()}`;
		await add(joint.id, { label });

		const page = await listTransactions(deps(), { q: label }, firstPage);

		expect(labelsOf(page)).toEqual([label]);
	});

	it("combines account, dates and text, the text in the label or the notes", async () => {
		const { joint, card, accountIds } = await openPair();
		await add(joint.id, { date: "2026-09-02", label: "Carrefour", notes: null });
		await add(joint.id, { date: "2026-09-03", label: "Carrefour Market" });
		await add(joint.id, { date: "2026-09-05", label: "Épicerie", notes: "chez CARREFOUR" });
		await add(joint.id, { date: "2026-09-12", label: "Carrefour City" });
		await add(joint.id, { date: "2026-09-06", label: "Boulangerie" });
		await add(card.id, { date: "2026-09-06", label: "Carrefour" });

		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id], from: "2026-09-03", to: "2026-09-10", q: "carre" },
			firstPage,
		);

		expect(labelsOf(page)).toEqual(["Épicerie", "Carrefour Market"]);
		expect(page.total).toBe(2);
		await expect(
			listTransactions(deps(), { accountIds, q: "carrefour" }, firstPage),
		).resolves.toMatchObject({ total: 5 });
	});

	it("matches %, _ and \\ in the text literally", async () => {
		const { joint } = await openPair();
		await add(joint.id, { label: "Remise 50%" });
		await add(joint.id, { label: "Remise 500" });
		await add(joint.id, { label: "Frais_bancaires" });
		await add(joint.id, { label: "Frais bancaires" });
		await add(joint.id, { label: "Dossier C:\\temp" });
		const accountIds = [joint.id];

		await expect(listTransactions(deps(), { accountIds, q: "50%" }, firstPage)).resolves.toEqual({
			items: [expect.objectContaining({ label: "Remise 50%" })],
			total: 1,
		});
		await expect(
			listTransactions(deps(), { accountIds, q: "s_b" }, firstPage),
		).resolves.toMatchObject({ items: [{ label: "Frais_bancaires" }] });
		await expect(
			listTransactions(deps(), { accountIds, q: ":\\t" }, firstPage),
		).resolves.toMatchObject({ items: [{ label: "Dossier C:\\temp" }] });
	});

	it("bounds the absolute amount, both ways", async () => {
		const { joint, accountIds } = await openPair();
		await add(joint.id, { label: "Dépense", amount: toMinorUnits(-4290) });
		await add(joint.id, { label: "Revenu", amount: toMinorUnits(4500) });
		await add(joint.id, { label: "Petite", amount: toMinorUnits(-1200) });
		await add(joint.id, { label: "Grosse", amount: toMinorUnits(-9000) });
		const range = (min: number | null, max: number | null) => ({
			accountIds,
			amounts: [
				{
					currency: "EUR",
					min: min === null ? null : toMinorUnits(min),
					max: max === null ? null : toMinorUnits(max),
				},
			],
		});

		const between = await listTransactions(deps(), range(4000, 5000), firstPage);
		const atLeast = await listTransactions(deps(), range(4290, null), firstPage);
		const atMost = await listTransactions(deps(), range(null, 4500), firstPage);
		const open = await listTransactions(deps(), range(null, null), firstPage);

		expect(labelsOf(between).toSorted()).toEqual(["Dépense", "Revenu"]);
		expect(labelsOf(atLeast).toSorted()).toEqual(["Dépense", "Grosse", "Revenu"]);
		expect(labelsOf(atMost).toSorted()).toEqual(["Dépense", "Petite", "Revenu"]);
		expect(open.total).toBe(4);
	});

	it("leaves out the currencies the amount bounds do not name", async () => {
		const { joint } = await openPair();
		const dollars = await openChecking({ name: "Dollars", currency: "USD" });
		await add(joint.id, { label: "Euros", amount: toMinorUnits(-4290) });
		await add(dollars.id, { label: "Dollars", amount: toMinorUnits(-4290), currency: "USD" });
		const amounts = [{ currency: "EUR", min: toMinorUnits(4000), max: toMinorUnits(5000) }];

		const page = await listTransactions(
			deps(),
			{ accountIds: [joint.id, dollars.id], amounts },
			firstPage,
		);

		expect(labelsOf(page)).toEqual(["Euros"]);
	});

	it("matches nothing for an empty account list or no currency left in range", async () => {
		const { joint, accountIds } = await openPair();
		await add(joint.id);

		await expect(listTransactions(deps(), { accountIds: [] }, firstPage)).resolves.toEqual({
			items: [],
			total: 0,
		});
		await expect(listTransactions(deps(), { accountIds, amounts: [] }, firstPage)).resolves.toEqual(
			{ items: [], total: 0 },
		);
		await expect(sumTransactions(deps(), { accountIds: [] })).resolves.toEqual([]);
	});

	it("filters on categories as given, on « Sans catégorie », or both", async () => {
		const { joint } = await openPair();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const other = await newCategory("Santé");
		const categorise = async (label: string, categoryId: string | null) => {
			const id = await add(joint.id, { label });
			await updateTransaction(deps(), id, { categoryId }, { origin: "user" });
		};
		await categorise("Marché", groceries);
		await categorise("Cinéma", leisure);
		await categorise("Pharmacie", other);
		await categorise("Virement", null);
		const accountIds = [joint.id];
		const labels = async (filter: Parameters<typeof listTransactions>[1]) =>
			labelsOf(await listTransactions(deps(), { accountIds, ...filter }, firstPage)).toSorted();

		await expect(labels({ categoryIds: [groceries, leisure] })).resolves.toEqual([
			"Cinéma",
			"Marché",
		]);
		await expect(labels({ uncategorised: true })).resolves.toEqual(["Virement"]);
		await expect(labels({ categoryIds: [groceries], uncategorised: true })).resolves.toEqual([
			"Marché",
			"Virement",
		]);
		await expect(labels({ categoryIds: ["nope"] })).resolves.toEqual([]);
		await expect(labels({ categoryIds: [] })).resolves.toEqual([]);
		await expect(
			listTransactions(deps(), { accountIds, categoryIds: [groceries] }, firstPage),
		).resolves.toMatchObject({ total: 1, items: [{ categoryId: groceries }] });
		await expect(
			sumTransactions(deps(), { accountIds, categoryIds: [groceries], uncategorised: true }),
		).resolves.toEqual([{ currency: "EUR", amount: -8580, income: 0, expense: -8580, count: 2 }]);
	});

	it("filters on merchants, ORed, with count and sum to match", async () => {
		const { joint } = await openPair();
		const carrefour = await newMerchant("Carrefour");
		const lidl = await newMerchant("Lidl");
		const other = await newMerchant("Fnac");
		const link = async (label: string, merchantId: string | null) => {
			const id = await add(joint.id, { label });
			await updateTransaction(deps(), id, { merchantId }, { origin: "user" });
		};
		await link("CB CARREFOUR 1234", carrefour);
		await link("CARREFOUR MARKET", carrefour);
		await link("LIDL", lidl);
		await link("FNAC", other);
		await link("Virement", null);
		const accountIds = [joint.id];
		const labels = async (filter: Parameters<typeof listTransactions>[1]) =>
			labelsOf(await listTransactions(deps(), { accountIds, ...filter }, firstPage)).toSorted();

		await expect(labels({ merchantIds: [carrefour, lidl] })).resolves.toEqual([
			"CARREFOUR MARKET",
			"CB CARREFOUR 1234",
			"LIDL",
		]);
		await expect(labels({ merchantIds: ["nope"] })).resolves.toEqual([]);
		await expect(labels({ merchantIds: [] })).resolves.toEqual([]);
		await expect(
			listTransactions(deps(), { accountIds, merchantIds: [carrefour, lidl] }, firstPage),
		).resolves.toMatchObject({ total: 3 });
		await expect(
			sumTransactions(deps(), { accountIds, merchantIds: [carrefour, lidl] }),
		).resolves.toEqual([{ currency: "EUR", amount: -12870, income: 0, expense: -12870, count: 3 }]);
	});

	it("filters on tags, ORed, listing and counting a row with both tags once", async () => {
		const { joint } = await openPair();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const other = await newTag("Autre");
		const tag = async (label: string, tagIds: string[]) => {
			const id = await add(joint.id, { label });
			await updateTransaction(deps(), id, { tagIds }, { origin: "user" });

			return id;
		};
		const both = await tag("Hôtel", [holidays, work]);
		await tag("Train", [holidays]);
		await tag("Peinture", [work]);
		await tag("Livre", [other]);
		await tag("Virement", []);
		const accountIds = [joint.id];
		const labels = async (filter: Parameters<typeof listTransactions>[1]) =>
			labelsOf(await listTransactions(deps(), { accountIds, ...filter }, firstPage)).toSorted();

		await expect(labels({ tagIds: [holidays, work] })).resolves.toEqual([
			"Hôtel",
			"Peinture",
			"Train",
		]);
		await expect(labels({ tagIds: ["nope"] })).resolves.toEqual([]);
		await expect(labels({ tagIds: [] })).resolves.toEqual([]);
		const page = await listTransactions(
			deps(),
			{ accountIds, tagIds: [holidays, work] },
			firstPage,
		);
		expect(page.total).toBe(3);
		expect(page.items.find((item) => item.id === both)?.tagIds).toEqual(
			[holidays, work].toSorted(),
		);
		await expect(
			sumTransactions(deps(), { accountIds, tagIds: [holidays, work] }),
		).resolves.toEqual([{ currency: "EUR", amount: -12870, income: 0, expense: -12870, count: 3 }]);
	});

	it("lists, counts and filters a split's children, never its parent", async () => {
		const account = await openChecking({ name: "Divisé" });
		const { parent, food, home } = await splitInTwo(account.id);
		const filtered = await listTransactions(
			deps(),
			{ accountIds: [account.id], q: "HYPERMARCHE" },
			firstPage,
		);
		const all = await listTransactions(deps(), { accountIds: [account.id] }, firstPage);

		expect(all.items.map((item) => item.id).toSorted()).toEqual([food, home].toSorted());
		expect(all.items.map((item) => item.parentEntryId)).toEqual([parent, parent]);
		expect(all.total).toBe(2);
		expect(filtered).toEqual({ items: [], total: 0 });
		await expect(findTransaction(deps(), parent)).resolves.toMatchObject({
			excluded: true,
			parentEntryId: null,
		});
	});

	it("is an empty page for an unknown account", async () => {
		await expect(listTransactions(deps(), { accountIds: ["nope"] }, firstPage)).resolves.toEqual({
			items: [],
			total: 0,
		});
	});
});

describe("sumTransactions", () => {
	it("sums and counts per currency, excluded and pending transactions included", async () => {
		const { joint } = await openPair();
		const dollars = await openChecking({ name: "Dollars", currency: "USD" });
		const excluded = await add(joint.id, { amount: toMinorUnits(-4290) });
		await updateTransaction(deps(), excluded, { excluded: true }, { origin: "user" });
		await add(joint.id, { amount: toMinorUnits(10000) });
		await add(joint.id, { amount: toMinorUnits(-800), label: "En attente", pending: true });
		await add(dollars.id, { amount: toMinorUnits(-1000), currency: "USD" });

		await expect(sumTransactions(deps(), { accountIds: [joint.id, dollars.id] })).resolves.toEqual([
			{ currency: "EUR", amount: 4910, income: 10000, expense: -5090, count: 3 },
			{ currency: "USD", amount: -1000, income: 0, expense: -1000, count: 1 },
		]);
	});

	it("keeps the income and the expense sums to the rows the direction filter matches", async () => {
		const { joint } = await openPair();
		await add(joint.id, { amount: toMinorUnits(10000) });
		const excluded = await add(joint.id, { amount: toMinorUnits(-4290) });
		await updateTransaction(deps(), excluded, { excluded: true }, { origin: "user" });
		await add(joint.id, { amount: toMinorUnits(-800), label: "En attente", pending: true });

		await expect(
			sumTransactions(deps(), { accountIds: [joint.id], direction: ["expense"] }),
		).resolves.toEqual([{ currency: "EUR", amount: -5090, income: 0, expense: -5090, count: 2 }]);
	});

	it("sums a split's children, never its parent", async () => {
		const account = await openChecking({ name: "Somme divisée" });
		const { amount } = await splitInTwo(account.id);

		await expect(sumTransactions(deps(), { accountIds: [account.id] })).resolves.toEqual([
			{ currency: "EUR", amount, income: 0, expense: amount, count: 2 },
		]);
		await expect(sumTransactionsByLabel(deps(), { accountIds: [account.id] })).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: "Courses", amount: -6_000 }),
				expect.objectContaining({ label: "Maison", amount: amount + 6_000 }),
			]),
		);
	});

	it("sums only the rows the text matches", async () => {
		const { joint } = await openPair();
		await add(joint.id, { label: "Loyer", amount: toMinorUnits(-90000) });
		await add(joint.id, { label: "Pain", amount: toMinorUnits(-120) });

		await expect(sumTransactions(deps(), { accountIds: [joint.id], q: "loyer" })).resolves.toEqual([
			{ currency: "EUR", amount: -90000, income: 0, expense: -90000, count: 1 },
		]);
	});
});

const byLabelAndSign = <Row extends { label: string; outflow: boolean; currency: string }>(
	rows: Row[],
) =>
	rows.toSorted(
		(a, b) =>
			a.label.localeCompare(b.label) ||
			Number(a.outflow) - Number(b.outflow) ||
			a.currency.localeCompare(b.currency),
	);

describe("sumTransactionsByLabel", () => {
	it("counts and sums per exact label, currency, sign and category, with the last date", async () => {
		const joint = await openChecking();
		const dollars = await openChecking({ name: "Dollars", currency: "USD" });
		const groceries = await newCategory("Courses");
		await add(joint.id, { label: "CB LIDL", amount: toMinorUnits(-1000), date: "2026-09-10" });
		await add(joint.id, { label: "CB LIDL", amount: toMinorUnits(-500), date: "2026-09-12" });
		await add(joint.id, { label: "CB LIDL", amount: toMinorUnits(300), date: "2026-09-11" });
		await add(joint.id, { label: "cb lidl", amount: toMinorUnits(-200), date: "2026-09-05" });
		const filed = await add(joint.id, { label: "CB LIDL", amount: toMinorUnits(-100) });
		await updateTransaction(deps(), filed, { categoryId: groceries }, { origin: "user" });
		await add(dollars.id, { label: "CB LIDL", amount: toMinorUnits(-700), currency: "USD" });

		const rows = await sumTransactionsByLabel(deps(), { accountIds: [joint.id, dollars.id] });

		expect(byLabelAndSign(rows)).toEqual(
			byLabelAndSign([
				{
					label: "CB LIDL",
					currency: "EUR",
					outflow: true,
					categoryId: null,
					count: 2,
					amount: -1500,
					lastDate: "2026-09-12",
				},
				{
					label: "CB LIDL",
					currency: "EUR",
					outflow: true,
					categoryId: groceries,
					count: 1,
					amount: -100,
					lastDate: "2026-09-10",
				},
				{
					label: "CB LIDL",
					currency: "EUR",
					outflow: false,
					categoryId: null,
					count: 1,
					amount: 300,
					lastDate: "2026-09-11",
				},
				{
					label: "CB LIDL",
					currency: "USD",
					outflow: true,
					categoryId: null,
					count: 1,
					amount: -700,
					lastDate: "2026-09-10",
				},
				{
					label: "cb lidl",
					currency: "EUR",
					outflow: true,
					categoryId: null,
					count: 1,
					amount: -200,
					lastDate: "2026-09-05",
				},
			]),
		);
	});

	it("groups only the rows the filter keeps, and none for a filter that matches nothing", async () => {
		const joint = await openChecking();
		await add(joint.id, { label: "Loyer", amount: toMinorUnits(-90000) });
		await add(joint.id, { label: "Pain", amount: toMinorUnits(-120) });

		await expect(
			sumTransactionsByLabel(deps(), { accountIds: [joint.id], q: "loyer" }),
		).resolves.toMatchObject([{ label: "Loyer", count: 1 }]);
		await expect(sumTransactionsByLabel(deps(), { accountIds: [] })).resolves.toEqual([]);
	});
});

const byCategoryAndAmount = (rows: { categoryId: string | null; amount: number }[]) =>
	rows.toSorted(
		(a, b) => String(a.categoryId).localeCompare(String(b.categoryId)) || a.amount - b.amount,
	);

describe("cashFlowByCategory", () => {
	it("sums per category and sign exactly the rows `countsInCashFlow` counts", async () => {
		const { livret, card } = await openHousehold();
		const mortgage = await openLoan();
		const pea = await openPea();
		// Opened in August, so a row can sit on the last day before the month.
		const joint = await openChecking({ name: "Compte courant", openingDate: "2026-08-01" });
		const accountIds = [joint.id, livret.id, card.id, mortgage.id, pea.id];
		const groceries = await newCategory("Courses");
		const inCategory = async (amount: number, date = "2026-09-10") => {
			const id = await add(joint.id, { amount: toMinorUnits(amount), date, label: "Courses" });
			await updateTransaction(deps(), id, { categoryId: groceries }, asUser);

			return id;
		};
		// Amounts of their own: step 6 would link them to another test's rows.
		await inCategory(-transferAmount());
		await inCategory(transferAmount());
		await inCategory(-transferAmount(), "2026-09-01");
		await inCategory(-transferAmount(), "2026-09-30");
		await inCategory(-transferAmount(), "2026-10-01");
		await inCategory(-transferAmount(), "2026-08-31");
		await add(joint.id, { amount: toMinorUnits(transferAmount()), label: "income" });
		await add(joint.id, { amount: toMinorUnits(-transferAmount()), label: "expense" });
		await add(joint.id, { amount: toMinorUnits(0), label: "zero" });
		const excluded = await inCategory(-transferAmount());
		await updateTransaction(deps(), excluded, { excluded: true }, asUser);
		const pendingRow = await add(joint.id, {
			amount: toMinorUnits(-transferAmount()),
			label: "pending",
			pending: true,
		});
		await updateTransaction(deps(), pendingRow, { categoryId: groceries }, asUser);
		await add(joint.id, {
			amount: toMinorUnits(transferAmount()),
			label: "pending",
			pending: true,
		});
		const categorisedSide = await inCategory(-transferAmount());
		const counterpart = await addStandard(livret.id, {
			amount: toMinorUnits(transferAmount()),
			label: "side in",
		});
		await insertTransfer(categorisedSide, counterpart, "internal_move");
		await pairOf("internal_move", joint.id, livret.id);
		await pairOf("credit_card_payment", joint.id, card.id);
		await loanPaymentOf(joint.id, mortgage.id);
		await contributionOf(joint.id, pea.id);
		// A split: the list leaves its parent out, so it is read apart, and
		// `countsInCashFlow` must leave it out on its own.
		const split = await splitInTwo(joint.id, { date: "2026-09-12" });
		await updateTransaction(deps(), split.food, { categoryId: groceries }, asUser);
		const parent = await findTransaction(deps(), split.parent);

		const all = await listTransactions(deps(), { accountIds }, firstPage);
		const expected = new Map<string, { categoryId: string | null; amount: number }>();
		for (const item of [...all.items, ...(parent === null ? [] : [parent])]) {
			if (item.date >= "2026-09-01" && item.date <= "2026-09-30" && countsInCashFlow(item)) {
				const key = `${item.categoryId}:${item.amount > 0}`;
				const current = expected.get(key);
				expected.set(key, {
					categoryId: item.categoryId,
					amount: (current?.amount ?? 0) + item.amount,
				});
			}
		}
		const rows = await cashFlowByCategory(deps(), {
			from: "2026-09-01",
			to: "2026-09-30",
			accountIds,
		});

		expect(byCategoryAndAmount(rows)).toEqual(byCategoryAndAmount([...expected.values()]));
		// Courses: both signs of three counted expenses and one refund, and
		// uncategorised: one income, then the expense, the zero and two outflows.
		expect(rows).toHaveLength(4);
		await expect(
			cashFlowByCategory(deps(), { from: "2026-09-01", to: "2026-09-30", accountIds: [] }),
		).resolves.toEqual([]);
	});
});

describe("cashFlowByMonth", () => {
	it("gives each month exactly the rows `cashFlowByCategory` gives it, up to `to`", async () => {
		const { livret } = await openHousehold();
		const mortgage = await openLoan();
		const joint = await openChecking({ name: "Compte courant", openingDate: "2026-06-01" });
		const accountIds = [joint.id, livret.id, mortgage.id];
		const groceries = await newCategory("Courses par mois");
		const inCategory = async (amount: number, date: string) => {
			const id = await add(joint.id, { amount: toMinorUnits(amount), date, label: "Courses" });
			await updateTransaction(deps(), id, { categoryId: groceries }, asUser);

			return id;
		};
		await inCategory(-transferAmount(), "2026-07-03");
		await inCategory(transferAmount(), "2026-07-31");
		await inCategory(-transferAmount(), "2026-08-01");
		await add(joint.id, { amount: toMinorUnits(transferAmount()), date: "2026-08-15" });
		await add(joint.id, { amount: toMinorUnits(-transferAmount()), date: "2026-08-16" });
		const excluded = await inCategory(-transferAmount(), "2026-08-20");
		await updateTransaction(deps(), excluded, { excluded: true }, asUser);
		await add(joint.id, {
			amount: toMinorUnits(-transferAmount()),
			date: "2026-09-02",
			pending: true,
		});
		await pairOf("internal_move", joint.id, livret.id);
		await loanPaymentOf(joint.id, mortgage.id);
		// After `to`: left out.
		await inCategory(-transferAmount(), "2026-10-01");

		const rows = await cashFlowByMonth(deps(), { to: "2026-09-30", accountIds });

		const months = ["2026-06", "2026-07", "2026-08", "2026-09"];
		const expected = await Promise.all(
			months.map((month) => cashFlowByCategory(deps(), { ...monthRange(month), accountIds })),
		);

		expect(
			months.map((month) =>
				byCategoryAndAmount(
					rows
						.filter((row) => row.month === month)
						.map(({ categoryId, amount }) => ({ categoryId, amount })),
				),
			),
		).toEqual(expected.map(byCategoryAndAmount));
		expect([...new Set(rows.map((row) => row.month))].toSorted()).toEqual([
			"2026-07",
			"2026-08",
			"2026-09",
		]);
		await expect(cashFlowByMonth(deps(), { to: "2026-09-30", accountIds: [] })).resolves.toEqual(
			[],
		);
	});
});

describe("oldestEntryDate", () => {
	it("names the earliest entry of any kind, and nothing in an empty ledger", async () => {
		const empty = await createTempDatabase();

		try {
			await expect(oldestEntryDate({ db: empty.db, timeZone: "Europe/Paris" })).resolves.toBe(null);
		} finally {
			await empty.dispose();
		}

		// An opening anchor is an entry: the account's opening date counts.
		await openChecking({ name: "Ancien compte", openingDate: "2003-04-05" });

		await expect(oldestEntryDate(deps())).resolves.toBe("2003-04-05");
	});
});
