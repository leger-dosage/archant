import type { AccountSummaryData } from "@/hooks/useAccounts";

import {
	EllipsisVerticalIcon,
	EyeIcon,
	EyeOffIcon,
	PencilLineIcon,
	StarIcon,
	StarOffIcon,
	ToggleLeftIcon,
	ToggleRightIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { eligibleForTransactionDefault } from "@archant/data/account-types";

import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";
import { EditAccountDialog } from "@/components/EditAccountDialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccount } from "@/hooks/useAccount";
import { useRemoveDefaultAccount, useSetDefaultAccount } from "@/hooks/useAccounts";
import { useAccountToggles } from "@/hooks/useAccountToggles";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

/**
 * The menu at the end of an account's row on `/accounts`, as Sure's
 * `accounts/_account`: its items, words, icons and order. Sure's sharing
 * and provider items have no counterpart here yet. The edit
 * dialog's account and the confirmation's count load only once chosen, so
 * the list sends no request per row.
 */
export function AccountRowMenu({
	account,
	isDefault,
}: {
	account: AccountSummaryData;
	/** Whether it is the signed-in user's default account for new transactions. */
	isDefault: boolean;
}) {
	const { t } = useTranslation();
	const trigger = useRef<HTMLButtonElement>(null);
	const [editing, setEditing] = useState(false);
	// Kept once chosen, so the dialog stays mounted through its closing animation.
	const [editMounted, setEditMounted] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const detail = useAccount(account.id, { enabled: editing });
	const toggles = useAccountToggles(account);
	const setDefault = useSetDefaultAccount();
	const removeDefault = useRemoveDefaultAccount();
	const defaultPending = setDefault.isPending || removeDefault.isPending;
	// No toast on success, as Sure's redirect carries no flash.
	const onDefaultError = { onError: (error: unknown) => showErrorToast(errorCodeOf(error)) };
	const [editOpenedAt, setEditOpenedAt] = useState(0);
	// Only an error since this opening counts: an older one is asked again first.
	const editFailed = editing && detail.isError && detail.errorUpdatedAt >= editOpenedAt;

	// A NOT_FOUND here is inline for the account page, so no global toast says it.
	useEffect(() => {
		if (editFailed) {
			showErrorToast(errorCodeOf(detail.error));
			setEditing(false);
		}
	}, [editFailed, detail.error]);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						ref={trigger}
						variant="ghost"
						size="icon"
						className="mr-2 shrink-0"
						aria-label={t("accountActions.menu", { name: account.name })}
					>
						<EllipsisVerticalIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-auto">
					<DropdownMenuItem
						onSelect={() => {
							setEditOpenedAt(Date.now());
							setEditMounted(true);
							setEditing(true);
						}}
					>
						<PencilLineIcon aria-hidden="true" className="size-3.5" />
						{t("accounts.rowMenu.edit")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem disabled={toggles.pending} onSelect={() => void toggles.toggleActive()}>
						{account.active ? (
							<ToggleRightIcon aria-hidden="true" className="size-3.5" />
						) : (
							<ToggleLeftIcon aria-hidden="true" className="size-3.5" />
						)}
						{t(account.active ? "accounts.rowMenu.disable" : "accounts.rowMenu.enable")}
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={toggles.pending}
						onSelect={() => void toggles.toggleExcluded()}
					>
						{account.excludedFromReports ? (
							<EyeIcon aria-hidden="true" className="size-3.5" />
						) : (
							<EyeOffIcon aria-hidden="true" className="size-3.5" />
						)}
						{t(
							account.excludedFromReports
								? "accounts.rowMenu.includeInReports"
								: "accounts.rowMenu.excludeFromReports",
						)}
					</DropdownMenuItem>
					{isDefault ? (
						<DropdownMenuItem
							disabled={defaultPending}
							onSelect={() => removeDefault.mutate(account.id, onDefaultError)}
						>
							<StarOffIcon aria-hidden="true" className="size-3.5" />
							{t("accounts.rowMenu.removeDefault")}
						</DropdownMenuItem>
					) : (
						eligibleForTransactionDefault(account) && (
							<DropdownMenuItem
								disabled={defaultPending}
								onSelect={() => setDefault.mutate(account.id, onDefaultError)}
							>
								<StarIcon aria-hidden="true" className="size-3.5" />
								{t("accounts.rowMenu.setDefault")}
							</DropdownMenuItem>
						)
					)}
					{/* Sure's `!account.linked?`: the server refuses it with ACCOUNT_LINKED. */}
					{!account.linked && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
								<Trash2Icon aria-hidden="true" className="size-3.5" />
								{t("accounts.rowMenu.delete")}
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			{editMounted && detail.data !== undefined && (
				<EditAccountDialog
					account={detail.data}
					open={editing}
					onOpenChange={setEditing}
					returnFocusTo={trigger}
				/>
			)}

			{!account.linked && (
				<DeleteAccountDialog account={account} open={confirming} onOpenChange={setConfirming} />
			)}
		</>
	);
}
