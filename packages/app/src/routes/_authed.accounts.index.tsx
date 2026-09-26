import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { AccountGroups, AccountGroupsSkeleton } from "@/components/AccountGroups";
import { CreateAccountDialog } from "@/components/CreateAccountDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAccounts } from "@/hooks/useAccounts";
import { errorCodeOf } from "@/lib/api";

// Absent means inactive accounts stay hidden, so links need no search params.
const searchSchema = z.object({
	showInactive: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/accounts/")({
	validateSearch: searchSchema,
	component: AccountsPage,
});

function AccountsPage() {
	const { t } = useTranslation();
	const accounts = useAccounts();
	const { showInactive = false } = Route.useSearch();
	const navigate = Route.useNavigate();
	const [creatingAccount, setCreatingAccount] = useState(false);
	const all = accounts.data?.groups.flatMap((group) => group.accounts) ?? [];
	const hasAccounts = all.length > 0;
	const hasInactive = all.some((account) => !account.active);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("accounts.title"), app: t("app.name") });
	}, [t]);

	return (
		<div className="flex w-full max-w-[1200px] flex-col gap-6 p-6">
			<div className="flex items-center justify-between gap-4">
				<h1 className="text-3xl font-semibold tracking-tight">{t("accounts.title")}</h1>
				{hasAccounts && (
					<Button onClick={() => setCreatingAccount(true)}>{t("accounts.add")}</Button>
				)}
			</div>

			{accounts.isPending && <AccountGroupsSkeleton />}

			{accounts.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(accounts.error)}`)}</p>
					<Button variant="outline" onClick={() => void accounts.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{hasInactive && (
				<div className="flex items-center gap-2">
					<Switch
						id="show-inactive"
						checked={showInactive}
						onCheckedChange={(checked) =>
							void navigate({
								search: (previous) => ({ ...previous, showInactive: checked ? true : undefined }),
								replace: true,
							})
						}
					/>
					<Label htmlFor="show-inactive">{t("accounts.showInactive")}</Label>
				</div>
			)}

			{accounts.data !== undefined && hasAccounts && (
				<AccountGroups list={accounts.data} showInactive={showInactive} />
			)}

			{accounts.data !== undefined && !hasAccounts && (
				<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
					<p className="text-muted-foreground">{t("accounts.empty")}</p>
					<Button onClick={() => setCreatingAccount(true)}>{t("accounts.add")}</Button>
				</div>
			)}
			<CreateAccountDialog open={creatingAccount} onOpenChange={setCreatingAccount} />
		</div>
	);
}
