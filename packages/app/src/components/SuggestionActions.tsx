import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirmPayment, useRejectPayment } from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { settle } from "@/lib/settle";
import { cn } from "@/lib/utils";

const failed = (error: unknown) => showErrorToast(errorCodeOf(error));

/**
 * « Appliquer » and « Pas cette facture » for a suggested payment, in the
 * review queue and in the occurrence's sheet. Their row goes once either
 * answers, so the toast waits on `settle`, never on `mutate`'s callbacks.
 */
export function SuggestionActions({
	paymentId,
	className,
}: {
	paymentId: string;
	className?: string;
}) {
	const { t } = useTranslation();
	const confirm = useConfirmPayment();
	const reject = useRejectPayment();
	const pending = confirm.isPending || reject.isPending;

	return (
		<span className={cn("flex gap-2", className)}>
			<Button
				size="sm"
				disabled={pending}
				onClick={() =>
					void settle(
						confirm.mutateAsync(paymentId),
						() => toast.success(t("bills.review.applied")),
						failed,
					)
				}
			>
				{t("bills.review.apply")}
			</Button>
			<Button
				size="sm"
				variant="ghost"
				disabled={pending}
				onClick={() =>
					void settle(
						reject.mutateAsync(paymentId),
						() => toast.success(t("bills.review.rejected")),
						failed,
					)
				}
			>
				{t("bills.review.reject")}
			</Button>
		</span>
	);
}
