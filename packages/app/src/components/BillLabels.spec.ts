import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import { formatMoney, toMinorUnits } from "@archant/data/money";

import fr from "../locales/fr.json";
import { dueLabel, noticeGroups, noticeText } from "./BillLabels.tsx";

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

// Node's and the browser's ICU disagree on the space before « % ».
const spaced = (text: string) => text.replaceAll(/\s/gu, " ");

const notice = (previous: number, next: number, percent: number) =>
	spaced(
		noticeText(
			{
				name: "Netflix",
				previousAmount: toMinorUnits(previous),
				newAmount: toMinorUnits(next),
				currency: "EUR",
				percent,
			},
			i18n.t,
		),
	);

const euros = (amount: number) =>
	spaced(formatMoney({ amount: toMinorUnits(amount), currency: "EUR" }));

describe("noticeText", () => {
	it("reads Sure's notice, the percent whole and signed", () => {
		expect(notice(1349, 1599, 19)).toBe(
			`Netflix a changé de prix : ${euros(1349)} → ${euros(1599)} (+19 %)`,
		);
		expect(notice(1000, 900, -10)).toBe(
			`Netflix a changé de prix : ${euros(1000)} → ${euros(900)} (−10 %)`,
		);
	});
});

describe("noticeGroups", () => {
	const urgent = { id: "u", urgent: true };
	const routine = { id: "r", urgent: false };

	it("folds the routine notices only behind an urgent one", () => {
		expect(noticeGroups([urgent, routine])).toEqual({
			urgent: [urgent],
			routine: [routine],
			folded: true,
		});
		expect(noticeGroups([routine, routine])).toMatchObject({ urgent: [], folded: false });
		expect(noticeGroups([urgent])).toMatchObject({ routine: [], folded: false });
	});
});
