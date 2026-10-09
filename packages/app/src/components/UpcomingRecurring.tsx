import type { UpcomingData } from "@/hooks/useRecurring";

import { useTranslation } from "react-i18next";

import { EmptyNote } from "@/components/EmptyState";
import { InsetGroup } from "@/components/InsetGroup";
import { Money } from "@/components/Money";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { recurringName, useUpcomingRecurring } from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { dayAndMonth, daysFrom, toIsoDate } from "@/lib/dates";

/** The series by next expected date, in the server's order. */
function byDate(items: readonly UpcomingData[]): [string, UpcomingData[]][] {
	const groups = new Map<string, UpcomingData[]>();

	for (const item of items) {
		groups.set(item.nextExpectedDate, [...(groups.get(item.nextExpectedDate) ?? []), item]);
	}

	return [...groups];
}

/**
 * Sure's `transactions/_upcoming`: the active series expected within ten
 * days, grouped by date, each with when it is expected and the one signed
 * amount `_projected_transaction` shows. Nothing to act on, for an
 * administrator as for a viewer.
 */
export function UpcomingRecurring() {
	const { t } = useTranslation();
	const upcoming = useUpcomingRecurring();
	const today = toIsoDate();

	if (upcoming.isPending) {
		return (
			<div className="flex flex-col gap-2">
				<Skeleton className="h-14 w-full" />
				<Skeleton className="h-14 w-full" />
			</div>
		);
	}

	if (upcoming.isError) {
		return (
			<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
				<p className="text-muted-foreground">{t(`errors.${errorCodeOf(upcoming.error)}`)}</p>
				<Button variant="outline" onClick={() => void upcoming.refetch()}>
					{t("common.retry")}
				</Button>
			</div>
		);
	}

	if (upcoming.data.length === 0) {
		return <EmptyNote className="py-6 text-center">{t("operations.upcoming.empty")}</EmptyNote>;
	}

	return (
		<div className="flex flex-col gap-4">
			{byDate(upcoming.data).map(([date, items]) => (
				<InsetGroup key={date} level={2} title={dayAndMonth(date)} count={items.length}>
					<ul className="flex flex-col divide-y divide-line">
						{items.map((item) => {
							const days = Math.max(daysFrom(today, date), 0);

							return (
								<li key={item.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
									<TintedIcon subject={{ kind: "merchant", name: recurringName(item) }} size="md" />
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate font-medium">{recurringName(item)}</span>
										<span className="text-xs text-muted-foreground">
											{days === 0
												? t("operations.upcoming.today")
												: t("operations.upcoming.inDays", { count: days })}
										</span>
									</span>
									<Money amount={item.projectedAmount} currency={item.currency} signed />
								</li>
							);
						})}
					</ul>
				</InsetGroup>
			))}
		</div>
	);
}
