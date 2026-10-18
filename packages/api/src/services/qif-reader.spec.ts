import { describe, expect, it } from "vitest";

import { AppError } from "../lib/errors.ts";
import {
	categoryAndTags,
	normalizeQifDate,
	qifDateOf,
	qifDecimalOf,
	readQif,
} from "./qif-reader.ts";

// Story 30.6: Sure's `QifParser` at 00dd977fb.

const TODAY = "2026-09-21";

const read = (...lines: string[]) => readQif(lines.join("\n"), TODAY);

describe("categoryAndTags", () => {
	it("reads Sure's `parse_category_and_tags`", () => {
		expect(categoryAndTags("Alimentation")).toEqual({ category: "Alimentation", tags: [] });
		expect(categoryAndTags("Alimentation/Vacances:Été")).toEqual({
			category: "Alimentation",
			tags: ["Vacances", "Été"],
		});
		expect(categoryAndTags("Maison:Jardin/ Projet ")).toEqual({
			category: "Maison:Jardin",
			tags: ["Projet"],
		});
		expect(categoryAndTags("[Livret A]")).toEqual({ category: "", tags: [] });
		expect(categoryAndTags("--Split--")).toEqual({ category: "", tags: [] });
		expect(categoryAndTags("")).toEqual({ category: "", tags: [] });
	});
});

describe("dates", () => {
	it("normalises Quicken's dates as Sure's `normalize_qif_date`", () => {
		expect(normalizeQifDate("1/ 5'24", TODAY)).toBe("1/5/2024");
		expect(normalizeQifDate("12/31'2025", TODAY)).toBe("12/31/2025");
		expect(normalizeQifDate("04.06.20", TODAY)).toBe("04.06.2020");
		expect(normalizeQifDate("26  Jan 2026", TODAY)).toBe("26 Jan 2026");
		// A two-digit year past this one is last century's.
		expect(normalizeQifDate("1/5/98", TODAY)).toBe("1/5/1998");
	});

	it("reads a date with the chosen format", () => {
		expect(qifDateOf("1/ 5'24", "%m/%d/%Y", TODAY)).toBe("2024-01-05");
		expect(qifDateOf("1/ 5'24", "%d/%m/%Y", TODAY)).toBe("2024-05-01");
		expect(qifDateOf("31/12'25", "%m/%d/%Y", TODAY)).toBeNull();
	});
});

describe("qifDecimalOf", () => {
	it("reads a quantity or a price, a lone comma as decimal mark", () => {
		expect(qifDecimalOf("10")).toBe("10");
		expect(qifDecimalOf("1,234.5678")).toBe("1234.5678");
		expect(qifDecimalOf("15,25")).toBe("15.25");
		expect(qifDecimalOf("1,000")).toBe("1000");
		expect(qifDecimalOf("1.234,5678")).toBe("1234.5678");
		expect(qifDecimalOf("+2.")).toBe("2");
		expect(qifDecimalOf("abc")).toBeNull();
	});
});

describe("readQif", () => {
	it("refuses a file without a `!Type:` header", () => {
		expect(() => read("D01/02/2026", "T-1", "^")).toThrow(AppError);
	});

	it("reads each account's sections, categories, tags, splits and opening balance", () => {
		const file = read(
			"!Option:AutoSwitch",
			"!Account",
			"NCourant",
			"TBank",
			"^",
			"NCarte",
			"TCCard",
			"^",
			"!Clear:AutoSwitch",
			"!Account",
			"NCourant",
			"TBank",
			"^",
			"!Type:Bank",
			"D01/02/2026",
			"T1,000.00",
			"POpening Balance",
			"^",
			"D01/05/2026",
			"T-100.00",
			"PSupermarché",
			"MCourses",
			"L--Split--",
			"SAlimentation/Famille",
			"$-60.00",
			"EFruits",
			"SAuto:Essence",
			"$-40.00",
			"^",
			"D01/06/2026",
			"T-12,50",
			"PCafé",
			"LLoisirs/Vacances:Été",
			"^",
			"!Account",
			"NCarte",
			"TCCard",
			"^",
			"!Type:CCard",
			"D01/07/2026",
			"T-30.00",
			"PLibrairie",
			"L[Courant]",
			"^",
		);

		expect(file.accounts.map((account) => account.name)).toEqual([
			"Courant",
			"Carte",
			"Courant",
			"Carte",
		]);
		expect(file.firstType).toBe("Bank");
		expect(file.openings).toEqual([{ account: "Courant", date: "01/02/2026", amount: "1,000.00" }]);
		expect(file.transactions).toHaveLength(3);
		expect(file.transactions[0]).toMatchObject({
			payee: "Supermarché",
			memo: "Courses",
			category: "",
			account: { name: "Courant", type: "Bank" },
			type: "Bank",
			splits: [
				{ category: "Alimentation", tags: ["Famille"], amount: "-60.00", memo: "Fruits" },
				{ category: "Auto:Essence", tags: [], amount: "-40.00", memo: "" },
			],
		});
		expect(file.transactions[1]).toMatchObject({
			amount: "-12,50",
			category: "Loisirs",
			tags: ["Vacances", "Été"],
		});
		expect(file.transactions[2]).toMatchObject({ account: { name: "Carte" }, category: "" });
		expect(file.dates).toEqual(["01/02/2026", "01/05/2026", "01/06/2026", "01/07/2026"]);
	});

	it("reads investment records with their security's ticker", () => {
		const file = read(
			"!Type:Security",
			"NApple Inc.",
			"SAAPL",
			"TStock",
			"^",
			"!Type:Invst",
			"D03/02/2026",
			"NBuy",
			"YApple Inc.",
			"I15",
			"Q10",
			"T155",
			"^",
			"D03/05/2026",
			"NDiv",
			"YApple Inc.",
			"T12,50",
			"^",
			"D03/06/2026",
			"YApple Inc.",
			"T1",
			"^",
		);

		expect(file.firstType).toBe("Invst");
		expect(file.transactions).toEqual([]);
		expect(file.investments).toHaveLength(2);
		expect(file.investments[0]).toMatchObject({
			action: "Buy",
			security: "Apple Inc.",
			ticker: "AAPL",
			price: "15",
			quantity: "10",
			amount: "155",
			type: "Invst",
			account: null,
		});
		expect(file.investments[1]).toMatchObject({ action: "Div", amount: "12,50" });
	});
});
