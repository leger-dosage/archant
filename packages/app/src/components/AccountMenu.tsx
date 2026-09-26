import type { AccountDetailData } from "@/hooks/useAccount";

import { Link } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EditAccountDialog } from "@/components/EditAccountDialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeleteAccount, useUpdateAccount } from "@/hooks/useAccounts";
import { useAccountTransactions } from "@/hooks/useTransactions";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

const countFormat = new Intl.NumberFormat("fr-FR");

function toastError(error: unknown) {
	showErrorToast(error instanceof ApiError ? error.code : "INTERNAL_ERROR");
}

/**
 * The « … » menu beside an account's name, as Sure's `accounts/show/_menu`:
 * every action on the account itself. A linked account cannot be deleted
 * until its bank is disconnected, so its menu leads to the connection instead.
 */
export function AccountMenu({ account }: { account: AccountDetailData }) {
	const { t } = useTranslation();
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const updateAccount = useUpdateAccount(account.id);
	const deleteAccount = useDeleteAccount(account.id);
	// The same first page the Opérations tab reads: its total is the count.
	const transactions = useAccountTransactions(account.id, 1);
	const count = transactions.isPlaceholderData ? undefined : transactions.data?.total;
	const title =
		count === 0
			? t("accountActions.delete.titleEmpty", { name: account.name })
			: t("accountActions.delete.title", {
					name: account.name,
					count: count ?? 0,
					formatted: countFormat.format(count ?? 0),
				});

	// No confirmation for either: nothing is lost, and one click undoes it, as in Sure.
	const toggleExcluded = async () => {
		try {
			const saved = await updateAccount.mutateAsync({
				excludedFromReports: !account.excludedFromReports,
			});
			toast.success(
				t(saved.excludedFromReports ? "accountActions.excluded" : "accountActions.included", {
					name: saved.name,
				}),
			);
		} catch (error) {
			toastError(error);
		}
	};

	const toggleActive = async () => {
		try {
			const saved = await updateAccount.mutateAsync({ active: !account.active });
			toast.success(
				t(saved.active ? "accountActions.reactivated" : "accountActions.deactivated", {
					name: saved.name,
				}),
			);
		} catch (error) {
			toastError(error);
		}
	};

	// The hook leaves for `/accounts` itself, which closes the dialog with the page.
	const remove = async () => {
		try {
			await deleteAccount.mutateAsync();
			toast.success(t("accountActions.delete.deleted", { name: account.name }));
		} catch (error) {
			toastError(error);
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("accountActions.menu", { name: account.name })}
					>
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-auto">
					<DropdownMenuItem onSelect={() => setEditing(true)}>
						{t("accountActions.edit")}
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={updateAccount.isPending}
						onSelect={() => void toggleExcluded()}
					>
						{t(account.excludedFromReports ? "accountActions.include" : "accountActions.exclude")}
					</DropdownMenuItem>
					<DropdownMenuItem disabled={updateAccount.isPending} onSelect={() => void toggleActive()}>
						{t(account.active ? "accountActions.deactivate" : "accountActions.reactivate")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{account.bankConnection === null ? (
						<DropdownMenuItem
							variant="destructive"
							// The confirmation states the count, so it waits for it.
							disabled={count === undefined}
							onSelect={() => setConfirming(true)}
						>
							{t("accountActions.delete.action")}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem asChild>
							<Link
								to="/settings/banks/$connectionId"
								params={{ connectionId: account.bankConnection.id }}
							>
								{t("accountActions.disconnectToDelete", {
									institutionName: account.bankConnection.institutionName,
								})}
							</Link>
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<EditAccountDialog account={account} open={editing} onOpenChange={setEditing} />

			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={title}
				description={t("accountActions.delete.description")}
				confirmLabel={t("accountActions.delete.action")}
				destructive
				pending={deleteAccount.isPending}
				onConfirm={() => void remove()}
			/>
		</>
	);
}
