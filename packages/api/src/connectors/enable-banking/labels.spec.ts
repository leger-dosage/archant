import { describe, expect, it } from "vitest";

import { keyLabelOf, labelOf, merchantNameOf, primaryRemittance } from "./labels.ts";
import { transactionSchema } from "./schemas.ts";

/** A debit with no counterparty, no bank code and `remittance`, `extra` on top. */
const line = (remittance: unknown[], extra: Record<string, unknown> = {}) =>
	transactionSchema.parse({
		credit_debit_indicator: "DBIT",
		remittance_information: remittance,
		...extra,
	});

const card = (remittance: unknown[]) => line(remittance, { creditor: { name: " card-1234 " } });

describe("primaryRemittance", () => {
	it("drops a wallet prefix, then a card terminal's", () => {
		for (const wallet of ["Apple Pay: ", "google pay :", "SAMSUNG  PAY:  "]) {
			expect(primaryRemittance(line([`${wallet}SUMUP *CAFE DU COIN`]), [])).toBe("CAFE DU COIN");
		}

		for (const terminal of ["SUMUP *", "SQ*", "iZettle * ", "ZETTLE *", "PAYPAL *"]) {
			expect(primaryRemittance(line([`${terminal}GLACIER`]), [])).toBe("GLACIER");
		}
	});

	it("keeps a line that is nothing but a terminal prefix", () => {
		expect(primaryRemittance(line(["SUMUP *"]), [])).toBe("SUMUP *");
	});

	it("skips a technical terminal line, and a line the wallet prefix empties", () => {
		expect(
			primaryRemittance(line(["POS   45,13 AT  D6   31.07. 10:27", "BILLA DANKT 0007114"]), []),
		).toBe("BILLA DANKT 0007114");
		expect(primaryRemittance(line(["ATM 20.00 1.7 08:15", "Retrait"]), [])).toBe("Retrait");
		expect(primaryRemittance(line(["Apple Pay:", "Boulangerie"]), [])).toBe("Boulangerie");
	});

	it("needs both halves of a technical line to skip it", () => {
		expect(primaryRemittance(line(["POS 45,13 BILLA DANKT", "Autre"]), [])).toBe(
			"POS 45,13 BILLA DANKT",
		);
		expect(primaryRemittance(line(["Invoice paid 31.07. 10:27", "Autre"]), [])).toBe(
			"Invoice paid 31.07. 10:27",
		);
	});

	it("falls back to the first line when every line is technical, and to none without any", () => {
		expect(primaryRemittance(line(["POS 1,00 X 1.1. 10:00", "ATM 2,00 Y 2.2. 11:00"]), [])).toBe(
			"POS 1,00 X 1.1. 10:00",
		);
		expect(primaryRemittance(line([]), [])).toBeNull();
		expect(primaryRemittance(line([" ", 3]), [])).toBeNull();
	});

	it("prefers the longest known merchant it names as a whole word, as stored", () => {
		expect(primaryRemittance(line(["BILLA DANKT 0007114"]), ["Billa"])).toBe("Billa");
		expect(primaryRemittance(line(["BILLA PLUS 12"]), ["Billa", "Billa Plus"])).toBe("Billa Plus");
		expect(primaryRemittance(line(["SUMUP *A+B (Café) Wien"]), ["A+B (Café)"])).toBe("A+B (Café)");
	});

	it("keeps the first listed of two known names of the same length", () => {
		expect(primaryRemittance(line(["BILLA HOFER 12"]), ["Hofer", "Billa"])).toBe("Hofer");
		expect(primaryRemittance(line(["BILLA HOFER 12"]), ["Billa", "Hofer"])).toBe("Billa");
	});

	it("never matches a known name inside a word, nor one shorter than three characters", () => {
		expect(primaryRemittance(line(["BILLAS 12"]), ["Billa"])).toBe("BILLAS 12");
		expect(primaryRemittance(line(["ÉBILLA 12"]), ["Billa"])).toBe("ÉBILLA 12");
		expect(primaryRemittance(line(["BILLA_12"]), ["Billa"])).toBe("BILLA_12");
		expect(primaryRemittance(line(["NAME IT"]), ["IT"])).toBe("NAME IT");
	});

	it("matches a known name's own characters literally", () => {
		expect(primaryRemittance(line(["SHOP AXC"]), ["A.C"])).toBe("SHOP AXC");
		expect(primaryRemittance(line(["SHOP A.C"]), ["A.C"])).toBe("A.C");
	});
});

describe("labelOf", () => {
	it("names a line from its readable counterparty", () => {
		expect(labelOf(line(["CB"], { creditor: { name: "Boulangerie Martin" } }), true, [])).toBe(
			"Boulangerie Martin",
		);
		expect(
			labelOf(
				line(["VIR"], { credit_debit_indicator: "CRDT", debtor: { name: "Employeur" } }),
				false,
				[],
			),
		).toBe("Employeur");
	});

	it("names a card placeholder's line from its cleaned remittance, before the bank code", () => {
		expect(
			labelOf(
				line(["Apple Pay: SUMUP *CAFE DU COIN"], {
					creditor: { name: "CARD-1234" },
					bank_transaction_code: { description: "Paiement carte" },
				}),
				true,
				[],
			),
		).toBe("CAFE DU COIN");
	});

	it("cuts a remittance longer than 100 code points as Rails' truncate", () => {
		const long = "é".repeat(150);

		expect(labelOf(card([long]), true, [])).toBe(`${"é".repeat(97)}...`);
		expect(labelOf(line([long]), true, [])).toBe(`${"é".repeat(97)}...`);
		expect(labelOf(line(["é".repeat(100)]), true, [])).toBe("é".repeat(100));
	});

	it("falls back on the bank code, the remittance, then the direction", () => {
		expect(
			labelOf(
				line(["SUMUP *GLACIER"], { bank_transaction_code: { description: "Carte" } }),
				true,
				[],
			),
		).toBe("Carte");
		expect(labelOf(card([]), true, [])).toBe("Virement sortant");
		expect(labelOf(line(["SUMUP *GLACIER"]), true, [])).toBe("GLACIER");
		expect(labelOf(line([], { credit_debit_indicator: "CRDT" }), false, [])).toBe(
			"Virement entrant",
		);
	});

	it("names a line from a known merchant its remittance holds", () => {
		expect(labelOf(line(["BILLA DANKT 0007114"]), true, ["Billa"])).toBe("Billa");
	});
});

describe("keyLabelOf", () => {
	it("reads the label as before Sure's clean-ups", () => {
		expect(keyLabelOf(card(["Apple Pay: SUMUP *CAFE"]), true)).toBe("card-1234");
		expect(keyLabelOf(line(["POS 45,13 AT D6 31.07. 10:27", "BILLA"]), true)).toBe(
			"POS 45,13 AT D6 31.07. 10:27",
		);
		expect(keyLabelOf(line(["X"], { bank_transaction_code: { description: "Carte" } }), true)).toBe(
			"Carte",
		);
		expect(keyLabelOf(line([]), true)).toBe("Virement sortant");
	});
});

describe("merchantNameOf", () => {
	it("takes the readable counterparty", () => {
		expect(merchantNameOf(line([], { creditor: { name: "Boulangerie Martin" } }), true, [])).toBe(
			"Boulangerie Martin",
		);
	});

	it("takes a card placeholder's cleaned remittance, cut to a merchant name and trimmed", () => {
		expect(merchantNameOf(card(["Apple Pay: SUMUP *CAFE DU COIN"]), true, [])).toBe("CAFE DU COIN");
		expect(merchantNameOf(card([`${"a".repeat(59)} ${"b".repeat(90)}`]), true, [])).toBe(
			"a".repeat(59),
		);
		expect(merchantNameOf(card([]), true, [])).toBeNull();
	});

	it("takes a remittance only when it is a known merchant's name", () => {
		expect(merchantNameOf(line(["BILLA DANKT 0007114"]), true, ["Billa"])).toBe("Billa");
		expect(merchantNameOf(line(["SUMUP *GLACIER"]), true, ["Billa"])).toBeNull();
		expect(merchantNameOf(line([]), true, [])).toBeNull();
	});

	it("cuts a long counterparty to a merchant name", () => {
		expect(merchantNameOf(line([], { creditor: { name: "x".repeat(80) } }), true, [])).toBe(
			"x".repeat(60),
		);
	});

	it("counts UTF-16 units as the merchant form does, never cutting an emoji in half", () => {
		const name = merchantNameOf(
			line([], { creditor: { name: `${"x".repeat(59)}🥐 Café` } }),
			true,
			[],
		);

		expect(name).toBe("x".repeat(59));
	});

	it("composes a decomposed name, as the merchant form stores it", () => {
		expect(merchantNameOf(line([], { creditor: { name: "E\u0301picerie" } }), true, [])).toBe(
			"\u00C9picerie",
		);
	});
});
