import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ActivityLabel } from "@archant/data/activity-labels";
import { ACTIVITY_LABELS, isActivityLabel } from "@archant/data/activity-labels";

import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useUpdateTransaction } from "@/hooks/useTransactions";
import { ACTIVITY_LABEL_NAMES } from "@/lib/activity-labels";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

// Radix refuses an empty item value, so « — » takes a name no label has.
const NONE = "none";

type ActivityLabelFieldProps = {
	accountId: string;
	transactionId: string;
	value: ActivityLabel | null;
};

/**
 * Sure's « Type d'activité » select of an investment or crypto account's
 * line, saved on its own as soon as it changes, as Sure's `auto-submit-form`,
 * apart from « Enregistrer ». A refusal puts the saved value back.
 */
export function ActivityLabelField({ accountId, transactionId, value }: ActivityLabelFieldProps) {
	const { t } = useTranslation();
	const updateTransaction = useUpdateTransaction(accountId);
	const [saved, setSaved] = useState(value);
	const [shown, setShown] = useState(value);

	const change = async (next: string) => {
		const label = isActivityLabel(next) ? next : null;
		setShown(label);

		try {
			await updateTransaction.mutateAsync({
				id: transactionId,
				input: { investmentActivityLabel: label },
			});
			setSaved(label);
		} catch (error) {
			setShown(saved);
			showErrorToast(error instanceof ApiError ? error.code : "INTERNAL_ERROR");
		}
	};

	return (
		<div className="flex items-center justify-between gap-4">
			<div className="flex flex-col gap-1">
				<Label htmlFor="transaction-activity-label">{t("transactions.form.activityLabel")}</Label>
				<p id="transaction-activity-label-description" className="text-sm text-muted-foreground">
					{t("transactions.form.activityLabelDescription")}
				</p>
			</div>
			<Select
				value={shown ?? NONE}
				onValueChange={(next) => void change(next)}
				disabled={updateTransaction.isPending}
			>
				<SelectTrigger
					id="transaction-activity-label"
					className="w-40 shrink-0"
					aria-describedby="transaction-activity-label-description"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={NONE}>{t("transactions.form.activityLabelNone")}</SelectItem>
					{ACTIVITY_LABELS.map((label) => (
						<SelectItem key={label} value={label}>
							{t(ACTIVITY_LABEL_NAMES[label])}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
