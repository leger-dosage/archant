import type { AssetOverviewData } from "@/hooks/useAccountOverview";
import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import type {
	AreaUnit,
	MileageUnit,
	PropertyDetails,
	VehicleDetails,
} from "@archant/data/account-types";

import { Money } from "@/components/Money";
import { SummaryCard } from "@/components/SummaryCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMeasurement } from "@/lib/asset-details";
import { formatSignedMoney, formatSignedPercent } from "@/lib/balance-change";
import { cn } from "@/lib/utils";

type AssetOverviewProps = {
	overview: AssetOverviewData;
	/** The property's details, null for one saved before it had any or for a vehicle. */
	property: PropertyDetails | null;
	/** The vehicle's details, null for one saved before it had any or for a property. */
	vehicle: VehicleDetails | null;
	/** `null` for a viewer, who changes nothing: the button is left out. */
	onEdit: (() => void) | null;
};

/**
 * Sure's `properties/tabs/_overview` and `vehicles/tabs/_overview`: the
 * value, what was paid and the trend between them, then the details. A
 * detail nobody gave reads « Inconnu ».
 */
export function AssetOverview({ overview, property, vehicle, onEdit }: AssetOverviewProps) {
	const { t } = useTranslation();
	const { currency } = overview;
	const unknown = t("assetOverview.unknown");
	const measurement = (
		value: number | null | undefined,
		unit: AreaUnit | MileageUnit | undefined,
	) =>
		value === null || value === undefined || unit === undefined
			? unknown
			: t("assetOverview.measurement", {
					value: formatMeasurement(value),
					unit: t(`assetOverview.units.${unit}`),
				});
	const purchasePrice = <Money amount={overview.purchasePrice} currency={currency} />;
	const balance = <Money amount={overview.balance} currency={currency} />;
	const trend = <Trend trend={overview.trend} currency={currency} />;
	const makeModel = [vehicle?.make, vehicle?.model].filter(Boolean).join(" ");
	const cells: { label: string; value: ReactNode }[] =
		overview.kind === "property"
			? [
					{ label: t("assetOverview.marketValue"), value: balance },
					{ label: t("assetOverview.purchasePrice"), value: purchasePrice },
					{ label: t("assetOverview.trend"), value: trend },
					{
						label: t("assetOverview.yearBuilt"),
						value: property?.yearBuilt ?? unknown,
					},
					{
						label: t("assetOverview.livingArea"),
						value: measurement(property?.areaValue, property?.areaUnit),
					},
				]
			: [
					{ label: t("assetOverview.makeModel"), value: makeModel === "" ? unknown : makeModel },
					{ label: t("assetOverview.year"), value: vehicle?.year ?? unknown },
					{
						label: t("assetOverview.mileage"),
						value: measurement(vehicle?.mileageValue, vehicle?.mileageUnit),
					},
					{ label: t("assetOverview.purchasePrice"), value: purchasePrice },
					{ label: t("assetOverview.currentPrice"), value: balance },
					{ label: t("assetOverview.trend"), value: trend },
				];

	return (
		<div className="flex flex-col gap-4">
			{/* Sure's `grid-cols-3`; two columns on a phone, where three 20 px amounts overflow (WCAG 1.4.10). */}
			<div className="grid grid-cols-2 gap-2 md:grid-cols-3">
				{cells.map((cell) => (
					<SummaryCard key={cell.label} title={cell.label}>
						{cell.value}
					</SummaryCard>
				))}
			</div>

			{onEdit !== null && (
				<div className="flex justify-center py-8">
					<Button variant="ghost" onClick={onEdit}>
						{t("assetOverview.edit")}
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * Sure's `Trend`: the change and its percentage, green up, red down, muted
 * flat. Green is the income colour, which keeps 4.5:1 on a card where
 * `--trend-up` does not; the sign says the direction without the colour.
 */
function Trend({ trend, currency }: { trend: AssetOverviewData["trend"]; currency: string }) {
	return (
		<span
			className={cn(
				"flex flex-wrap items-baseline gap-x-1 tabular-nums",
				trend.amount > 0
					? "text-money-income"
					: trend.amount < 0
						? "text-destructive"
						: "text-muted-foreground",
			)}
		>
			<span className="whitespace-nowrap">{formatSignedMoney(trend.amount, currency)}</span>
			{trend.percent !== null && (
				<span className="text-sm font-normal whitespace-nowrap">
					({formatSignedPercent(trend.percent)})
				</span>
			)}
		</span>
	);
}

/** The card grid's shape while the overview loads: five cards for a property, six for a vehicle. */
export function AssetOverviewSkeleton({ cards }: { cards: number }) {
	return (
		<div className="grid grid-cols-2 gap-2 md:grid-cols-3" aria-hidden="true">
			{Array.from({ length: cards }, (_, index) => (
				<Skeleton key={index} className="h-20 w-full" />
			))}
		</div>
	);
}
