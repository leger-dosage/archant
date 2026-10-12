import type { TransactionData } from "@/hooks/useTransactions";

import { ChevronDownIcon, LockIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useUnlockTransaction } from "@/hooks/useTransactions";
import { errorCodeOf } from "@/lib/api";
import { longDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { listedLocks } from "@/lib/locked-fields";

/**
 * Sure's `entries/_protection_indicator`, folded until asked for: the locked
 * fields with the day each was locked, and for an administrator the unlock
 * that lets the next sync or rule update every one of them again.
 */
export function ProtectionBlock({
	transaction,
	onUnlocked,
}: {
	transaction: TransactionData;
	onUnlocked: () => void;
}) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const unlock = useUnlockTransaction();
	const [confirming, setConfirming] = useState(false);
	const locks = listedLocks(transaction.lockedFields);

	const confirm = () =>
		unlock.mutate(transaction.id, {
			onSuccess: () => {
				setConfirming(false);
				toast.success(t("transactions.protection.unlocked"));
				onUnlocked();
			},
			onError: (error) => {
				setConfirming(false);
				showErrorToast(errorCodeOf(error));
			},
		});

	return (
		<details className="group rounded-lg bg-muted/50 px-3 py-2">
			<summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
				<span className="flex items-center gap-2">
					<LockIcon aria-hidden="true" className="size-4 text-muted-foreground" />
					{t("transactions.protection.title")}
				</span>
				<ChevronDownIcon
					aria-hidden="true"
					className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
				/>
			</summary>
			<div className="mt-3 flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">{t("transactions.protection.description")}</p>
				<div className="flex flex-col gap-1.5">
					<p className="text-xs font-medium text-muted-foreground">
						{t("transactions.protection.lockedFields")}
					</p>
					<ul className="flex flex-col gap-1">
						{locks.map(({ field, name, day }) => (
							<li key={field} className="flex justify-between gap-2 text-sm">
								<span>{t(name)}</span>
								{day !== null && <span className="text-muted-foreground">{longDate(day)}</span>}
							</li>
						))}
					</ul>
				</div>
				{admin && (
					<>
						<Button
							type="button"
							variant="outline"
							className="w-full"
							disabled={unlock.isPending}
							onClick={() => setConfirming(true)}
						>
							{t("transactions.protection.unlock")}
						</Button>
						<ConfirmDialog
							open={confirming}
							onOpenChange={setConfirming}
							title={t("transactions.protection.confirmTitle")}
							description={t("transactions.protection.confirmDescription")}
							confirmLabel={t("transactions.protection.confirm")}
							onConfirm={confirm}
							pending={unlock.isPending}
						/>
					</>
				)}
			</div>
		</details>
	);
}

/**
 * The lock beside a protected row's amount, as Sure's `_transaction`: shown
 * on hover and focus only. The row opens the sheet; the icon is no control.
 */
export function ProtectionMarker({ label }: { label: string }) {
	return (
		<span
			title={label}
			className="inline-flex text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
		>
			<LockIcon className="size-3.5" aria-hidden="true" />
			<span className="sr-only">{label}</span>
		</span>
	);
}
