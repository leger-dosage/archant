import type { TransactionData } from "@/hooks/useTransactions";

import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { ExcludedMarker } from "@/components/ExcludedMarker";
import { Money } from "@/components/Money";
import { Skeleton } from "@/components/ui/skeleton";
import { useListNavigation } from "@/hooks/useListNavigation";
import { dayHeading } from "@/lib/dates";

type TransactionListProps = {
	items: readonly TransactionData[];
	onOpen: (transaction: TransactionData) => void;
	/** Shows each row's account, for a list spanning several. */
	showAccount?: boolean;
};

function groupByDay(items: readonly TransactionData[]) {
	const days: { date: string; items: TransactionData[] }[] = [];

	for (const item of items) {
		const last = days.at(-1);

		// The API sorts by date first, so a day's rows are always adjacent.
		if (last?.date === item.date) {
			last.items.push(item);
		} else {
			days.push({ date: item.date, items: [item] });
		}
	}

	return days;
}

function DayTitle({ date }: { date: string }) {
	const { t } = useTranslation();
	const heading = dayHeading(date);

	if (heading.kind === "date") {
		return <>{heading.text}</>;
	}

	return <>{t(`transactions.days.${heading.kind}`)}</>;
}

/**
 * Transactions, most recent first, under a header per day. `j` / `k` and the
 * arrows move between rows, `e` or `Enter` opens one.
 */
export function TransactionList({ items, onOpen, showAccount = false }: TransactionListProps) {
	const { t } = useTranslation();
	const container = useRef<HTMLDivElement>(null);

	useListNavigation(container);

	return (
		<div ref={container} className="flex flex-col gap-4">
			{groupByDay(items).map((day) => {
				const headingId = `day-${day.date}`;

				return (
					<section key={day.date} aria-labelledby={headingId}>
						<h3 id={headingId} className="border-b pb-1 text-xs font-medium text-muted-foreground">
							<DayTitle date={day.date} />
						</h3>
						<ul>
							{day.items.map((item) => (
								<li key={item.id}>
									<button
										type="button"
										// Lets the sheet give focus back to this row after an edit
										// moved it under another day, which remounts it.
										data-transaction-id={item.id}
										onClick={() => onOpen(item)}
										className="flex min-h-9 w-full items-center justify-between gap-4 rounded-md px-2 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span className="min-w-0 flex-1 truncate" title={item.label}>
											{item.label}
										</span>
										{showAccount && (
											<span
												className="w-40 shrink-0 truncate text-xs text-muted-foreground max-md:w-24"
												title={item.accountName}
											>
												{item.accountName}
											</span>
										)}
										<span className="flex shrink-0 items-center gap-1.5">
											{item.excluded && <ExcludedMarker label={t("transactions.excluded")} />}
											<Money
												amount={item.amount}
												currency={item.currency}
												signed
												muted={item.excluded}
											/>
										</span>
									</button>
								</li>
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}

export function TransactionListSkeleton() {
	return (
		<div className="flex flex-col gap-2" aria-hidden="true">
			<Skeleton className="h-4 w-32" />
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-4 w-32" />
			<Skeleton className="h-9 w-full" />
		</div>
	);
}
