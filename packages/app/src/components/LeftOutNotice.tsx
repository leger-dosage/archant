import { useTranslation } from "react-i18next";

const listFormat = new Intl.ListFormat("fr");

/**
 * The accounts a total leaves out because no rate converts their currency,
 * by name (NFR2). Nothing when none is left out.
 */
export function LeftOutNotice({ accounts }: { accounts: readonly { name: string }[] }) {
	const { t } = useTranslation();

	if (accounts.length === 0) {
		return null;
	}

	return (
		<p className="text-xs text-muted-foreground">
			{t("dashboard.leftOut", {
				names: listFormat.format(accounts.map((account) => account.name)),
			})}
		</p>
	);
}
