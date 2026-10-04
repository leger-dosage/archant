import type { TradeData } from "@/hooks/useTrades";

import { useTranslation } from "react-i18next";

import { isIncomeSide } from "@archant/api/schemas/trades";

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
import { formatTableDate } from "@/lib/balance-change";
import { formatPrice, formatQuantity } from "@/lib/trade-format";

type TradeListProps = {
	items: readonly TradeData[];
	/** `null` for a viewer: a row opens the form that edits it, which they cannot use. */
	onOpen: ((trade: TradeData) => void) | null;
};

/**
 * One account's trades, most recent first: the date, the type, the security
 * or « Liquidités », the quantity at its unit price for a buy or a sale, and
 * the cash the trade moved.
 */
export function TradeList({ items, onOpen }: TradeListProps) {
	const { t } = useTranslation();

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead scope="col">{t("trades.columns.date")}</TableHead>
					<TableHead scope="col">{t("trades.columns.side")}</TableHead>
					<TableHead scope="col">{t("trades.columns.security")}</TableHead>
					<TableHead scope="col" className="text-right">
						{t("trades.columns.quantityPrice")}
					</TableHead>
					<TableHead scope="col" className="text-right">
						{t("trades.columns.amount")}
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
									data-trade-id={item.id}
									onClick={() => onOpen(item)}
									className="rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
								>
									{formatTableDate(item.date)}
								</button>
							)}
						</TableCell>
						<TableCell>{t(`trades.sides.${item.side}`)}</TableCell>
						<TableCell className="max-w-64">
							{item.security === null ? (
								t("trades.cash")
							) : (
								<span className="flex min-w-0 flex-col">
									<span className="truncate">{item.security.name}</span>
									{(item.security.ticker ?? item.security.isin) !== null && (
										<span className="truncate text-xs text-muted-foreground">
											{item.security.ticker ?? item.security.isin}
										</span>
									)}
								</span>
							)}
						</TableCell>
						<TableCell className="text-right whitespace-nowrap tabular-nums">
							{/* An income moves cash only: no quantity, no price. */}
							{!isIncomeSide(item.side) &&
								t("trades.quantityPrice", {
									quantity: formatQuantity(item.quantity),
									price: formatPrice(item.price, item.currency),
								})}
						</TableCell>
						<TableCell className="text-right">
							<Money amount={item.amount} currency={item.currency} signed />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

export function TradeListSkeleton() {
	return (
		<div className="flex flex-col gap-2" aria-hidden="true">
			{[0, 1, 2].map((row) => (
				<Skeleton key={row} className="h-9 w-full" />
			))}
		</div>
	);
}
