import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useDeleteAccount } from "@/hooks/useAccounts";
import { useAccountTransactions } from "@/hooks/useTransactions";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

const countFormat = new Intl.NumberFormat("fr-FR");

type DeleteAccountDialogProps = {
	account: { id: string; name: string };
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * The confirmation both account menus open before deleting an unlinked
 * account: it states how many transactions go with it. The count is the
 * first page's total, the one the Opérations tab reads, and is asked only
 * while the dialog is open, so a list of rows sends no request per row.
 */
export function DeleteAccountDialog({ account, open, onOpenChange }: DeleteAccountDialogProps) {
	const { t } = useTranslation();
	const deleteAccount = useDeleteAccount(account.id);
	// Not once deleting: the hook removes the account's queries, and asking
	// again would fail with NOT_FOUND.
	const transactions = useAccountTransactions(account.id, 1, {
		enabled: open && !deleteAccount.isPending && !deleteAccount.isSuccess,
	});
	const count = transactions.isPlaceholderData ? undefined : transactions.data?.total;
	// Only an error since this opening counts: an older one is asked again first.
	const [openedAt, setOpenedAt] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);

	if (open !== wasOpen) {
		setWasOpen(open);

		if (open) {
			setOpenedAt(Date.now());
		}
	}

	const failed = open && transactions.isError && transactions.errorUpdatedAt >= openedAt;
	const title =
		count === 0
			? t("accountActions.delete.titleEmpty", { name: account.name })
			: t("accountActions.delete.title", {
					name: account.name,
					count: count ?? 0,
					formatted: countFormat.format(count ?? 0),
				});

	// The query cache already toasts the error; the request is given up.
	useEffect(() => {
		if (failed) {
			onOpenChange(false);
		}
	}, [failed, onOpenChange]);

	// The hook leaves for `/accounts` itself, which closes the dialog with the
	// account page, and removes the row on the accounts page.
	const remove = async () => {
		try {
			await deleteAccount.mutateAsync();
			toast.success(t("accountActions.delete.deleted", { name: account.name }));
			onOpenChange(false);
		} catch (error) {
			showErrorToast(errorCodeOf(error));
		}
	};

	return (
		<ConfirmDialog
			// Shown once the count is known, so its title never states a wrong one.
			open={open && count !== undefined}
			onOpenChange={onOpenChange}
			title={title}
			description={t("accountActions.delete.description")}
			confirmLabel={t("accountActions.delete.action")}
			destructive
			pending={deleteAccount.isPending}
			onConfirm={() => void remove()}
		/>
	);
}
