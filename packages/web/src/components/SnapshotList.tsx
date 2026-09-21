import type { SnapshotData } from "@/hooks/useSnapshots";

import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatSignedMoney, formatTableDate } from "@/lib/balance-change";

type SnapshotListProps = {
	items: readonly SnapshotData[];
	onOpen: (snapshot: SnapshotData) => void;
};

/**
 * One account's snapshots, most recent first: the balance typed, the balance
 * the transactions alone give for that day, and the gap between them.
 */
export function SnapshotList({ items, onOpen }: SnapshotListProps) {
	const { t } = useTranslation();

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead scope="col">{t("snapshots.columns.date")}</TableHead>
					<TableHead scope="col" className="text-right">
						{t("snapshots.columns.balance")}
					</TableHead>
					<TableHead scope="col" className="text-right">
						{t("snapshots.columns.computed")}
					</TableHead>
					<TableHead scope="col" className="text-right">
						{t("snapshots.columns.gap")}
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{items.map((item) => (
					// `relative` so the date button's overlay covers the whole row: a
					// click anywhere opens it, and the keyboard reaches one button.
					<TableRow key={item.id} className="relative h-9">
						<TableCell>
							<button
								type="button"
								data-snapshot-id={item.id}
								onClick={() => onOpen(item)}
								className="rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
							>
								{formatTableDate(item.date)}
							</button>
						</TableCell>
						<TableCell className="text-right">
							<Money amount={item.balance} currency={item.currency} />
						</TableCell>
						<TableCell className="text-right">
							<Money amount={item.computed} currency={item.currency} />
						</TableCell>
						<TableCell className="text-right">
							{item.gap === 0 ? (
								<>
									<span aria-hidden="true">—</span>
									<span className="sr-only">{t("snapshots.noGap")}</span>
								</>
							) : (
								// Signed but uncoloured, like the chart's change: which side is
								// higher matters, but a gap is neither income nor expense.
								<span className="font-medium whitespace-nowrap tabular-nums">
									{formatSignedMoney(item.gap, item.currency)}
								</span>
							)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

export function SnapshotListSkeleton() {
	return (
		<div className="flex flex-col gap-2" aria-hidden="true">
			{[0, 1, 2].map((row) => (
				<Skeleton key={row} className="h-9 w-full" />
			))}
		</div>
	);
}
