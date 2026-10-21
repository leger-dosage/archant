import { ArrowRightLeftIcon, CircleMinusIcon, CirclePlusIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

/** What the new-transaction sheet records. */
export type TransactionType = "expense" | "income" | "transfer";

const TYPES = [
	{ type: "expense", Icon: CircleMinusIcon },
	{ type: "income", Icon: CirclePlusIcon },
	{ type: "transfer", Icon: ArrowRightLeftIcon },
] as const;

/**
 * « Dépense », « Revenu » and « Virement » at the top of a new transaction,
 * as Sure's `shared/transaction_type_tabs`: the first two set the amount's
 * sign, the third swaps in the transfer form.
 */
export function TransactionTypeTabs({
	value,
	onChange,
}: {
	value: TransactionType;
	onChange: (type: TransactionType) => void;
}) {
	const { t } = useTranslation();

	return (
		<div
			role="group"
			aria-label={t("transfers.form.type")}
			className="flex shrink-0 rounded-md border p-0.5"
		>
			{TYPES.map(({ type, Icon }) => (
				<Button
					key={type}
					type="button"
					size="sm"
					className="min-w-0 flex-1"
					variant={value === type ? "secondary" : "ghost"}
					aria-pressed={value === type}
					onClick={() => onChange(type)}
				>
					<Icon aria-hidden="true" />
					<span className="truncate">{t(`transactions.form.${type}`)}</span>
				</Button>
			))}
		</div>
	);
}
