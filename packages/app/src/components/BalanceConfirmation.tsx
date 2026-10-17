import { useTranslation } from "react-i18next";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { formatMoney, toMinorUnits } from "@archant/data/money";

import { longDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** What the dry run answers: Sure's `new_balance` and `new_cash_balance`. */
export type BalanceDryRun = { date: string; balance: MinorUnits; cash: MinorUnits | null };

// The noun of Sure's `_confirmation_contents`, per account type.
const NOUN_KEYS = {
	depository: "snapshots.confirm.nouns.depository",
	credit_card: "snapshots.confirm.nouns.credit_card",
	loan: "snapshots.confirm.nouns.loan",
	property: "snapshots.confirm.nouns.property",
	vehicle: "snapshots.confirm.nouns.vehicle",
	crypto: "snapshots.confirm.nouns.crypto",
	other_asset: "snapshots.confirm.nouns.other_asset",
	other_liability: "snapshots.confirm.nouns.other_liability",
} as const satisfies Record<Exclude<AccountType, "investment">, string>;

type BalanceConfirmationProps = {
	type: AccountType;
	currency: string;
	result: BalanceDryRun;
	/** Sure's `is_update`: « Mettre à jour » and « ce changement » rather than « Définir » and « cette mise à jour ». */
	update: boolean;
};

/**
 * Sure's `valuations/_confirmation_contents`: the balance a reconciliation
 * sets on its date, an investment account's total split into its holdings and
 * its brokerage cash, and the warning that every later balance is recomputed.
 */
export function BalanceConfirmation({ type, currency, result, update }: BalanceConfirmationProps) {
	const { t } = useTranslation();
	const date = <span className="font-medium text-foreground">{longDate(result.date)}</span>;
	const money = (amount: MinorUnits) => formatMoney({ amount, currency });

	if (type === "investment") {
		// Sure's `new_cash_balance || 0`: without a row on the date, the whole
		// value reads as holdings.
		const cash = result.cash ?? toMinorUnits(0);
		const holdings = toMinorUnits(result.balance - cash);

		return (
			<div className="flex flex-col gap-4 text-sm text-muted-foreground">
				<p>
					{t(update ? "snapshots.confirm.thisWillUpdate" : "snapshots.confirm.thisWillSet")} {date}{" "}
					{t("snapshots.confirm.toColon")}
				</p>
				<dl className="flex flex-col gap-2 rounded-lg border bg-card p-4">
					<div className="flex justify-between gap-4">
						<dt>{t("snapshots.confirm.totalValue")}</dt>
						<dd className="font-medium text-foreground tabular-nums">{money(result.balance)}</dd>
					</div>
					<div className="flex justify-between gap-4 text-xs">
						<dt>{t("snapshots.confirm.holdingsValue")}</dt>
						<dd className="tabular-nums">{money(holdings)}</dd>
					</div>
					<div className="flex justify-between gap-4 text-xs">
						<dt>{t("snapshots.confirm.brokerageCash")}</dt>
						<dd
							className={cn("tabular-nums", cash < 0 ? "text-money-expense" : "text-money-income")}
						>
							{money(cash)}
						</dd>
					</div>
				</dl>
				<p>{t(update ? "snapshots.confirm.noticeUpdate" : "snapshots.confirm.noticeSet")}</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 text-sm text-muted-foreground">
			<p>
				{t(update ? "snapshots.confirm.update" : "snapshots.confirm.set")} {t(NOUN_KEYS[type])}{" "}
				{t("snapshots.confirm.on")} {date} {t("snapshots.confirm.to")}{" "}
				<span className="font-medium whitespace-nowrap text-foreground">
					{money(result.balance)}
				</span>
				.
			</p>
			<p>{t(update ? "snapshots.confirm.noticeUpdate" : "snapshots.confirm.noticeSet")}</p>
		</div>
	);
}
