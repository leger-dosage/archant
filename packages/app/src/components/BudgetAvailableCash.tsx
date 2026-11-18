import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetCash } from "@/hooks/useBudget";
import { errorCodeOf } from "@/lib/api";

export function BudgetAvailableCash() {
	const { t } = useTranslation();
	const cash = useBudgetCash();

	return (
		<Section
			title={t("budgets.availableCash.title")}
			action={
				<Button variant="outline" size="sm" asChild>
					<Link to="/goals">{t("budgets.availableCash.goals")}</Link>
				</Button>
			}
		>
			<div className="flex flex-col gap-3 p-4">
				<p className="text-sm text-muted-foreground">{t("budgets.availableCash.description")}</p>
				{cash.data !== undefined ? (
					<dl className="flex flex-col gap-2">
						<div className="flex flex-wrap items-baseline justify-between gap-x-3">
							<dt className="text-muted-foreground">{t("budgets.availableCash.available")}</dt>
							<dd>
								<Money amount={cash.data.available} currency={cash.data.currency} />
							</dd>
						</div>
						<div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b pb-2 text-muted-foreground">
							<dt>{t("budgets.availableCash.earmarked")}</dt>
							<dd className="whitespace-nowrap">
								{/* A subtraction in the summary, even when the earmark is zero. */}
								−<Money amount={cash.data.earmarked} currency={cash.data.currency} />
							</dd>
						</div>
						<div className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-inset px-2 py-2">
							<dt className="font-medium">{t("budgets.availableCash.free")}</dt>
							<dd>
								<Money amount={cash.data.free} currency={cash.data.currency} className="text-2xl" />
							</dd>
						</div>
					</dl>
				) : cash.isError ? (
					<div role="alert" className="flex flex-wrap items-center gap-2">
						<p className="text-muted-foreground">{t(`errors.${errorCodeOf(cash.error)}`)}</p>
						<Button variant="outline" size="sm" onClick={() => void cash.refetch()}>
							{t("common.retry")}
						</Button>
					</div>
				) : (
					<Skeleton aria-hidden="true" className="h-24 w-full" />
				)}
			</div>
		</Section>
	);
}
