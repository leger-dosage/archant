import type { SnapshotData } from "@/hooks/useSnapshots";

import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";

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

/** The account's opening balance, the list's oldest row. */
export type OpeningRow = { date: string; balance: MinorUnits; currency: string };

type SnapshotListProps = {
	items: readonly SnapshotData[];
	/** `null` for a viewer: a row opens the form that edits it, which they cannot use. */
	onOpen: ((snapshot: SnapshotData) => void) | null;
	/** Shown below the snapshots, on the last page only; `null` elsewhere. */
	opening: OpeningRow | null;
	/**
	 * `null` for a viewer and on a linked account, whose balances derive from
	 * the bank's and ignore the opening amount: the row opens nothing.
	 */
	onOpenOpening: (() => void) | null;
};

/**
 * One account's snapshots, most recent first: the balance typed, the balance
 * the transactions alone give for that day, and the gap between them. The
 * opening balance comes last, as Sure lists its opening anchor among the
 * valuations: it starts the balances, so nothing is computed against it.
 */
export function SnapshotList({ items, onOpen, opening, onOpenOpening }: SnapshotListProps) {
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
							{onOpen === null ? (
								formatTableDate(item.date)
							) : (
								<button
									type="button"
									data-snapshot-id={item.id}
									onClick={() => onOpen(item)}
									className="rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
								>
									{formatTableDate(item.date)}
								</button>
							)}
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
				{opening !== null && (
					<TableRow className="relative h-9">
						<TableCell>
							{onOpenOpening === null ? (
								<OpeningLabel date={opening.date} />
							) : (
								<button
									type="button"
									data-opening-balance=""
									onClick={onOpenOpening}
									// 28 px, the floor of a control: a line of text alone is 20 px.
									className="inline-flex min-h-7 items-center rounded-sm text-left outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
								>
									<OpeningLabel date={opening.date} />
								</button>
							)}
						</TableCell>
						<TableCell className="text-right">
							<Money amount={opening.balance} currency={opening.currency} />
						</TableCell>
						<TableCell className="text-right">
							<span aria-hidden="true">—</span>
						</TableCell>
						<TableCell className="text-right">
							<span aria-hidden="true">—</span>
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
}

function OpeningLabel({ date }: { date: string }) {
	const { t } = useTranslation();

	return (
		<span className="flex flex-wrap items-baseline gap-x-2">
			<span>{formatTableDate(date)}</span>
			<span className="text-xs text-muted-foreground">{t("snapshots.opening.label")}</span>
		</span>
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
