import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";

import { ExcludedMarker } from "@/components/ExcludedMarker";
import { Money } from "@/components/Money";

type AccountBalanceProps = {
	account: { balance: MinorUnits; currency: string; excludedFromReports: boolean };
	className?: string;
};

/** An account's balance in a list: muted with the eye-off icon when left out of reports. */
export function AccountBalance({ account, className }: AccountBalanceProps) {
	const { t } = useTranslation();

	return (
		<span className="flex shrink-0 items-center gap-1.5">
			{account.excludedFromReports && <ExcludedMarker label={t("accounts.excludedFromReports")} />}
			<Money
				amount={account.balance}
				currency={account.currency}
				muted={account.excludedFromReports}
				{...(className === undefined ? {} : { className })}
			/>
		</span>
	);
}
