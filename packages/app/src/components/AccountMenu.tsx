import type { AccountDetailData } from "@/hooks/useAccount";

import { Link } from "@tanstack/react-router";
import {
	CirclePauseIcon,
	CirclePlayIcon,
	EllipsisIcon,
	EyeIcon,
	EyeOffIcon,
	PencilIcon,
	Trash2Icon,
	UnplugIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
import { useAccountToggles } from "@/hooks/useAccountToggles";

/**
 * The « … » menu beside an account's name, as Sure's `accounts/show/_menu`:
 * every action on the account itself. A linked account cannot be deleted
 * until its bank is disconnected, so its menu leads to the connection instead.
 */
export function AccountMenu({ account }: { account: AccountDetailData }) {
	const { t } = useTranslation();
	const [editing, setEditing] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const [confirming, setConfirming] = useState(false);
	const toggles = useAccountToggles(account);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						ref={trigger}
						variant="ghost"
						size="icon"
						aria-label={t("accountActions.menu", { name: account.name })}
					>
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-auto">
					<DropdownMenuItem onSelect={() => setEditing(true)}>
						<PencilIcon aria-hidden="true" className="size-3.5" />
						{t("accountActions.edit")}
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
						{t(account.excludedFromReports ? "accountActions.include" : "accountActions.exclude")}
					</DropdownMenuItem>
					<DropdownMenuItem disabled={toggles.pending} onSelect={() => void toggles.toggleActive()}>
						{account.active ? (
							<CirclePauseIcon aria-hidden="true" className="size-3.5" />
						) : (
							<CirclePlayIcon aria-hidden="true" className="size-3.5" />
						)}
						{t(account.active ? "accountActions.deactivate" : "accountActions.reactivate")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{account.bankConnection === null ? (
						<DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
							<Trash2Icon aria-hidden="true" className="size-3.5" />
							{t("accountActions.delete.action")}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem asChild>
							<Link
								to="/settings/banks/$connectionId"
								params={{ connectionId: account.bankConnection.id }}
							>
								<UnplugIcon aria-hidden="true" className="size-3.5" />
								{t("accountActions.disconnectToDelete", {
									institutionName: account.bankConnection.institutionName,
								})}
							</Link>
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<EditAccountDialog
				account={account}
				open={editing}
				onOpenChange={setEditing}
				returnFocusTo={trigger}
			/>

			<DeleteAccountDialog account={account} open={confirming} onOpenChange={setConfirming} />
		</>
	);
}
