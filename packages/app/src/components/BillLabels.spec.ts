import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import fr from "../locales/fr.json";
import { dueLabel } from "./BillLabels.tsx";

const i18n = createInstance();

beforeAll(async () => {
	await i18n.init({
		lng: "fr",
		resources: { fr: { translation: fr } },
		interpolation: { escapeValue: false },
	});
});

type Row = Parameters<typeof dueLabel>[0];

/** An open occurrence due on 5 October, `days` from today, unless `row` says otherwise. */
const label = (row: Partial<Row>) =>
	dueLabel(
		{
			state: "upcoming",
			days: 0,
			dueOn: "2026-10-05",
			effectiveDueOn: "2026-10-05",
			snoozedUntil: null,
			...row,
		},
		i18n.t,
	);

describe("dueLabel", () => {
	it("names a closed occurrence's effective due date only", () => {
		expect(label({ state: "paid", days: -3 })).toBe("Échéance le 5 octobre");
		expect(
			label({
				state: "skipped",
				snoozedUntil: "2026-10-12",
				effectiveDueOn: "2026-10-12",
				days: 6,
			}),
		).toBe("Échéance le 12 octobre");
	});

	it("says a postponement while its date is ahead", () => {
		expect(
			label({
				snoozedUntil: "2026-10-12",
				effectiveDueOn: "2026-10-12",
				days: 6,
				state: "upcoming",
			}),
		).toBe("Reportée au 12 octobre");
	});

	it("counts the days late once overdue, one day singular", () => {
		expect(label({ state: "overdue", days: -1 })).toBe("1 jour de retard, échéance le 5 octobre");
		expect(label({ state: "overdue", days: -5 })).toBe("5 jours de retard, échéance le 5 octobre");
	});

	it("says today, then the date alone inside the grace days", () => {
		expect(label({ state: "due", days: 0 })).toBe("À payer aujourd'hui");
		expect(label({ state: "due", days: -2 })).toBe("Échéance le 5 octobre");
	});

	it("counts the days ahead, tomorrow singular", () => {
		expect(label({ state: "due", days: 1 })).toBe("À payer demain, 5 octobre");
		expect(label({ state: "upcoming", days: 4 })).toBe("À payer dans 4 jours, 5 octobre");
	});
});
