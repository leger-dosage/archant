import type { RecurringData } from "@/hooks/useRecurring";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatMoney, toMinorUnits } from "@archant/data/money";

import { GROUP_TABLE_INSET, InsetGroup } from "@/components/InsetGroup";
import { ListCard } from "@/components/ListCard";
import { Money } from "@/components/Money";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { recurringName, useSetRecurringStatus } from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { cn } from "@/lib/utils";

const nameOf = recurringName;

/**
 * The amount, or the band it moved within once it varies, magnitudes
 * ascending: Sure's « varie de 571,22 € à 571,36 € ».
 */
export function RecurringAmount({ item }: { item: RecurringData }) {
	const { t } = useTranslation();
	const { expectedAmountMin: min, expectedAmountMax: max } = item;

	if (min === null || max === null || min === max) {
		return <Money amount={item.amount} currency={item.currency} signed />;
	}

	const [low, high] = [Math.abs(min), Math.abs(max)].toSorted((a, b) => a - b);
	// The single amount's convention: an inflow takes a plus sign and the income colour.
	const inflow = item.amount > 0;
	const format = (amount: number) =>
		`${inflow ? "+" : ""}${formatMoney({ amount: toMinorUnits(amount), currency: item.currency })}`;

	return (
		<span
			className={cn(
				"font-medium whitespace-nowrap tabular-nums",
				inflow ? "text-money-income" : "text-money-expense",
			)}
		>
			{t("recurring.amountRange", { min: format(low!), max: format(high!) })}
		</span>
	);
}

/**
 * Sure's « Nouvelles factures possibles »: what detection found and the owner
 * has not settled, each with how often it was seen. A viewer reads it without
 * its two buttons.
 */
export function RecurringSuggestions({
	items,
	admin,
}: {
	items: readonly RecurringData[];
	admin: boolean;
}) {
	const { t } = useTranslation();
	const setStatus = useSetRecurringStatus();

	const settle = (item: RecurringData, status: "active" | "ended") =>
		setStatus.mutate(
			{ id: item.id, status },
			{
				onSuccess: () =>
					toast.success(
						t(status === "active" ? "recurring.suggested.added" : "recurring.suggested.dismissed"),
					),
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);

	return (
		<ListCard>
			<InsetGroup level={2} title={t("recurring.suggested.title")} count={items.length}>
				<Table aria-label={t("recurring.suggested.title")} className={GROUP_TABLE_INSET}>
					<TableHeader>
						<TableRow className="border-line hover:bg-transparent">
							<TableHead scope="col" className="type-overline text-muted-foreground">
								{t("recurring.columns.name")}
							</TableHead>
							<TableHead scope="col" className="type-overline text-right text-muted-foreground">
								{t("recurring.columns.amount")}
							</TableHead>
							{admin && (
								<TableHead scope="col">
									<span className="sr-only">{t("recurring.columns.actions")}</span>
								</TableHead>
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.map((item) => (
							<TableRow key={item.id} className="h-14 border-line hover:bg-hover">
								<TableCell className="w-full max-w-0">
									<span className="flex min-w-0 items-center gap-3">
										<TintedIcon subject={{ kind: "merchant", name: nameOf(item) }} size="md" />
										{/* Under the name, as Sure's `_suggested_series`: a column of its own
										    pushed « Ajouter la facture » out of the card at 1280 px. */}
										<span className="flex min-w-0 flex-col">
											<span className="truncate font-medium">{nameOf(item)}</span>
											<span className="truncate text-xs text-muted-foreground">
												{t("recurring.suggested.seen", { count: item.occurrenceCount })}
											</span>
										</span>
									</span>
								</TableCell>
								<TableCell className="text-right">
									<RecurringAmount item={item} />
								</TableCell>
								{admin && (
									<TableCell className="text-right">
										<span className="flex justify-end gap-2">
											<Button
												variant="outline"
												size="sm"
												disabled={setStatus.isPending}
												onClick={() => settle(item, "ended")}
											>
												{t("recurring.suggested.dismiss")}
											</Button>
											<Button
												size="sm"
												disabled={setStatus.isPending}
												onClick={() => settle(item, "active")}
											>
												{t("recurring.suggested.confirm")}
											</Button>
										</span>
									</TableCell>
								)}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</InsetGroup>
		</ListCard>
	);
}
