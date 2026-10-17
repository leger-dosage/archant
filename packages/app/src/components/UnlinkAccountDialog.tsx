import { TriangleAlertIcon } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useUnlinkAccount } from "@/hooks/useAccounts";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

/** Sure's `confirm_unlink` warnings, in its order. */
const WARNINGS = ["noSync", "manualUpdates", "transactionsKept", "canDelete"] as const;

type UnlinkAccountDialogProps = {
	account: { id: string; name: string };
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Sure's `accounts/confirm_unlink`: what turning a linked account manual
 * means, then « Confirmer et délier ». As Sure's, it has no cancel button,
 * only its close button. The account stays on `/accounts`, where Sure lands.
 */
export function UnlinkAccountDialog({ account, open, onOpenChange }: UnlinkAccountDialogProps) {
	const { t } = useTranslation();
	const unlink = useUnlinkAccount(account.id);

	const confirm = async () => {
		try {
			await unlink.mutateAsync();
			toast.success(t("accountActions.unlink.unlinked"));
			onOpenChange(false);
		} catch (error) {
			showErrorToast(errorCodeOf(error));
		}
	};

	return (
		<Dialog
			open={open}
			// Held open while the unlink runs, so its outcome lands on the dialog.
			onOpenChange={(next) => {
				if (!unlink.isPending) {
					onOpenChange(next);
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("accountActions.unlink.title")}</DialogTitle>
					<DialogDescription>
						{/* The name self-closing, so it is never parsed as markup; the provider
						written out, where Sure interpolates the raw `enable_banking`. */}
						<Trans
							i18nKey="accountActions.unlink.description"
							components={{
								name: <strong className="font-medium text-foreground">{account.name}</strong>,
								provider: <strong className="font-medium text-foreground" />,
							}}
						/>
					</DialogDescription>
				</DialogHeader>
				{/* Sure's `DS::Alert` `:warning`. */}
				<div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
					<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<div className="flex flex-col gap-1">
						<p className="font-medium">{t("accountActions.unlink.warningTitle")}</p>
						<ul className="list-inside list-disc">
							{WARNINGS.map((warning) => (
								<li key={warning}>{t(`accountActions.unlink.warnings.${warning}`)}</li>
							))}
						</ul>
					</div>
				</div>
				<Button
					type="button"
					className="w-full"
					disabled={unlink.isPending}
					onClick={() => void confirm()}
				>
					{t("accountActions.unlink.confirm")}
				</Button>
			</DialogContent>
		</Dialog>
	);
}
