import type { BalanceChartProps } from "@/components/BalanceChart";

import { Suspense, lazy } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { CHART_HEIGHTS, DEFAULT_CHART_HEIGHT } from "@/lib/chart-heights";

// Recharts weighs more than the rest of a page; only the dashboard and an
// account's page draw a balance, so only they download it.
const BalanceChart = lazy(async () => ({
	default: (await import("@/components/BalanceChart")).BalanceChart,
}));

/** `BalanceChart`, behind a placeholder of its own height while it loads. */
export function LazyBalanceChart(props: BalanceChartProps) {
	const height = CHART_HEIGHTS[props.height ?? DEFAULT_CHART_HEIGHT];

	return (
		<Suspense fallback={<Skeleton className={`${height} w-full`} aria-hidden="true" />}>
			<BalanceChart {...props} />
		</Suspense>
	);
}
