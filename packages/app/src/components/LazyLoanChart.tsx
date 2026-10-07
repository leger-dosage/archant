import type { ComponentProps } from "react";

import { Suspense, lazy } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { CHART_HEIGHTS, DEFAULT_CHART_HEIGHT } from "@/lib/chart-heights";

// Recharts weighs more than the rest of a page, as `LazyBalanceChart` says;
// only a loan with a schedule draws this chart.
const LoanChart = lazy(async () => ({
	default: (await import("@/components/LoanChart")).LoanChart,
}));

/** `LoanChart`, behind a placeholder of its own height while it loads. */
export function LazyLoanChart(props: ComponentProps<typeof LoanChart>) {
	return (
		<Suspense
			fallback={
				<Skeleton className={`${CHART_HEIGHTS[DEFAULT_CHART_HEIGHT]} w-full`} aria-hidden="true" />
			}
		>
			<LoanChart {...props} />
		</Suspense>
	);
}
