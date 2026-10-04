import type { HoldingsData, PositionData } from "@/hooks/useHoldings";

import { LockIcon } from "lucide-react";
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
import { formatSignedPercent } from "@/lib/balance-change";
import { formatPrice, formatQuantity, formatShare } from "@/lib/trade-format";

type PositionListProps = {
	holdings: HoldingsData;
	onOpen: (position: PositionData) => void;
};

function Share({ percent }: { percent: string | null }) {
	const { t } = useTranslation();

	return <>{percent === null ? t("positions.sheet.none") : formatShare(percent)}</>;
}

/**
 * Sure's holdings table: each security held, by value, with its weight, its
 * « PRU », its value and quantity and its unrealised gain, then the cash. A
 * row opens the position's sheet, for a viewer too: its figures are theirs
 * to read.
 */
export function PositionList({ holdings, onOpen }: PositionListProps) {
	const { t } = useTranslation();
	const { currency } = holdings;

	return (
		<Table aria-label={t("positions.label")}>
			<TableHeader>
				<TableRow>
					<TableHead scope="col">{t("positions.columns.security")}</TableHead>
					<TableHead scope="col" className="text-right">
						{t("positions.columns.weight")}
					</TableHead>
					<TableHead scope="col" className="text-right">
						{t("positions.columns.costBasis")}
					</TableHead>
					<TableHead scope="col" className="text-right">
						{t("positions.columns.value")}
					</TableHead>
					<TableHead scope="col" className="text-right">
						{t("positions.columns.gain")}
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{holdings.positions.map((position) => (
					// `relative` so the name button's overlay covers the whole row.
					<TableRow key={position.security.id} className="relative">
						<TableCell className="max-w-64">
							<button
								type="button"
								data-security-id={position.security.id}
								onClick={() => onOpen(position)}
								className="flex min-w-0 flex-col items-start rounded-sm text-left outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
							>
								<span className="max-w-full truncate">{position.security.name}</span>
								{(position.security.ticker ?? position.security.isin) !== null && (
									<span className="max-w-full truncate text-xs text-muted-foreground">
										{position.security.ticker ?? position.security.isin}
									</span>
								)}
							</button>
						</TableCell>
						<TableCell className="text-right tabular-nums">
							<Share percent={position.weight} />
						</TableCell>
						<TableCell className="text-right whitespace-nowrap tabular-nums">
							{position.costBasis === null ? (
								t("positions.sheet.none")
							) : (
								<span className="inline-flex items-center gap-1">
									{position.costBasisLocked && (
										<LockIcon
											role="img"
											aria-label={t("positions.locked")}
											className="size-3 text-muted-foreground"
										/>
									)}
									{formatPrice(position.costBasis, currency)}
								</span>
							)}
						</TableCell>
						<TableCell className="text-right">
							<span className="flex flex-col items-end">
								<Money amount={position.amount} currency={currency} />
								<span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
									{t("trades.quantityPrice", {
										quantity: formatQuantity(position.quantity),
										price: formatPrice(position.price, currency),
									})}
								</span>
							</span>
						</TableCell>
						<TableCell className="text-right">
							{position.gain === null ? (
								t("positions.sheet.none")
							) : (
								<span className="flex flex-col items-end">
									<Money amount={position.gain} currency={currency} plusSign />
									{position.gainPercent !== null && (
										<span className="text-xs text-muted-foreground tabular-nums">
											{formatSignedPercent(Number(position.gainPercent))}
										</span>
									)}
								</span>
							)}
						</TableCell>
					</TableRow>
				))}
				<TableRow>
					<TableCell>{t("positions.cash")}</TableCell>
					<TableCell className="text-right tabular-nums">
						<Share percent={holdings.cashWeight} />
					</TableCell>
					<TableCell />
					<TableCell className="text-right">
						<Money amount={holdings.cash} currency={currency} />
					</TableCell>
					<TableCell />
				</TableRow>
			</TableBody>
		</Table>
	);
}

export function PositionListSkeleton() {
	return (
		<div className="flex flex-col gap-2" aria-hidden="true">
			{[0, 1, 2].map((row) => (
				<Skeleton key={row} className="h-12 w-full" />
			))}
		</div>
	);
}
