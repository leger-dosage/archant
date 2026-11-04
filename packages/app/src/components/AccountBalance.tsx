import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";

import { ExcludedMarker } from "@/components/ExcludedMarker";
import { Money } from "@/components/Money";

type AccountBalanceProps = {
	account: { balance: MinorUnits; currency: string; excludedFromReports: boolean };
	/** Rounded to the whole unit, as `Money`'s. */
	whole?: boolean;
	className?: string;
};

/** An account's balance in a list: muted with the eye-off icon when left out of reports. */
export function AccountBalance({ account, whole = false, className }: AccountBalanceProps) {
	const { t } = useTranslation();

	return (
		<span className="flex shrink-0 items-center gap-1.5">
			{account.excludedFromReports && <ExcludedMarker label={t("accounts.excludedFromReports")} />}
			<Money
				amount={account.balance}
				currency={account.currency}
				muted={account.excludedFromReports}
				whole={whole}
				{...(className === undefined ? {} : { className })}
			/>
		</span>
	);
}
