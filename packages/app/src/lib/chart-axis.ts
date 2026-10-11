import type { MinorUnits } from "@archant/data/money";
import { isCurrencyCode, minorUnitsOf } from "@archant/data/money";

/** A chart's vertical extent in minor units, low then high; either may fall between two cents. */
export type AxisDomain = readonly [low: number, high: number];

const TICK_COUNT = 5;

// A step of 1, 2, 2.5 or 5 times a power of ten reads as a round label.
const STEPS = [1, 2, 2.5, 5];

// Sure's `_yAxisMinRelSpan` and `_yAxisPadding`: the floor stops a smaller
// move from being enlarged beyond 1.5 % of the balance; a larger one fills
// about 80 % of the height.
const MIN_RELATIVE_SPAN = 0.015;
const PADDING = 0.12;

// Sure's loan and goal charts leave 5 % above their highest value.
const HEADROOM = 1.05;

// Sure's `SAVED_HEADROOM_FACTOR`: a saved line past twice the goal's own scale is clipped.
const SAVED_HEADROOM_FACTOR = 2;

/** One whole unit of `currency` in minor units: 100 for euros, 1 for yen. */
function unitOf(currency: string): number {
	return 10 ** (isCurrencyCode(currency) ? minorUnitsOf(currency) : 2);
}

/**
 * Sure's `_d3YScale` for a balance chart, in minor units. The span is the
 * series' own, never under 1.5 % of its mean, padded by 12 % on each side; a
 * series close to zero for its scale reaches zero rather than being clamped
 * to it, so 0 € to 5 000 € opens at −600 €. A flat series sits centred, half
 * its value either side, or 100 units either side at zero.
 */
export function balanceDomain(values: readonly MinorUnits[], currency: string): AxisDomain {
	const min = Math.min(...values);
	const max = Math.max(...values);

	if (min === max) {
		const padding = max === 0 ? 100 * unitOf(currency) : Math.abs(max) * 0.5;

		return [min - padding, max + padding];
	}

	const mean = (min + max) / 2;
	const span = Math.max(max - min, Math.abs(mean) * MIN_RELATIVE_SPAN);
	const padding = span * PADDING;
	const low = mean - span / 2 - padding;
	const high = mean + span / 2 + padding;

	if (min >= 0 && min < mean * 0.1) {
		return [Math.min(0, low), high];
	}

	if (max <= 0 && max > mean * 0.1) {
		return [low, Math.max(0, high)];
	}

	return [low, high];
}

/**
 * Sure's `loan_payoff_chart_controller`: from nothing owed to 5 % above the
 * highest balance shown, or to one unit when nothing is owed.
 */
export function loanDomain(values: readonly MinorUnits[], currency: string): AxisDomain {
	const max = Math.max(0, ...values);

	return [0, (max > 0 ? max : unitOf(currency)) * HEADROOM];
}

/**
 * Sure's `goal_projection_chart_controller`: from zero to what the goal's own
 * content needs, the target with 5 % above it, the projection and today's
 * amount, then room for the saved line up to twice that. Past it the saved
 * line is clipped, so a current account's salary peaks do not flatten the
 * target into the floor.
 */
export function goalDomain(
	{
		target,
		projections,
		saved,
	}: { target: MinorUnits; projections: readonly MinorUnits[]; saved: readonly MinorUnits[] },
	currency: string,
): AxisDomain {
	const goalBand = Math.max(target * HEADROOM, ...projections, saved.at(-1) ?? 0, unitOf(currency));
	const highestSaved = Math.max(0, ...saved);

	return [
		0,
		Math.min(Math.max(goalBand, highestSaved * HEADROOM), goalBand * SAVED_HEADROOM_FACTOR),
	];
}

/**
 * The smallest gap two compact labels show apart, in minor units: a unit
 * below a thousand, then « 0,1 k€ », then « 0,1 M€ ».
 */
function labelResolution(largest: number, unit: number): number {
	if (largest < 1_000 * unit) {
		return unit;
	}

	return largest < 1_000_000 * unit ? 100 * unit : 100_000 * unit;
}

/**
 * The round step that lays closest to five ticks inside `low` to `high`,
 * the fewer on a tie, and a whole number of label resolutions, so each
 * label reads its exact value: at a resolution of 100 €, a step of 250 €
 * would label 99 250 € « 99,3 k€ ».
 */
function roundStep(low: number, high: number, resolution: number): number {
	const power = 10 ** Math.floor(Math.log10(Math.max((high - low) / TICK_COUNT, resolution)));
	const count = (step: number) => Math.floor(high / step) - Math.ceil(low / step) + 1;

	return [10 * power, power]
		.flatMap((scale) => STEPS.toReversed().map((step) => step * scale))
		.filter((step) => step % resolution === 0)
		.reduce((best, step) =>
			Math.abs(count(step) - TICK_COUNT) < Math.abs(count(best) - TICK_COUNT) ? step : best,
		);
}

/**
 * Round ticks inside a domain of minor units, about five of them, laid over
 * Sure's scale rather than stretching it: `2 500 000` then `2 600 000`, never
 * a value between two cents, and never two closer than their compact labels
 * tell apart, so two never read « 4,9 k€ ». The ticks never cross zero unless
 * the series does: a positive series labelled « −10 € » would read as an
 * overdraft, even where Sure's domain dips below zero to show it.
 */
export function axisTicks(
	domain: AxisDomain,
	currency: string,
	values: readonly MinorUnits[],
): number[] {
	const low = Math.min(...values) >= 0 ? Math.max(0, domain[0]) : domain[0];
	const high = Math.max(...values) <= 0 ? Math.min(0, domain[1]) : domain[1];
	const unit = unitOf(currency);
	const resolution = labelResolution(Math.max(Math.abs(low), Math.abs(high)), unit);
	const step = roundStep(low, high, resolution);
	const first = Math.ceil(low / step);
	const last = Math.floor(high / step);

	if (first > last) {
		// Narrower than a label's resolution: a tick there would read another
		// value, and Recharts draws no label for an empty list.
		return [];
	}

	// `+ 0` turns `-0` into zero, which would print signed.
	return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step + 0);
}
