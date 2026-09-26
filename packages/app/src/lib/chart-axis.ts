const TICK_COUNT = 5;

// A step of 1, 2, 2,5 or 5 times a power of ten reads as a round label.
const STEPS = [1, 2, 2.5, 5, 10];

function roundStep(rough: number): number {
	const power = 10 ** Math.floor(Math.log10(rough));

	return (STEPS.find((step) => step * power >= rough) ?? 10) * power;
}

/**
 * The smallest gap two compact labels show apart, in minor units of a
 * two-decimal currency: a cent below a thousand, then « 0,1 k€ », then
 * « 0,1 M€ ».
 */
function labelResolution(largest: number): number {
	if (largest < 100_000) {
		return 100;
	}

	return largest < 100_000_000 ? 10_000 : 10_000_000;
}

/**
 * Round ticks for a series of minor units, about five of them: `2 500 000`
 * then `2 600 000`, never a value between two cents. A flat or nearly flat
 * series is widened until its compact labels differ, rather than all reading
 * « 4,9 k€ ». The span never crosses zero unless
 * the series does: a positive series labelled « −10 € » would read as an
 * overdraft.
 */
export function axisTicks(values: readonly number[]): number[] {
	const min = Math.min(...values);
	const max = Math.max(...values);
	const pad = Math.max(
		(max - min) * 0.05,
		2 * labelResolution(Math.max(Math.abs(min), Math.abs(max))),
	);
	const low = min >= 0 ? Math.max(0, min - pad) : min - pad;
	const high = max <= 0 ? Math.min(0, max + pad) : max + pad;
	const step = roundStep((high - low) / (TICK_COUNT - 1));
	const first = Math.floor(low / step) * step;
	const last = Math.ceil(high / step) * step;

	return Array.from({ length: Math.round((last - first) / step) + 1 }, (_, index) =>
		// Rounded, since `0.1 + 0.2` style drift would print as a cent.
		Math.round(first + index * step),
	);
}
