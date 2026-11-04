import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import fr from "../locales/fr.json";
import {
	comparisonText,
	isShortHistory,
	loanPickerSelection,
	namesPeriod,
	rangeLabel,
	selectedPeriod,
} from "./periods.ts";

const i18n = createInstance();

beforeAll(async () => {
	await i18n.init({
		lng: "fr",
		resources: { fr: { translation: fr } },
		interpolation: { escapeValue: false },
	});
});

describe("selectedPeriod", () => {
	it("takes the address's range over its key and the saved period", () => {
		expect(
			selectedPeriod(
				{ period: "last_7_days", startDate: "2026-10-05", endDate: "2026-10-20" },
				"last_90_days",
			),
		).toEqual({ startDate: "2026-10-05", endDate: "2026-10-20" });
	});

	it("takes the address's key over the saved period", () => {
		expect(selectedPeriod({ period: "current_year" }, "last_90_days")).toEqual({
			period: "current_year",
		});
	});

	it("takes the saved period when the address names none", () => {
		expect(selectedPeriod({}, "last_90_days")).toEqual({ period: "last_90_days" });
		expect(selectedPeriod({ startDate: "2026-10-05" }, "last_90_days")).toEqual({
			period: "last_90_days",
		});
	});

	it("falls back to Sure's last 30 days without a saved period", () => {
		expect(selectedPeriod({}, undefined)).toEqual({ period: "last_30_days" });
	});

	it("falls back to the last 30 days for a range that is not one, over the saved period", () => {
		expect(
			selectedPeriod({ startDate: "2026-10-20", endDate: "2026-10-05" }, "last_90_days"),
		).toEqual({ period: "last_30_days" });
	});
});

describe("namesPeriod", () => {
	it("is true for a key or both dates only", () => {
		expect(namesPeriod({ period: "last_day" })).toBe(true);
		expect(namesPeriod({ startDate: "2026-10-05", endDate: "2026-10-20" })).toBe(true);
		expect(namesPeriod({ startDate: "2026-10-05" })).toBe(false);
		expect(namesPeriod({})).toBe(false);
	});
});

describe("loanPickerSelection", () => {
	it("keeps a period the loan chart offers", () => {
		expect(loanPickerSelection({ period: "last_90_days" })).toBe("last_90_days");
	});

	it("reads « Tout » for another period and for a custom range", () => {
		expect(loanPickerSelection({ period: "last_7_days" })).toBe("all_time");
		expect(loanPickerSelection({ startDate: "2026-10-05", endDate: "2026-10-20" })).toBe(
			"all_time",
		);
	});
});

describe("rangeLabel", () => {
	it("drops the year inside the current one", () => {
		expect(rangeLabel(i18n.t, "2026-10-05", "2026-10-20", "2026-11-04")).toBe("5 oct. – 20 oct.");
	});

	it("keeps the year once a day falls in another", () => {
		expect(rangeLabel(i18n.t, "2025-12-20", "2026-01-05", "2026-11-04")).toBe(
			"20 déc. 2025 – 5 janv. 2026",
		);
	});
});

describe("isShortHistory", () => {
	it("is true when the account starts after the period", () => {
		expect(
			isShortHistory({ period: "last_90_days", periodFrom: "2026-08-06", from: "2026-10-25" }),
		).toBe(true);
		expect(
			isShortHistory({ period: "last_90_days", periodFrom: "2026-08-06", from: "2026-08-06" }),
		).toBe(false);
	});

	it("is never true for « Tout », whose start Sure moves to the history's", () => {
		expect(
			isShortHistory({ period: "all_time", periodFrom: "2021-11-04", from: "2026-11-04" }),
		).toBe(false);
	});

	it("is false without a day charted", () => {
		expect(isShortHistory({ period: "last_7_days", periodFrom: "2026-10-28", from: null })).toBe(
			false,
		);
	});
});

describe("comparisonText", () => {
	it("gives a key Sure's comparison label", () => {
		expect(
			comparisonText(i18n.t, {
				period: "last_90_days",
				periodFrom: "2026-08-06",
				to: "2026-11-04",
			}),
		).toBe("vs. dernier trimestre");
	});

	it("names a custom range's days with their year", () => {
		expect(
			comparisonText(i18n.t, { period: null, periodFrom: "2026-10-05", to: "2026-10-20" }),
		).toBe("5 oct. 2026 au 20 oct. 2026");
	});

	it("says the history is shorter than the period", () => {
		expect(
			comparisonText(
				i18n.t,
				{ period: "last_90_days", periodFrom: "2026-08-06", to: "2026-11-04" },
				true,
			),
		).toBe("par rapport à l'historique disponible");
	});
});
