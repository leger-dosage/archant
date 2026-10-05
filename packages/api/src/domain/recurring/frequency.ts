import type { IsoDate } from "../dates.ts";
import type { RecurrenceRule } from "./schedule.ts";

import type { RecurrenceFrequency } from "@archant/data/recurring";
import { LAST_DAY_OF_MONTH, RECURRENCE_FREQUENCIES } from "@archant/data/recurring";

import { weekdayOf } from "../dates.ts";

/** Sure's `FrequencyPreset::PRESETS`: the picker's named cadences. */
export const FREQUENCY_PRESETS = [
	"monthly",
	"weekly",
	"biweekly",
	"semimonthly",
	"quarterly",
	"semiannual",
	"annual",
] as const;

type FrequencyPreset = (typeof FREQUENCY_PRESETS)[number];

/** Sure's `INTERVAL`: every N weeks, months or years, for what no preset names. */
export const INTERVAL_PRESET = "interval";

/** Sure's `CUSTOM`: rules no preset expresses, read back and left as they are. */
export const CUSTOM_PRESET = "custom";

export type FrequencyKey = FrequencyPreset | typeof INTERVAL_PRESET | typeof CUSTOM_PRESET;

/** Sure's `INTERVAL_UNITS`. */
export const INTERVAL_UNITS = RECURRENCE_FREQUENCIES;

/** Sure's `MAX_INTERVAL`. */
export const MAX_INTERVAL = 99;

/** Sure's `FrequencyPreset::Detection`: what the picker shows for a series' rules. */
export type Frequency = {
	key: FrequencyKey;
	/** 1 to 31, or −1 for the month's last day. */
	dayOfMonth: number | null;
	secondDayOfMonth: number | null;
	/** 0 is Sunday. */
	weekday: number | null;
	monthOfYear: number | null;
	interval: number | null;
	intervalUnit: RecurrenceFrequency | null;
};

/** What the picker submits; a field left out takes Sure's default. */
export type FrequencyChoice = {
	dayOfMonth?: number | null | undefined;
	secondDayOfMonth?: number | null | undefined;
	weekday?: number | null | undefined;
	monthOfYear?: number | null | undefined;
} & (
	| { preset: FrequencyPreset }
	| { preset: typeof CUSTOM_PRESET }
	| { preset: typeof INTERVAL_PRESET; interval: number; unit: RecurrenceFrequency }
);

/** What `applyFrequency` reads of a series. */
export type ScheduleFields = {
	rules: readonly RecurrenceRule[];
	anchorDate: IsoDate | null;
	lastOccurrenceDate: IsoDate;
	expectedDayOfMonth: number;
};

/** The rules, expected day and anchor a changed cadence writes. */
export type FrequencyChange = {
	rules: RecurrenceRule[];
	expectedDayOfMonth: number;
	anchorDate: IsoDate | null;
};

/** Sure's `valid_interval?`: a whole number of weeks, months or years from 1 to 99. */
export function isValidInterval(interval: number): boolean {
	return Number.isInteger(interval) && interval >= 1 && interval <= MAX_INTERVAL;
}

function detection(key: FrequencyKey, fields: Partial<Omit<Frequency, "key">> = {}): Frequency {
	return {
		key,
		dayOfMonth: null,
		secondDayOfMonth: null,
		weekday: null,
		monthOfYear: null,
		interval: null,
		intervalUnit: null,
		...fields,
	};
}

type DayFields = { dayOfMonth: number | null; weekday: number | null; monthOfYear: number | null };

/**
 * Sure's `every`: one rule of `interval` units, read as the named preset it
 * is when one exists, so « tous les 3 mois » and « Trimestrielle » are one
 * schedule whichever way it was entered.
 */
function every(unit: RecurrenceFrequency, interval: number, days: DayFields): Frequency {
	const preset: Partial<Record<`${RecurrenceFrequency}:${number}`, FrequencyPreset>> = {
		"weekly:1": "weekly",
		"weekly:2": "biweekly",
		"monthly:1": "monthly",
		"monthly:3": "quarterly",
		"monthly:6": "semiannual",
		"yearly:1": "annual",
	};
	const key = preset[`${unit}:${interval}`];

	if (key === "weekly" || key === "biweekly") {
		return detection(key, { weekday: days.weekday });
	}

	if (key === "annual") {
		return detection(key, { dayOfMonth: days.dayOfMonth, monthOfYear: days.monthOfYear });
	}

	if (key !== undefined) {
		return detection(key, { dayOfMonth: days.dayOfMonth });
	}

	return detection(INTERVAL_PRESET, {
		interval,
		intervalUnit: unit,
		weekday: unit === "weekly" ? days.weekday : null,
		dayOfMonth: unit === "weekly" ? null : days.dayOfMonth,
		monthOfYear: unit === "yearly" ? days.monthOfYear : null,
	});
}

function daysOf(rule: RecurrenceRule): DayFields {
	switch (rule.frequency) {
		case "weekly":
			return { dayOfMonth: null, weekday: rule.weekday, monthOfYear: null };
		case "monthly":
			return { dayOfMonth: rule.dayOfMonth, weekday: null, monthOfYear: null };
		default:
			return { dayOfMonth: rule.dayOfMonth, weekday: null, monthOfYear: rule.monthOfYear };
	}
}

/**
 * Sure's `canonical_semimonthly_days`: the last day sorts as the month's end,
 * so (15, last) and (last, 15) are one schedule.
 */
const rank = (day: number) => (day === LAST_DAY_OF_MONTH ? 32 : day);

function canonicalDays(days: readonly [number, number]): [number, number] {
	return rank(days[0]) <= rank(days[1]) ? [days[0], days[1]] : [days[1], days[0]];
}

/** Two days a month, or one when both are the same day. */
function semimonthly(days: readonly [number, number]): Frequency {
	const [first, second] = canonicalDays(days);

	return first === second
		? detection("monthly", { dayOfMonth: first })
		: detection("semimonthly", { dayOfMonth: first, secondDayOfMonth: second });
}

const isMonthlyDay = (
	rule: RecurrenceRule,
): rule is Extract<RecurrenceRule, { frequency: "monthly" }> =>
	rule.frequency === "monthly" && rule.interval === 1;

/**
 * Sure's `FrequencyPreset.detect`: a series' rules read back as the picker
 * shows them; a shape no preset expresses is `custom`.
 */
export function detectFrequency(rules: readonly RecurrenceRule[]): Frequency {
	if (rules.length === 1) {
		const rule = rules[0]!;

		return every(rule.frequency, rule.interval, daysOf(rule));
	}

	const first = rules[0]!;
	const second = rules[1]!;

	return rules.length === 2 && isMonthlyDay(first) && isMonthlyDay(second)
		? semimonthly([first.dayOfMonth, second.dayOfMonth])
		: detection(CUSTOM_PRESET);
}

const dayOf = (date: IsoDate) => Number(date.slice(8, 10));

const monthOf = (date: IsoDate) => Number(date.slice(5, 7));

/**
 * Sure's `target_detection`: what the submitted values resolve to, with the
 * defaults the rules are written with, so it compares exactly with
 * `detectFrequency`. A weekly cadence without a weekday takes the
 * reference's, where Sure leaves it for the schedule to read.
 */
function targetOf(
	current: ScheduleFields,
	reference: IsoDate,
	choice: Exclude<FrequencyChoice, { preset: typeof CUSTOM_PRESET }>,
): Frequency {
	const day = choice.dayOfMonth ?? null;
	const weekday = choice.weekday ?? weekdayOf(reference);

	switch (choice.preset) {
		case "monthly":
		case "quarterly":
		case "semiannual":
			return detection(choice.preset, { dayOfMonth: day ?? current.expectedDayOfMonth });
		case "weekly":
		case "biweekly":
			return detection(choice.preset, { weekday });
		case "semimonthly":
			return semimonthly([day ?? 1, choice.secondDayOfMonth ?? 15]);
		case "annual":
			return detection("annual", {
				dayOfMonth: day ?? dayOf(reference),
				monthOfYear: choice.monthOfYear ?? monthOf(reference),
			});
		default:
			return every(choice.unit, choice.interval, {
				dayOfMonth:
					day ?? (choice.unit === "yearly" ? dayOf(reference) : current.expectedDayOfMonth),
				weekday,
				monthOfYear: choice.monthOfYear ?? monthOf(reference),
			});
	}
}

const sameFrequency = (a: Frequency, b: Frequency) =>
	a.key === b.key &&
	a.dayOfMonth === b.dayOfMonth &&
	a.secondDayOfMonth === b.secondDayOfMonth &&
	a.weekday === b.weekday &&
	a.monthOfYear === b.monthOfYear &&
	a.interval === b.interval &&
	a.intervalUnit === b.intervalUnit;

/** The one rule `target` is, for the keys that write one. */
function ruleOf(target: Frequency, interval: number): RecurrenceRule {
	switch (target.intervalUnit ?? "monthly") {
		case "weekly":
			return { frequency: "weekly", interval, weekday: target.weekday! };
		case "monthly":
			return { frequency: "monthly", interval, dayOfMonth: target.dayOfMonth! };
		default:
			return {
				frequency: "yearly",
				interval,
				dayOfMonth: target.dayOfMonth!,
				monthOfYear: target.monthOfYear!,
			};
	}
}

/** Sure's `write`: the rules of `target`, and the anchor an every-N cadence needs. */
function rulesOf(target: Frequency): { rules: RecurrenceRule[]; anchored: boolean } {
	switch (target.key) {
		case "weekly":
			return {
				rules: [{ frequency: "weekly", interval: 1, weekday: target.weekday! }],
				anchored: false,
			};
		case "biweekly":
			return {
				rules: [{ frequency: "weekly", interval: 2, weekday: target.weekday! }],
				anchored: true,
			};
		case "semimonthly":
			return {
				rules: [
					{ frequency: "monthly", interval: 1, dayOfMonth: target.dayOfMonth! },
					{ frequency: "monthly", interval: 1, dayOfMonth: target.secondDayOfMonth! },
				],
				anchored: false,
			};
		case "quarterly":
			return { rules: [ruleOf(target, 3)], anchored: true };
		case "semiannual":
			return { rules: [ruleOf(target, 6)], anchored: true };
		case "annual":
			return {
				rules: [
					{
						frequency: "yearly",
						interval: 1,
						dayOfMonth: target.dayOfMonth!,
						monthOfYear: target.monthOfYear!,
					},
				],
				anchored: false,
			};
		case "interval":
			return { rules: [ruleOf(target, target.interval!)], anchored: true };
		default:
			// `monthly`: `targetOf` never resolves to `custom`.
			return { rules: [ruleOf(target, 1)], anchored: false };
	}
}

/**
 * Sure's `authoritative_day`: a day-anchored cadence stores its day, the last
 * as 31; a weekly one the reference's day, which nothing schedules from.
 */
function expectedDayOf(target: Frequency, reference: IsoDate): number {
	if (target.dayOfMonth === null) {
		return dayOf(reference);
	}

	return target.dayOfMonth === LAST_DAY_OF_MONTH ? 31 : target.dayOfMonth;
}

/**
 * Sure's `FrequencyPreset.apply`: the rules `choice` writes in place of the
 * series', with its expected day, and an anchor set on the reference, its
 * anchor or else its last date, for an every-N cadence that has none. `null`
 * when the cadence is unchanged or `custom`, so a caller pins a schedule only
 * when the owner changed it.
 */
export function applyFrequency(
	current: ScheduleFields,
	choice: FrequencyChoice,
): FrequencyChange | null {
	if (choice.preset === CUSTOM_PRESET) {
		return null;
	}

	const reference = current.anchorDate ?? current.lastOccurrenceDate;
	const target = targetOf(current, reference, choice);

	if (sameFrequency(target, detectFrequency(current.rules))) {
		return null;
	}

	const { rules, anchored } = rulesOf(target);

	return {
		rules,
		expectedDayOfMonth: expectedDayOf(target, reference),
		anchorDate: anchored ? reference : current.anchorDate,
	};
}
